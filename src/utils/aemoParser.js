import JSZip from 'jszip';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

// ── Constants ─────────────────────────────────────────────────────────────────
const AEMO_URL = '/aemo/Reports/Current/GBB/GasBBActualFlowStorage.zip';

const SE_STATES = new Set(['VIC', 'NSW', 'SA', 'TAS']);

// Terminal city/regional locations → state mapping.
// PIPE.Demand at these = total gas consumed (GPG + industrial + residential).
// Hub/transit nodes (Longford Hub, Moomba Hub, Iona Hub, Culcairn) are excluded.
const TERMINAL_LOC_STATE = {
  'Melbourne':      'VIC',
  'Geelong':        'VIC',
  'Ballarat':       'VIC',
  'Northern':       'VIC',
  'Western':        'VIC',
  'Gippsland':      'VIC',
  'Regional - VIC': 'VIC',
  'Sydney':         'NSW',
  'Canberra':       'NSW',
  'Regional - NSW': 'NSW',
  'Regional - ACT': 'NSW',
  'Adelaide':       'SA',
  'Regional - SA':  'SA',
  'Regional - TAS': 'TAS',
};
const TERMINAL_LOCATIONS = new Set(Object.keys(TERMINAL_LOC_STATE));

// ── Live fetch from AEMO ──────────────────────────────────────────────────────
export async function fetchAEMOData(onProgress) {
  onProgress?.('Downloading AEMO data...');

  let zipBuffer;
  try {
    const response = await fetch(AEMO_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('zip') && !contentType.includes('octet-stream')) {
      throw new Error(`AEMO fetch blocked — nemweb.com.au is not yet whitelisted on this server. Ask Ash to whitelist it, or load a local GBB file via ↑ Load data.`);
    }
    zipBuffer = await response.arrayBuffer();
  } catch (e) {
    throw new Error(e.message.startsWith('AEMO fetch blocked') ? e.message : `Failed to download: ${e.message}`);
  }

  onProgress?.('Unzipping...');
  const zip = await JSZip.loadAsync(zipBuffer);
  const csvFiles = Object.keys(zip.files).filter(f => f.toLowerCase().endsWith('.csv'));
  if (!csvFiles.length) throw new Error('No CSV files found in ZIP');

  onProgress?.('Parsing CSV...');
  let allRows = [];
  for (const filename of csvFiles) {
    const text = await zip.files[filename].async('string');
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() });
    allRows = allRows.concat(parsed.data); // concat avoids call stack overflow
  }

  onProgress?.(`Processing ${allRows.length.toLocaleString()} rows...`);
  return aggregateRows(allRows);
}

// SE pipeline linepack delta — SE trunk pipes only, EXCLUDING SWQP
// (SWQP's net QLD↔SE flow is already captured in qld_net_flow / qld_supply)
const SE_LINEPACK_PIPES = new Set(['VTS','MSP','EGP','MAPS','PCA','PCI','TGP','MPL','SESA',
  'BPP','LYB Transmission Pipeline','Bomaderry Gas Pipeline','ColongraGP','CWP',
  'Tallawarra Pipeline']);
//   GPG SE       = BBGPG.Demand  where State in SE_STATES
//   GPG QLD      = BBGPG.Demand  where State = QLD
//   Industrial   = BBLARGE.Demand where State in SE_STATES
//   Residential  = PIPE.Demand at TERMINAL_LOCATIONS (SE) minus GPG_SE minus Industrial
//   Prod Longford= PROD.Supply  where FacilityName in (Longford, Lang Lang, Orbost)
//   Prod Moomba  = PROD.Supply  where State in SE_STATES and not Longford
//   Prod SWQP    = PROD.Supply  where State = QLD
//   Iona net     = STOR.Supply - STOR.Demand where FacilityName = 'Iona UGS'
//                  (Supply = withdrawal from storage, Demand = injection into storage)
//   Iona balance = STOR.HeldInStorage where FacilityName = 'Iona UGS'

