/**
 * TabGasPrice — East Coast Gas Market Dashboard
 *
 * Data sources (fetched via nginx proxy → aemo.com.au):
 *   STTM:  /aemo-media/files/gas/sttm/data/sttm-price-and-withdrawals.xlsx
 *          Sheets: "SYD price and withdrawals", "ADL price and withdrawals", "BRI price and withdrawals"
 *          Columns: DateTime (daily), exante_price, expost_price, Network_allocation
 *
 *   DWGM:  /aemo-media/files/gas/dwgm/dwgm-prices-and-demand.xlsx
 *          Sheet "Prices":  Gas_Date, Hour (6/10/14/18/22), Price
 *          Sheet "Demand":  Gas_Date, System Demand (TJ), GPG (TJ), Total Demand (TJ)
 *
 * Daily DWGM price = mean of all intervals (default) or 6am only (ASX reference)
 */

import { useMemo, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  LineChart, Line, ComposedChart, Area, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend as RechartLegend
} from 'recharts';
import {
  ChartCard, KpiCard, CustomTooltip, AXIS_STYLE, GRID_STYLE,
  YEAR_COLORS, Legend, fmtDate
} from '../components/ChartCard';
import { exportToPowerPoint, exportToExcel } from '../utils/exportUtils';

// ── Constants ─────────────────────────────────────────────────────────────────
const STTM_URL  = '/aemo-media/files/gas/sttm/data/sttm-price-and-withdrawals.xlsx';
const DWGM_URL  = '/aemo-media/files/gas/dwgm/dwgm-prices-and-demand.xlsx';

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_TICKS  = [1, 32, 61, 92, 122, 153, 183, 214, 245, 275, 306, 336];

const HUB_META = {
  dwgm: { label: 'DWGM (VIC)',   color: '#7c9ef8', fullLabel: 'DWGM — Declared Wholesale Gas Market (Victoria)' },
  syd:  { label: 'SYD',          color: '#e6a817', fullLabel: 'Sydney STTM Hub' },
  adl:  { label: 'ADL',          color: '#3fb950', fullLabel: 'Adelaide STTM Hub' },
  bri:  { label: 'BRI',          color: '#f85149', fullLabel: 'Brisbane STTM Hub' },
};

const SPIKE_THRESHOLDS = [10, 15, 20, 30];

function dayLabel(day) {
  const d = new Date(2024, 0, day);
  return MONTH_LABELS[d.getMonth()];
}

function toDateStr(val) {
  // Excel serial number or JS Date → YYYY-MM-DD
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'number') {
    // Excel date serial
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  if (typeof val === 'string') return val.slice(0, 10);
  return null;
}

function dayOfYear(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, 0, 0);
  const date  = new Date(y, m - 1, d);
  return Math.floor((date - start) / 86400000);
}

// ── Parse STTM workbook ────────────────────────────────────────────────────────
function parseSttm(workbook) {
  const hubMap = {
    syd: 'SYD price and withdrawals',
    adl: 'ADL price and withdrawals',
    bri: 'BRI price and withdrawals',
  };
  const result = {}; // { 'YYYY-MM-DD': { syd, adl, bri } }

  for (const [hub, sheetName] of Object.entries(hubMap)) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    for (let i = 1; i < rows.length; i++) {
      const [dateVal, exante, expost] = rows[i];
      if (!dateVal && exante == null) continue;
      const dateStr = toDateStr(dateVal);
      if (!dateStr) continue;
      const price = (exante != null && !isNaN(exante)) ? Number(exante)
                  : (expost != null && !isNaN(expost)) ? Number(expost)
                  : null;
      if (price == null) continue;
      if (!result[dateStr]) result[dateStr] = {};
      result[dateStr][hub] = price;
    }
  }
  return result;
}