function aggregateRows(rows) {
  const dailyMap = new Map();

  const ensure = (date) => {
    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        gpg_se: 0, gpg_qld: 0,
        industrial: 0,
        pipe_city: 0,
        // Per-state breakdowns
        gpg_vic: 0, gpg_nsw: 0, gpg_sa: 0, gpg_tas: 0,
        ind_vic: 0, ind_nsw: 0, ind_sa: 0,  ind_tas: 0,
        pipe_vic: 0, pipe_nsw: 0, pipe_sa: 0, pipe_tas: 0,
        // Production
        production_longford: 0,
        production_moomba: 0,
        production_other_south: 0,  // Minerva, Otway, Athena, Camden, Lang Lang, Orbost
        // SE sub-groups
        production_se_otway: 0,     // Otway Basin: Otway, Minerva/ATHENA (via Iona)
        production_se_gippsland: 0, // Gippsland Basin non-Longford: Orbost, Lang Lang
        production_se_other: 0,     // Camden, Bass Strait other, any residual SE
        production_swqp: 0,
        // QLD sub-groups (sum = production_swqp)
        production_qld_surat_aplng: 0,   // APLNG Surat Basin: Condabri, Orana, Reedy Creek, Talinga, Daandine, Tipton, Woleebee Creek
        production_qld_surat_glng: 0,    // GLNG Surat Basin: Fairview, Kenya, Scotia, Arcadia, Windibri, Strathblane, Spring Gully, Meridian, Yellowbank
        production_qld_roma: 0,          // Roma/Wallumbilla area: Ruby Jo, Combabula, Jordan, Roma, Roma North, RMNGPF, Taloona
        production_qld_other: 0,         // All other QLD (Rolleston, Kincora, Kogan North, Atlas, Bellevue, Peat, Eurombah Creek etc.)
        // Pipeline flow map fields
        map_msp_nsw: 0,     // MSP demand at NSW/ACT nodes (Moomba→Sydney)
        map_maps_sa: 0,     // MAPS demand at SA nodes (Moomba→Adelaide)
        map_egp_nsw: 0,     // EGP demand at NSW/ACT/Canberra nodes (Longford→Sydney)
        map_vts_vic: 0,     // VTS demand at VIC city nodes (Longford→Melbourne)
        map_pca_sa: 0,      // PCA demand at SA nodes (Iona/Otway→Adelaide)
        map_pci_iona: 0,    // PCI supply at Iona Hub (Otway→Iona)
        map_tgp_tas: 0,     // TGP demand at TAS nodes
        map_egp_vic: 0,     // EGP supply at Longford Hub (northbound to NSW)
        map_sesa: 0,        // SEA Gas / SESA (VIC→SA)
        map_mpl_vic: 0,     // Minerva Pipeline lateral to VIC
        map_pca_iona: 0,    // PCA throughput at Iona Hub
        map_rbp_bris: 0,    // RBP demand at Brisbane
        map_qgp_qld: 0,     // QGP demand in QLD
        map_ddp_wall: 0,    // Darling Downs to Wallumbilla
        map_ddp_qld: 0,     // Darling Downs QLD demand
        map_bwp_wall: 0,    // Berwyndale-Wallumbilla Pipeline
        map_rcwp_wall: 0,   // Roma-Condamine-Wallumbilla Pipeline
        map_swqp: 0,        // SWQP at Wallumbilla Hub
        map_cgp_ball: 0,    // Cooper Gas Pipeline at Ballera
        map_wgp_lng: 0,     // WGP to Curtis Island LNG
        map_ngp: 0,         // Northern Gas Pipeline (NT→Moomba)
        map_aplng: 0,       // APLNG to Curtis Island
        map_glng: 0,        // GLNG to Curtis Island
        map_vni: 0,         // VNI = VTS Culcairn interconnect flow
        map_swp: 0,         // SWP = South West Pipeline (Iona→Melbourne, part of VTS)
        map_culcairn: 0,    // MSP→VTS transfer at Culcairn
        // Supply-side
        qld_net_flow: 0,         // SWQP: TransferOut - Supply at Moomba Hub
                                 //   positive = QLD→SE (net supply to SE, winter)
                                 //   negative = SE→QLD (net drain from SE, summer)
        // Legacy alias kept for chart compatibility
        qld_supply: 0,           // same as qld_net_flow when positive (chart uses this for positive area)
        se_to_qld: 0,            // abs(qld_net_flow) when negative (chart uses this for negative area)
        storage_withdrawal: 0,   // SE storage gross withdrawal (supplying the market, >= 0)
        storage_injection: 0,    // SE storage gross injection (absorbing surplus, >= 0)
        storage_south_net: 0,    // = withdrawal - injection (signed)
        storage_iona: 0,
        storage_balance_iona: null,
        storage_other: 0,   // Dandenong LNG + Moomba Storage + NGS (net withdrawal positive)
        // SE pipeline linepack change: Σ(S+TI-D-TO) across all SE pipe nodes
        // Negative = linepack being drawn down (gas leaving pipes faster than entering)
        // Positive = linepack filling (more gas entering pipes than leaving)
        pipe_linepack_se: 0,
      });
    }
    return dailyMap.get(date);
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawDate = row['GasDate'] || '';
    if (!rawDate) continue;
    const date = parseDate(rawDate);
    if (!date || date < '2018-01-01') continue;

    const ft    = (row['FacilityType']  || '').trim();
    const state = (row['State']         || '').trim();
    const name  = (row['FacilityName']  || '').trim();
    const loc   = (row['LocationName']  || '').trim();
    const demand = parseFloat(row['Demand']  || 0) || 0;
    const supply = parseFloat(row['Supply']  || 0) || 0;
    const held   = row['HeldInStorage'];

    const d = ensure(date);

    if (ft === 'BBGPG') {
      if (SE_STATES.has(state)) {
        d.gpg_se += demand;
        if (state === 'VIC') d.gpg_vic += demand;
        else if (state === 'NSW') d.gpg_nsw += demand;
        else if (state === 'SA')  d.gpg_sa  += demand;
        else if (state === 'TAS') d.gpg_tas += demand;
      } else if (state === 'QLD') {
        d.gpg_qld += demand;
      }

    } else if (ft === 'BBLARGE' && SE_STATES.has(state)) {
      d.industrial += demand;
      if (state === 'VIC') d.ind_vic += demand;
      else if (state === 'NSW') d.ind_nsw += demand;
      else if (state === 'SA')  d.ind_sa  += demand;
      else if (state === 'TAS') d.ind_tas += demand;

    } else if (ft === 'PIPE' && TERMINAL_LOCATIONS.has(loc)) {
      const mappedState = TERMINAL_LOC_STATE[loc];
      d.pipe_city += demand;
      if (mappedState === 'VIC') d.pipe_vic += demand;
      else if (mappedState === 'NSW') d.pipe_nsw += demand;
      else if (mappedState === 'SA')  d.pipe_sa  += demand;
      else if (mappedState === 'TAS') d.pipe_tas += demand;

    } else if (ft === 'PROD' && SE_STATES.has(state)) {
      if (name === 'Longford') {
        d.production_longford += supply;
      } else if (name === 'Moomba') {
        d.production_moomba += supply;
      } else {
        // Lang Lang, Orbost, Minerva, Otway, Athena, Camden, etc.
        d.production_other_south += supply;
        const OTWAY_BASIN    = new Set(['Otway','ATHENA','Minerva']);
        const GIPPSLAND_OTHR = new Set(['Orbost','Lang Lang']);
        if (OTWAY_BASIN.has(name))        d.production_se_otway      += supply;
        else if (GIPPSLAND_OTHR.has(name)) d.production_se_gippsland += supply;
        else                               d.production_se_other      += supply;
      }

    } else if (ft === 'PROD' && state === 'QLD') {
      d.production_swqp += supply;
      // Sub-group classification
      const APLNG_SURAT = new Set(['Condabri North','Condabri South','Condabri Central','Orana',
        'Reedy Creek','Talinga','Daandine','Tipton','Woleebee Creek','Bellevue','Eurombah Creek','Atlas',
        'Atlas East Central Processing Facility']);
      const GLNG_SURAT  = new Set(['Fairview','Kenya','Scotia','Arcadia','Windibri','Strathblane',
        'Spring Gully','Meridian','Yellowbank','Jordan']);
      const ROMA_AREA   = new Set(['Ruby Jo','Combabula','Roma','Roma North','RMNGPF','Taloona',
        'Kincora','Peat']);
      if (APLNG_SURAT.has(name))      d.production_qld_surat_aplng += supply;
      else if (GLNG_SURAT.has(name))  d.production_qld_surat_glng  += supply;
      else if (ROMA_AREA.has(name))   d.production_qld_roma        += supply;
      else                            d.production_qld_other       += supply;

    } else if (ft === 'PIPE' && name === 'SWQP') {
      // Net QLD↔SE flow measured at Moomba Hub: TransferOut - Supply
      // TO > S: more gas leaving Moomba north than arriving from QLD → net QLD→SE supply (positive)
      // S > TO: more QLD gas arriving than leaving north → net SE→QLD drain (negative)
      // Verified: gives −9 to −16 TJ/day annual average for 2023–2025 (linepack range)
      if (loc === 'Moomba Hub') {
        const transferOut = row['TransferOut'] ? parseFloat(row['TransferOut']) : 0;
        const netFlow = transferOut - supply;  // positive = QLD→SE
        d.qld_net_flow += netFlow;
        d.qld_supply   += Math.max(0, netFlow);
        d.se_to_qld    += Math.max(0, -netFlow);
      }

    } else if (ft === 'STOR' && SE_STATES.has(state)) {
      d.storage_withdrawal += supply;  // gross withdrawal
      d.storage_injection  += demand;  // gross injection
      d.storage_south_net  += supply - demand;
      if (name === 'Iona UGS') {
        d.storage_iona += supply - demand;
        if (held && held !== '') d.storage_balance_iona = parseFloat(held);
      } else if (['Dandenong LNG','Moomba Storage','NGS'].includes(name)) {
        d.storage_other += supply - demand;
      }
    }

    // Pipeline map flows — run independently (not else-if) so terminal nodes are also captured
    if (ft === 'PIPE') {
      const ti_  = row['TransferIn']  ? parseFloat(row['TransferIn'])  : 0;
      const to_  = row['TransferOut'] ? parseFloat(row['TransferOut']) : 0;
      const net = Math.abs(supply + ti_ - demand - to_);

      // SE linepack delta: signed (S+TI-D-TO) for SE-state pipe nodes only.
      // SWQP excluded — its QLD↔SE net flow is already counted in qld_net_flow/qld_supply.
      // Negative = linepack drawdown; Positive = linepack filling.
      if (SE_LINEPACK_PIPES.has(name) && SE_STATES.has(state)) {
        d.pipe_linepack_se += (supply + ti_ - demand - to_);
      }

      // Universal formula: abs(S + TI - D - TO) at a single anchor node per pipeline.
      // The sign of (S+TI-D-TO) flips with flow direction; abs() gives the magnitude.
      // Anchor nodes were chosen to match GBB's measurement point for each pipeline.

      // ── Production hub / transit pipes ──────────────────────────────────────
      if (name === 'EGP'  && loc === 'Longford Hub')          d.map_egp_nsw  += net;
      if (name === 'MAPS' && loc === 'Moomba Hub')            d.map_maps_sa  += net;
      if (name === 'MSP'  && loc === 'Moomba Hub')            d.map_msp_nsw  += net;
      if (name === 'TGP'  && loc === 'Longford Hub')          d.map_tgp_tas  += net;
      if (name === 'SWQP' && loc === 'Wallumbilla Hub')       d.map_swqp     += net;
      if (name === 'CGP'  && loc === 'Ballera')               d.map_cgp_ball += net;
      if (name === 'PCA'  && loc === 'Iona Hub')              d.map_pca_sa   += net;

      // ── VTS sub-segments (LMP, SWP, VNI) ───────────────────────────────────
      if (name === 'VTS') {
        const vicCities = ['Melbourne','Geelong','Ballarat','Northern','Western','Gippsland'];
        if (vicCities.includes(loc))   d.map_vts_vic  += demand;
        if (loc === 'Longford Hub')    d.map_lmp      += net;   // LMP
        if (loc === 'Iona Hub')        d.map_swp      += net;   // SWP
        if (loc === 'Culcairn')        d.map_vni      += net;   // VNI
      }

      // ── Terminal delivery pipes (D only — abs(net) = D when S=TI=TO=0) ─────
      // RBP, WGP, APLNG, GLNG: terminal nodes have no local production, so net=D naturally.
      // QGP exception: local CSG production injects at Regional-QLD, corrupting net → use D only.
      if (name === 'RBP'            && loc === 'Brisbane')       d.map_rbp_bris += demand;
      if (name === 'QGP'            && loc === 'Regional - QLD') d.map_qgp_qld  += demand;
      if (name === 'WGP'            && loc === 'Curtis Island')  d.map_wgp_lng  += demand;
      if (name === 'APLNG Pipeline' && loc === 'Curtis Island')  d.map_aplng    += demand;
      if (name === 'GLNG Pipeline'  && loc === 'Curtis Island')  d.map_glng     += demand;

      // ── Other / legacy fields ────────────────────────────────────────────────
      if (name === 'PCI' && loc === 'Iona Hub')                d.map_pci_iona += net;
      if (name === 'DDP' && loc === 'Wallumbilla Hub')         d.map_ddp_wall += to_;
      if (name === 'BWP' && loc === 'Wallumbilla Hub')         d.map_bwp_wall += to_;
      if (name === 'RCWP'&& loc === 'Wallumbilla Hub')         d.map_rcwp_wall+= to_;
      if (name === 'NGP')                                      d.map_ngp      += supply + demand;
    }
  }

  return finaliseDailyMap(dailyMap);
}

function finaliseDailyMap(dailyMap) {
  const records = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  for (const d of records) {
    // Residential = everything flowing to terminal city nodes, minus GPG and large industrial
    d.residential = Math.max(0, d.pipe_city - d.gpg_se - d.industrial);

    // Per-state residential and totals
    d.res_vic = Math.max(0, d.pipe_vic - d.gpg_vic - d.ind_vic);
    d.res_nsw = Math.max(0, d.pipe_nsw - d.gpg_nsw - d.ind_nsw);
    d.res_sa  = Math.max(0, d.pipe_sa  - d.gpg_sa  - d.ind_sa);
    d.res_tas = Math.max(0, d.pipe_tas - d.gpg_tas - d.ind_tas);

    d.total_vic = d.pipe_vic;
    d.total_nsw = d.pipe_nsw;
    d.total_sa  = d.pipe_sa;
    d.total_tas = d.pipe_tas;

    d.total_demand_se  = d.gpg_se + d.industrial + d.residential;
    d.total_production = d.production_longford + d.production_moomba + d.production_other_south + d.production_swqp;
    // total_supply = SE production + net QLD inflow (when positive) + storage withdrawal
    d.total_supply = d.production_longford + d.production_moomba + d.production_other_south
                   + d.qld_supply + d.storage_withdrawal;
    // Gap: add back storage injection (surplus not in city demand) and se_to_qld (drain reduces supply)
    d.supply_demand_gap = d.total_demand_se - d.total_supply + d.storage_injection + d.se_to_qld;

    d.year      = parseInt(d.date.substring(0, 4));
    d.month     = parseInt(d.date.substring(5, 7));
    d.dayOfYear = getDayOfYear(d.date);
  }

  console.log(`[AEMO] Processed ${records.length} daily records, ${records[0]?.date} → ${records[records.length-1]?.date}`);
  return records;
}