// ── Parse DWGM workbook ────────────────────────────────────────────────────────
function parseDwgm(workbook, use6amOnly) {
  const priceSheet  = workbook.Sheets['Prices'];
  const demandSheet = workbook.Sheets['Demand'];
  if (!priceSheet) return { prices: {}, demand: {} };

  // Prices: aggregate per day
  const priceRows = XLSX.utils.sheet_to_json(priceSheet, { header: 1, raw: true });
  const dayBuckets = {}; // { dateStr: number[] }
  for (let i = 1; i < priceRows.length; i++) {
    const [dateVal, hour, price] = priceRows[i];
    if (!dateVal || price == null) continue;
    const dateStr = toDateStr(dateVal);
    if (!dateStr) continue;
    if (use6amOnly && hour !== 6) continue;
    if (!dayBuckets[dateStr]) dayBuckets[dateStr] = [];
    dayBuckets[dateStr].push(Number(price));
  }
  const prices = {};
  for (const [d, vals] of Object.entries(dayBuckets)) {
    prices[d] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  // Demand
  const demand = {};
  if (demandSheet) {
    const demRows = XLSX.utils.sheet_to_json(demandSheet, { header: 1, raw: true });
    for (let i = 1; i < demRows.length; i++) {
      const [dateVal, sysDem, gpg, total] = demRows[i];
      if (!dateVal) continue;
      const dateStr = toDateStr(dateVal);
      if (!dateStr) continue;
      demand[dateStr] = {
        sysDemand: Number(sysDem) || 0,
        gpg:       Number(gpg)    || 0,
        total:     Number(total)  || 0,
      };
    }
  }
  return { prices, demand };
}

// ── Merge into unified daily records ──────────────────────────────────────────
function buildDailyRecords(sttmData, dwgmPrices, dwgmDemand) {
  const allDates = new Set([
    ...Object.keys(sttmData),
    ...Object.keys(dwgmPrices),
  ]);
  const records = [];
  for (const date of allDates) {
    const [y, m] = date.split('-').map(Number);
    const sttm   = sttmData[date]   || {};
    const dwgm   = dwgmPrices[date] ?? null;
    const dem    = dwgmDemand[date] || null;
    records.push({
      date,
      year:     y,
      month:    m,
      dayOfYear: dayOfYear(date),
      dwgm,
      syd:  sttm.syd ?? null,
      adl:  sttm.adl ?? null,
      bri:  sttm.bri ?? null,
      dwgmDemand: dem?.total     ?? null,
      dwgmGpg:    dem?.gpg       ?? null,
      dwgmSys:    dem?.sysDemand ?? null,
    });
  }
  return records.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ ok, label }) {
  return (
    <span style={{
      fontSize: 11, fontFamily: 'DM Mono, monospace', padding: '2px 8px',
      borderRadius: 10,
      background: ok ? '#3fb95022' : '#f8514922',
      color:       ok ? '#3fb950'  : '#f85149',
      border: `1px solid ${ok ? '#3fb95044' : '#f8514944'}`,
    }}>
      {ok ? '✓' : '○'} {label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TabGasPrice({ selectedYears }) {
  // ── Data state ───────────────────────────────────────────────────────────────
  const [priceRecords, setPriceRecords] = useState([]);
  const [loading, setLoading]           = useState({ sttm: false, dwgm: false });
  const [loaded,  setLoaded]            = useState({ sttm: false, dwgm: false });
  const [error,   setError]             = useState({ sttm: null,  dwgm: null  });

  // Raw parsed data stores (merged when both present)
  const [sttmData,    setSttmData]    = useState({});
  const [dwgmPrices,  setDwgmPrices]  = useState({});
  const [dwgmDemand,  setDwgmDemand]  = useState({});

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [use6am,        setUse6am]        = useState(false);
  const [spreadYear,    setSpreadYear]    = useState(null);
  const [spikeThreshold,setSpikeThreshold]= useState(10);
  const [visibleHubs,   setVisibleHubs]   = useState({ dwgm: true, syd: true, adl: true, bri: true });

  const latestYear = selectedYears.length ? Math.max(...selectedYears) : new Date().getFullYear();

  // ── Rebuild records whenever source data or 6am toggle changes ───────────────
  useMemo(() => {
    const recs = buildDailyRecords(sttmData, dwgmPrices, dwgmDemand);
    setPriceRecords(recs);
    if (!spreadYear && recs.length) {
      const yrs = [...new Set(recs.map(r => r.year))].sort();
      setSpreadYear(yrs[yrs.length - 1]);
    }
  }, [sttmData, dwgmPrices, dwgmDemand]);

  // ── Re-parse DWGM prices when 6am toggle changes ─────────────────────────────
  const [rawDwgmWb, setRawDwgmWb] = useState(null);
  useMemo(() => {
    if (!rawDwgmWb) return;
    const { prices, demand } = parseDwgm(rawDwgmWb, use6am);
    setDwgmPrices(prices);
    setDwgmDemand(demand);
  }, [rawDwgmWb, use6am]);

  // ── Fetch helpers ─────────────────────────────────────────────────────────────
  const fetchAndParse = useCallback(async (url, type) => {
    setLoading(prev => ({ ...prev, [type]: true }));
    setError(prev => ({ ...prev, [type]: null }));
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const wb  = XLSX.read(buf, { type: 'array', cellDates: true });
      if (type === 'sttm') {
        setSttmData(parseSttm(wb));
        setLoaded(prev => ({ ...prev, sttm: true }));
      } else {
        setRawDwgmWb(wb);
        setLoaded(prev => ({ ...prev, dwgm: true }));
      }
    } catch (e) {
      setError(prev => ({ ...prev, [type]: e.message }));
    } finally {
      setLoading(prev => ({ ...prev, [type]: false }));
    }
  }, []);

  const handleFileUpload = useCallback((e, type) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true });
        if (type === 'sttm') {
          setSttmData(parseSttm(wb));
          setLoaded(prev => ({ ...prev, sttm: true }));
        } else {
          setRawDwgmWb(wb);
          setLoaded(prev => ({ ...prev, dwgm: true }));
        }
      } catch (err) {
        setError(prev => ({ ...prev, [type]: err.message }));
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }, []);

  // Multi-file handler — auto-detects STTM vs DWGM by sheet names
  const handlePriceFiles = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true });
          const sheets = wb.SheetNames;
          if (sheets.some(s => s.includes('price and withdrawals'))) {
            setSttmData(parseSttm(wb));
            setLoaded(prev => ({ ...prev, sttm: true }));
          } else if (sheets.includes('Prices') && sheets.includes('Demand')) {
            setRawDwgmWb(wb);
            setLoaded(prev => ({ ...prev, dwgm: true }));
          } else {
            setError(prev => ({ ...prev, sttm: `Unrecognised file: ${file.name}` }));
          }
        } catch (err) {
          setError(prev => ({ ...prev, sttm: err.message }));
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }, []);

  const fetchBoth = useCallback(() => {
    fetchAndParse(STTM_URL, 'sttm');
    fetchAndParse(DWGM_URL, 'dwgm');
  }, [fetchAndParse]);

  // ── Derived chart data ────────────────────────────────────────────────────────
  const availableYears = useMemo(() =>
    [...new Set(priceRecords.map(r => r.year))].sort()
  , [priceRecords]);

  // YoY pivot per hub — one row per dayOfYear, columns = years
  function buildYoY(hub) {
    const pivot = {};
    for (const r of priceRecords) {
      if (!selectedYears.includes(r.year)) continue;
      const val = r[hub];
      if (val == null || isNaN(val)) continue;
      const key = r.dayOfYear;
      if (!pivot[key]) pivot[key] = { day: key };
      pivot[key][r.year] = val;
    }
    return Object.values(pivot).sort((a, b) => a.day - b.day);
  }

  const yoyDwgm = useMemo(() => buildYoY('dwgm'), [priceRecords, selectedYears]);
  const yoySyd  = useMemo(() => buildYoY('syd'),  [priceRecords, selectedYears]);
  const yoyAdl  = useMemo(() => buildYoY('adl'),  [priceRecords, selectedYears]);
  const yoyBri  = useMemo(() => buildYoY('bri'),  [priceRecords, selectedYears]);

  // Hub spread for selected year
  const spreadData = useMemo(() => {
    if (!spreadYear) return [];
    return priceRecords
      .filter(r => r.year === spreadYear)
      .map(r => ({
        date: r.date.substring(5),
        dwgm: r.dwgm,
        syd:  r.syd,
        adl:  r.adl,
        bri:  r.bri,
      }));
  }, [priceRecords, spreadYear]);

  // Spike calendar — days above threshold, grouped by year+hub
  const spikeData = useMemo(() => {
    const byYear = {};
    for (const r of priceRecords) {
      if (!selectedYears.includes(r.year)) continue;
      if (!byYear[r.year]) byYear[r.year] = { year: r.year, dwgm: 0, syd: 0, adl: 0, bri: 0 };
      for (const hub of ['dwgm','syd','adl','bri']) {
        if (r[hub] != null && r[hub] >= spikeThreshold) byYear[r.year][hub]++;
      }
    }
    return Object.values(byYear).sort((a, b) => a.year - b.year);
  }, [priceRecords, selectedYears, spikeThreshold]);

  // DWGM price vs demand overlay (latest year or spread year)
  const dwgmOverlay = useMemo(() => {
    const yr = spreadYear || latestYear;
    return priceRecords
      .filter(r => r.year === yr && r.dwgm != null && r.dwgmDemand != null)
      .map(r => ({ date: r.date.substring(5), price: r.dwgm, demand: r.dwgmDemand, gpg: r.dwgmGpg }));
  }, [priceRecords, spreadYear, latestYear]);

  // KPIs — 30-day rolling average vs prior 30d for each hub
  const kpis = useMemo(() => {
    const sorted = [...priceRecords].sort((a, b) => b.date.localeCompare(a.date));
    const recent = sorted.slice(0, 30);
    const prior  = sorted.slice(30, 60);
    const avg = (rows, hub) => {
      const vals = rows.map(r => r[hub]).filter(v => v != null && !isNaN(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    return Object.keys(HUB_META).map(hub => ({
      hub,
      current: avg(recent, hub),
      prior:   avg(prior,  hub),
    }));
  }, [priceRecords]);

  // ── Styles ───────────────────────────────────────────────────────────────────
  const btnStyle = (active, color = '#388bfd') => ({
    padding: '3px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
    fontFamily: 'DM Mono, monospace', fontWeight: active ? 600 : 400,
    border: `1px solid ${active ? color : 'var(--border)'}`,
    background: active ? color + '22' : 'transparent',
    color: active ? color : 'var(--text-muted)',
    transition: 'all 0.15s',
  });

  const fetchBtnStyle = (color) => ({
    padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
    fontFamily: 'Syne, sans-serif', fontWeight: 600,
    border: `1px solid ${color}`, background: color + '22', color,
  });

  const hasData = priceRecords.length > 0;

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (!hasData) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 420, gap: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 44 }}>💲</div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 20 }}>No price data loaded</div>
        <div style={{ color: 'var(--text-muted)', maxWidth: 420, lineHeight: 1.6, fontSize: 13 }}>
          Fetch STTM and DWGM price files from AEMO, or upload them below.
          You can select both files at once.
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={fetchBoth} disabled={loading.sttm || loading.dwgm} style={fetchBtnStyle('#388bfd')}>
            {(loading.sttm || loading.dwgm) ? 'Fetching…' : '⬇ Fetch STTM + DWGM from AEMO'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <StatusBadge ok={loaded.sttm} label="STTM" />
          <StatusBadge ok={loaded.dwgm} label="DWGM" />
        </div>
        {error.sttm && <div style={{ color: '#f85149', fontSize: 12 }}>STTM: {error.sttm}</div>}
        {error.dwgm && <div style={{ color: '#f85149', fontSize: 12 }}>DWGM: {error.dwgm}</div>}

        <label style={fetchBtnStyle('#bc8cff')}>
          ↑ Load prices
          <input type="file" accept=".xlsx,.xls" multiple onChange={handlePriceFiles} style={{ display: 'none' }} />
        </label>
      </div>
    );
  }

  // ── Loaded state ─────────────────────────────────────────────────────────────
  const priceFmt = v => v != null ? `$${v.toFixed(2)}/GJ` : '—';
  const yearLegend = selectedYears.map(y => ({ color: YEAR_COLORS[y] || '#888', label: String(y) }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Top bar: status + controls ──────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <StatusBadge ok={loaded.sttm} label="STTM" />
        <StatusBadge ok={loaded.dwgm} label="DWGM" />
        <div style={{ color: 'var(--text-dim)', fontSize: 11, fontFamily: 'DM Mono, monospace' }}>
          {priceRecords.length.toLocaleString()} daily records · {availableYears[0]}–{availableYears[availableYears.length - 1]}
        </div>

        {/* Refresh */}
        <button onClick={fetchBoth} disabled={loading.sttm || loading.dwgm}
          style={{ ...btnStyle(false, '#388bfd'), marginLeft: 'auto' }}>
          {loading.sttm || loading.dwgm ? 'Fetching…' : '⟳ Refresh'}
        </button>

        {/* Upload missing file */}
        {(!loaded.sttm || !loaded.dwgm) && (
          <label style={btnStyle(false, '#bc8cff')}>
            {!loaded.sttm && !loaded.dwgm ? '↑ Load prices' : !loaded.sttm ? '↑ Load STTM' : '↑ Load DWGM'}
            <input type="file" accept=".xlsx,.xls" multiple onChange={handlePriceFiles} style={{ display: 'none' }} />
          </label>
        )}

        {/* DWGM price method toggle */}
        {loaded.dwgm && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>DWGM price:</span>
            <button onClick={() => setUse6am(false)} style={btnStyle(!use6am, '#7c9ef8')}>Mean intervals</button>
            <button onClick={() => setUse6am(true)}  style={btnStyle(use6am,  '#7c9ef8')}>6am only (ASX ref)</button>
          </div>
        )}
      </div>

      {/* ── KPI Strip ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {kpis.map(({ hub, current, prior }) => {
          const delta = current != null && prior != null ? current - prior : null;
          const up    = delta != null && delta > 0;
          return (
            <KpiCard
              key={hub}
              label={`${HUB_META[hub].label} — 30d avg`}
              value={current != null ? `$${current.toFixed(2)}` : '—'}
              unit="/GJ"
              sub={delta != null
                ? `${up ? '▲' : '▼'} ${Math.abs(delta).toFixed(2)} vs prior 30d`
                : undefined}
              color={HUB_META[hub].color}
            />
          );
        })}
      </div>

      {/* ── YoY charts — 2×2 grid ───────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {[
          { hub: 'dwgm', data: yoyDwgm },
          { hub: 'syd',  data: yoySyd  },
          { hub: 'adl',  data: yoyAdl  },
          { hub: 'bri',  data: yoyBri  },
        ].map(({ hub, data }) => (
          <ChartCard
            key={hub}
            id={`chart-price-yoy-${hub}`}
            title={`${HUB_META[hub].label} — Year on Year`}
            subtitle={`Daily gas price ($/GJ) — ${HUB_META[hub].fullLabel}`}
            onExportPPT={() => exportToPowerPoint([{ id: `chart-price-yoy-${hub}`, title: `${HUB_META[hub].label} Gas Price YoY` }])}
          >
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="day" tickFormatter={dayLabel} ticks={MONTH_TICKS} {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} tickFormatter={v => `$${v.toFixed(0)}`} />
                <Tooltip content={
                  <CustomTooltip
                    formatter={v => `$${Number(v).toFixed(2)}/GJ`}
                    labelFormatter={dayLabel}
                  />
                } />
                {selectedYears.map(y => (
                  <Line key={y} type="monotone" dataKey={y} name={String(y)}
                    stroke={YEAR_COLORS[y] || '#888'}
                    strokeWidth={y === latestYear ? 2.5 : 1.5}
                    dot={false} connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <Legend items={yearLegend} />
          </ChartCard>
        ))}
      </div>

      {/* ── Hub price spread ────────────────────────────────────────────────── */}
      <ChartCard
        id="chart-price-spread"
        title="Hub Price Spread"
        subtitle="All four hubs on a single chart — shows inter-market spread and basis relationships ($/GJ)"
        onExportPPT={() => exportToPowerPoint([{ id: 'chart-price-spread', title: 'Gas Hub Price Spread' }])}
      >
        {/* Year selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>Year:</span>
          {availableYears.map(y => (
            <button key={y} onClick={() => setSpreadYear(y)} style={btnStyle(spreadYear === y, YEAR_COLORS[y] || '#888')}>
              {y}
            </button>
          ))}
          <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>Show:</span>
          {Object.keys(HUB_META).map(hub => (
            <button key={hub}
              onClick={() => setVisibleHubs(prev => ({ ...prev, [hub]: !prev[hub] }))}
              style={btnStyle(visibleHubs[hub], HUB_META[hub].color)}>
              {HUB_META[hub].label}
            </button>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={spreadData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" tickFormatter={fmtDate}
              interval={Math.max(1, Math.floor(spreadData.length / 12))} {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => `$${v.toFixed(0)}`} />
            <Tooltip content={
              <CustomTooltip formatter={v => `$${Number(v).toFixed(2)}/GJ`} labelFormatter={fmtDate} />
            } />
            {Object.keys(HUB_META).map(hub => visibleHubs[hub] && (
              <Line key={hub} type="monotone" dataKey={hub} name={HUB_META[hub].label}
                stroke={HUB_META[hub].color} strokeWidth={2} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <Legend items={Object.entries(HUB_META)
          .filter(([hub]) => visibleHubs[hub])
          .map(([, m]) => ({ color: m.color, label: m.fullLabel }))} />
      </ChartCard>

      {/* ── Price spike counter ──────────────────────────────────────────────── */}
      <ChartCard
        id="chart-price-spikes"
        title="High-Price Days by Year"
        subtitle={`Number of days each hub exceeded the threshold ($/GJ)`}
        onExportPPT={() => exportToPowerPoint([{ id: 'chart-price-spikes', title: 'Gas Price Spike Frequency' }])}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>Threshold:</span>
          {SPIKE_THRESHOLDS.map(t => (
            <button key={t} onClick={() => setSpikeThreshold(t)} style={btnStyle(spikeThreshold === t, '#ffa657')}>
              ${t}/GJ
            </button>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={spikeData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="year" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => `${v}d`} />
            <Tooltip content={
              <CustomTooltip formatter={(v, name) => `${v} days`} />
            } />
            {Object.entries(HUB_META).map(([hub, m]) => (
              <Bar key={hub} dataKey={hub} name={m.label} fill={m.color} fillOpacity={0.8} stackId="a" />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={Object.entries(HUB_META).map(([, m]) => ({ color: m.color, label: m.label }))} />
      </ChartCard>

      {/* ── DWGM price vs demand overlay ────────────────────────────────────── */}
      {loaded.dwgm && dwgmOverlay.length > 0 && (
        <ChartCard
          id="chart-dwgm-demand-price"
          title={`DWGM Price vs Demand — ${spreadYear || latestYear}`}
          subtitle="Dual-axis: daily DWGM gas price ($/GJ, left) overlaid on total DWGM demand (TJ/day, right)"
          onExportPPT={() => exportToPowerPoint([{ id: 'chart-dwgm-demand-price', title: 'DWGM Price vs Demand' }])}
        >
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={dwgmOverlay} margin={{ top: 8, right: 48, bottom: 0, left: 8 }}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="date" tickFormatter={fmtDate}
                interval={Math.max(1, Math.floor(dwgmOverlay.length / 12))} {...AXIS_STYLE} />
              <YAxis yAxisId="price" orientation="left"
                {...AXIS_STYLE} tickFormatter={v => `$${v.toFixed(0)}`} />
              <YAxis yAxisId="demand" orientation="right"
                {...AXIS_STYLE} tickFormatter={v => `${Math.round(v)}`} />
              <Tooltip content={
                <CustomTooltip
                  formatter={(v, name) => name === 'Price' ? `$${Number(v).toFixed(2)}/GJ` : `${Math.round(v)} TJ`}
                  labelFormatter={fmtDate}
                />
              } />
              <Area yAxisId="demand" type="monotone" dataKey="demand" name="Total Demand"
                fill="#7c9ef822" stroke="#7c9ef8" strokeWidth={1} />
              <Line yAxisId="price" type="monotone" dataKey="price" name="Price"
                stroke="#e6a817" strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
          <Legend items={[
            { color: '#e6a817', label: 'DWGM Price ($/GJ) — left axis' },
            { color: '#7c9ef8', label: 'DWGM Total Demand (TJ/day) — right axis' },
          ]} />
        </ChartCard>
      )}

    </div>
  );
}