// ── Load from user-uploaded processed Excel file ──────────────────────────────
// Accepts an Excel file already in the processed daily format (columns as below).
export async function loadFromExcel(file, onProgress) {
  onProgress?.('Reading Excel file...');
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });

  const sheetName = wb.SheetNames.includes('Daily Data') ? 'Daily Data' : wb.SheetNames[0];
  onProgress?.(`Parsing sheet: ${sheetName}...`);

  const ws  = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: null });
  if (!raw.length) throw new Error('No data found in Excel file');

  console.log('[Excel] Headers:', Object.keys(raw[0]));
  console.log('[Excel] Sample:', raw[0]);

  // Column name mapping — flexible to handle minor naming variations
  const COL = {
    date:      find(raw[0], ['Date','GasDate','Gas Date']),
    gpg_se:    find(raw[0], ['GPG SE (TJ)','GPG SE','GPG_SE']),
    gpg_qld:   find(raw[0], ['GPG QLD (TJ)','GPG QLD','GPG_QLD']),
    res:       find(raw[0], ['Residential & Commercial (TJ)','Residential & Commercial','Residential']),
    ind:       find(raw[0], ['Industrial (TJ)','Industrial']),
    total:     find(raw[0], ['Total Demand SE (TJ)','Total Demand SE','Total Demand']),
    prod_long: find(raw[0], ['Production Longford (TJ)','Production Longford','Longford']),
    prod_moom: find(raw[0], ['Production Moomba (TJ)','Production Moomba','Moomba']),
    prod_swqp: find(raw[0], ['Production SWQP (TJ)','Production SWQP','SWQP']),
    prod_tot:  find(raw[0], ['Total Production (TJ)','Total Production']),
    stor_net:  find(raw[0], ['Storage Iona Net (TJ)','Storage Iona Net','Iona Net']),
    stor_bal:  find(raw[0], ['Storage Iona Balance (TJ)','Storage Iona Balance','Iona Balance']),
  };

  onProgress?.(`Processing ${raw.length.toLocaleString()} rows...`);

  const records = raw.map(row => {
    const rawDate = COL.date ? row[COL.date] : null;
    if (!rawDate) return null;
    const date = parseDate(rawDate);
    if (!date) return null;

    const n = (col) => col ? (parseFloat(row[col]) || 0) : 0;
    const gpg_se = n(COL.gpg_se), gpg_qld = n(COL.gpg_qld);
    const res = n(COL.res), ind = n(COL.ind);
    const pl = n(COL.prod_long), pm = n(COL.prod_moom), ps = n(COL.prod_swqp);
    const storNet = n(COL.stor_net);
    const storBal = COL.stor_bal && row[COL.stor_bal] !== null ? parseFloat(row[COL.stor_bal]) : null;

    return {
      date, year: parseInt(date.substring(0, 4)), month: parseInt(date.substring(5, 7)),
      dayOfYear: getDayOfYear(date),
      gpg_se, gpg_qld, residential: res, industrial: ind,
      production_longford: pl, production_moomba: pm, production_swqp: ps, production_other: 0,
      storage_iona: storNet, storage_balance_iona: storBal, storage_other: 0,
      total_demand_se:  n(COL.total) || (gpg_se + res + ind),
      total_production: n(COL.prod_tot) || (pl + pm + ps),
    };
  }).filter(Boolean);

  console.log(`[Excel] Loaded ${records.length} records, ${records[0]?.date} → ${records[records.length-1]?.date}`);
  return records;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function find(obj, candidates) {
  for (const c of candidates) if (c in obj) return c;
  return null;
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getFullYear(), m = val.getMonth() + 1, d = val.getDate();
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  const s = String(val).trim();
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(s)) return s.replace(/\//g,'-').substring(0,10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return s.substring(0,10);
}

function getDayOfYear(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
}

// ── Stats ─────────────────────────────────────────────────────────────────────
export function computeStats(records) {
  if (!records.length) return {};
  const years = [...new Set(records.map(r => r.year))].sort();
  const byYear = {};
  for (const y of years) {
    const yr   = records.filter(r => r.year === y);
    const dem  = yr.map(r => r.total_demand_se).filter(v => v > 0);
    const gpgs = yr.map(r => r.gpg_se).filter(v => v > 0);
    byYear[y] = {
      peakDemand: Math.max(...dem),
      avgDemand:  dem.reduce((a,b) => a+b, 0) / dem.length,
      peakGPG:    Math.max(...gpgs),
      daysOver400: gpgs.filter(v => v > 400).length,
      daysOver500: gpgs.filter(v => v > 500).length,
      daysOver600: gpgs.filter(v => v > 600).length,
    };
  }
  return { years, byYear };
}

// ── Demo / sample data ────────────────────────────────────────────────────────
export function generateSampleData() {
  const records = [];
  let d = new Date('2023-01-01');
  const end = new Date('2025-12-31');
  while (d <= end) {
    const dateStr = d.toISOString().substring(0,10);
    const year = d.getFullYear(), month = d.getMonth() + 1;
    const doy  = getDayOfYear(dateStr);
    const n    = () => (Math.random() - 0.5) * 0.12;
    const seas = 1 + 0.35 * Math.sin((doy - 80) * -Math.PI / 182.5);
    const res  = (820 + 15*(year-2023)) * seas * (1+n());
    const ind  = 252 * (1+n()*0.4);
    const gpgBase = month>=6&&month<=8 ? 220 : 110;
    const spike   = Math.random() < 0.04 ? 400 + Math.random()*600 : 0;
    const gpg     = Math.max(0, gpgBase*(1+n()) + spike);
    const dec     = 1 - (year-2023)*0.03;
    const longford        = 400*dec*(1+0.15*Math.sin((doy-80)*-Math.PI/182.5))*(1+n()*0.08);
    const moomba          = 205*dec*(1+n()*0.08);
    const other_south     = 100*dec*(1+n()*0.1);
    const swqp            = 330*(1+n()*0.08);
    const storWinter      = month>=5&&month<=8 ? 200+Math.random()*300 : 0;
    const storSummer      = month<5||month>8  ? 80+Math.random()*120  : 0;
    const ionaBal         = 14000 + 4000*Math.sin((doy-200)*Math.PI/182.5) - 500*(year-2023);
    const total           = Math.round(res+ind+gpg);
    const totalSupply     = Math.round(longford+moomba+other_south+swqp+storWinter);
    const gap             = total - totalSupply;
    // State splits (approximate proportions: VIC 53%, NSW 27%, SA 17%, TAS 3%)
    const vic_frac = 0.53 + n()*0.02, nsw_frac = 0.27 + n()*0.01;
    const sa_frac  = 0.17 + n()*0.01, tas_frac  = 0.03;
    const gpg_vic = Math.round(gpg*0.42), gpg_nsw = Math.round(gpg*0.21);
    const gpg_sa  = Math.round(gpg*0.34), gpg_tas = Math.round(gpg*0.03);
    records.push({
      date: dateStr, year, month, dayOfYear: doy,
      gpg_se: Math.round(gpg), gpg_qld: Math.round(gpg*0.3),
      gpg_vic, gpg_nsw, gpg_sa, gpg_tas,
      residential: Math.round(res), industrial: Math.round(ind),
      // State totals
      total_vic: Math.round(total * vic_frac),
      total_nsw: Math.round(total * nsw_frac),
      total_sa:  Math.round(total * sa_frac),
      total_tas: Math.round(total * tas_frac),
      // Supply fields
      production_longford:      Math.round(longford),
      production_moomba:        Math.round(moomba),
      production_other_south:   Math.round(other_south),
      production_swqp:          Math.round(swqp),
      qld_supply:               Math.round(swqp * 0.55),
      storage_withdrawal:       Math.round(storWinter),
      storage_injection:        Math.round(storSummer),
      storage_south_net:        Math.round(storWinter - storSummer),
      storage_iona:             Math.round(storWinter - storSummer),
      storage_balance_iona:     Math.round(ionaBal),
      storage_other:            Math.round((storWinter - storSummer) * 0.04), // ~4% of Iona as proxy
      total_demand_se:          total,
      total_production:         Math.round(longford+moomba+other_south+swqp),
      total_supply:             totalSupply,
      supply_demand_gap:        gap + Math.round(storSummer),
    });
    d.setDate(d.getDate()+1);
  }
  return records;
}
