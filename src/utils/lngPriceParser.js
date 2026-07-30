// utils/lngPriceParser.js
//
// Parses the ACCC "LNG netback price series - Public version" workbook
// (https://www.accc.gov.au/inquiries-and-consultations/gas-inquiry-2017-30/lng-netback-price-series)
// into chart-ready datasets:
//   1. JKM settlement prices (US$/MMBtu)      — historical (front-month) + latest forward curve
//   2. Brent Crude Year-1 futures (US$/bbl)   — monthly annualised strip, as published
//   3. AUD/USD exchange rate                  — daily
//   4. Netback price at Wallumbilla (A$/GJ)   — JKM netback (historical + forward) & Brent Year-1 netback
//
// The workbook layout is not officially documented, so parsing is done by
// locating header rows via keyword match rather than hardcoded row numbers,
// so small layout drift between bi-monthly releases doesn't break parsing.
// If a sheet or header can't be found, that series comes back empty and a
// warning is attached to `parsed.warnings` rather than throwing.

import * as XLSX from 'xlsx';
import { calcNetbackAudGj, brentToLngPrice, lookupByYear, MMBTU_TO_GJ } from './netbackMethodology';

const SHEET_ASSUMPTIONS = 'Assumptions';
const SHEET_JKM_FORWARD = 'Forward JKM netback prices';
const SHEET_BRENT_FORWARD = 'Forward Brent netback prices';

function ymd(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function ym(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function sheetToRows(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return null;
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
}

// Find the row index where every needle appears (case-insensitive, substring) somewhere in that row.
function findHeaderRow(rows, needles) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i] || [];
    const joined = row.map(c => (typeof c === 'string' ? c.toLowerCase() : '')).join(' | ');
    if (needles.every(n => joined.includes(n.toLowerCase()))) return i;
  }
  return -1;
}

function isDate(v) {
  return v instanceof Date && !isNaN(v);
}

// ── Sheet: Assumptions → daily AUD/USD ──────────────────────────────────────
function parseAudUsd(workbook, warnings) {
  const rows = sheetToRows(workbook, SHEET_ASSUMPTIONS);
  if (!rows) { warnings.push(`Sheet "${SHEET_ASSUMPTIONS}" not found`); return []; }
  const byDate = new Map(); // date -> { rates: [], avg5s: [] }
  for (const row of rows) {
    const date = row?.[0];
    if (!isDate(date)) continue;
    const daily = typeof row[1] === 'number' ? row[1] : null;
    const avg5 = typeof row[2] === 'number' ? row[2] : null;
    if (daily == null && avg5 == null) continue;
    const key = ymd(date);
    if (!byDate.has(key)) byDate.set(key, { rates: [], avg5s: [] });
    const bucket = byDate.get(key);
    if (daily != null) bucket.rates.push(daily);
    if (avg5 != null) bucket.avg5s.push(avg5);
  }

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  let duplicateDates = 0;
  const out = [];
  for (const [date, { rates, avg5s }] of byDate) {
    if (rates.length > 1 || avg5s.length > 1) duplicateDates++;
    out.push({
      date,
      rate: rates.length ? avg(rates) : null,
      avg5day: avg5s.length ? avg(avg5s) : null,
    });
  }
  if (duplicateDates) {
    warnings.push(`AUD/USD: ${duplicateDates} date(s) had duplicate rows in the source workbook (mostly Jan-Sep 2020) — averaged rather than plotted twice.`);
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// ── Sheet: Assumptions → LNG plant opex / pipeline transport by calendar year ──
// These appear as small side-tables: a header row with 2+ "CY 20xx" cells,
// followed immediately by one or more labelled data rows using the same
// columns. Located by keyword rather than fixed row/col so minor layout
// drift doesn't break parsing.
function parseCostAssumptions(workbook, warnings) {
  const rows = sheetToRows(workbook, SHEET_ASSUMPTIONS);
  if (!rows) return { opexByYear: {}, transportByYear: {}, efficiencyByYear: {} };

  const result = { opexByYear: {}, transportByYear: {}, efficiencyByYear: {} };
  const yearHeaderRe = /^cy\s*(\d{4})$/i;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const yearCols = {};
    row.forEach((cell, colIdx) => {
      const m = typeof cell === 'string' && cell.match(yearHeaderRe);
      if (m) yearCols[colIdx] = Number(m[1]);
    });
    if (Object.keys(yearCols).length < 2) continue; // not a year-header row

    // Consume following non-blank rows as data rows for this header block
    for (let j = i + 1; j < rows.length; j++) {
      const dataRow = rows[j] || [];
      const label = dataRow.find(c => typeof c === 'string' && c.trim());
      const hasYearHeaderToo = dataRow.some(c => typeof c === 'string' && yearHeaderRe.test(c));
      const anyNumeric = Object.keys(yearCols).some(c => typeof dataRow[c] === 'number');
      if (!label && !anyNumeric) break; // blank row -> end of this block
      if (hasYearHeaderToo) continue;   // duplicate header row above the data row itself
      if (typeof label === 'string' && anyNumeric) {
        const map = {};
        for (const [colIdx, year] of Object.entries(yearCols)) {
          const v = dataRow[colIdx];
          if (typeof v === 'number') map[year] = v;
        }
        const lc = label.toLowerCase();
        if (lc.includes('opex')) Object.assign(result.opexByYear, map);
        else if (lc.includes('transport')) Object.assign(result.transportByYear, map);
        else if (lc.includes('efficiency')) Object.assign(result.efficiencyByYear, map);
      }
    }
  }

  if (!Object.keys(result.opexByYear).length) warnings.push('LNG plant opex assumption table not found');
  if (!Object.keys(result.transportByYear).length) warnings.push('Pipeline transport cost assumption table not found');
  return result;
}

// ── Sheet: Forward JKM netback prices → settlement price + netback ─────────
// Columns (located dynamically): Date of quote | Contract month | Settlement
// price (US$/MMBtu) | ... | Netback price at Wallumbilla (A$/GJ)
function parseJkmForward(workbook, warnings) {
  const rows = sheetToRows(workbook, SHEET_JKM_FORWARD);
  if (!rows) { warnings.push(`Sheet "${SHEET_JKM_FORWARD}" not found`); return { curves: [], settleCol: -1, netbackCol: -1 }; }

  const headerIdx = findHeaderRow(rows, ['date of quote', 'contract month', 'settlement price']);
  if (headerIdx === -1) { warnings.push(`Header row not found in "${SHEET_JKM_FORWARD}"`); return { curves: [], settleCol: -1, netbackCol: -1 }; }

  const header = rows[headerIdx].map(c => (typeof c === 'string' ? c.toLowerCase() : ''));
  const quoteCol = 0; // "Date of quote" is always the first column of this table
  const contractCol = header.findIndex(h => h.includes('contract month'));
  const settleCol = header.findIndex(h => h.includes('settlement price'));
  const freightCol = header.findIndex(h => h.includes('estimated freight cost'));
  const audCol = header.findIndex(h => h.includes('aud/usd'));
  const effCol = header.findIndex(h => h.includes('marginal lng plant efficiency'));
  const netbackCol = header.findIndex((h, i) => h.includes('netback price at wallumbilla'));

  const curves = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const quoteDate = row[quoteCol];
    const contractMonth = row[contractCol];
    if (!isDate(quoteDate) || !isDate(contractMonth)) continue;
    curves.push({
      quoteDate,
      contractMonth,
      settlement: typeof row[settleCol] === 'number' ? row[settleCol] : null,
      freight: freightCol >= 0 && typeof row[freightCol] === 'number' ? row[freightCol] : null,
      audUsd: audCol >= 0 && typeof row[audCol] === 'number' ? row[audCol] : null,
      efficiency: effCol >= 0 && typeof row[effCol] === 'number' ? row[effCol] : null,
      netback: netbackCol >= 0 && typeof row[netbackCol] === 'number' ? row[netbackCol] : null,
    });
  }
  return { curves };
}

// Build a historical (front-month-at-quote-date) + forward (latest quote's
// full curve) series from the raw quote/contract-month grid, for a given
// value field ('settlement' or 'netback').
function buildHistoricalAndForward(curves, field) {
  if (!curves.length) return { historical: [], forward: [], latestQuoteDate: null };

  const byQuote = new Map();
  for (const row of curves) {
    const key = ymd(row.quoteDate);
    if (!byQuote.has(key)) byQuote.set(key, []);
    byQuote.get(key).push(row);
  }

  const quoteDates = [...byQuote.keys()].sort();
  const latestKey = quoteDates[quoteDates.length - 1];

  // Historical: front (earliest) contract month available at each quote date
  const historical = [];
  for (const key of quoteDates) {
    const curve = byQuote.get(key).slice().sort((a, b) => a.contractMonth - b.contractMonth);
    const front = curve[0];
    if (front && front[field] != null) {
      historical.push({ month: ym(front.contractMonth), value: front[field] });
    }
  }
  // De-dupe by month (keep the latest quote's reading for that month, since
  // it reflects the most up-to-date settlement for that contract period)
  const histMap = new Map();
  for (const h of historical) histMap.set(h.month, h.value);
  const historicalDeduped = [...histMap.entries()]
    .map(([month, value]) => ({ month, value }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Forward: full curve from the most recent quote date
  const latestCurve = (byQuote.get(latestKey) || []).slice().sort((a, b) => a.contractMonth - b.contractMonth);
  const forward = latestCurve
    .filter(r => r[field] != null)
    .map(r => ({ month: ym(r.contractMonth), value: r[field] }));

  return { historical: historicalDeduped, forward, latestQuoteDate: ymd(new Date(latestKey)) };
}

// ── Sheet: Forward Brent netback prices → Year-1 futures + Year-1 netback ──
function parseBrentForward(workbook, warnings) {
  const rows = sheetToRows(workbook, SHEET_BRENT_FORWARD);
  if (!rows) { warnings.push(`Sheet "${SHEET_BRENT_FORWARD}" not found`); return { futures: [], netback: [] }; }

  const headerIdx = findHeaderRow(rows, ['date of quote', 'year 1']);
  if (headerIdx === -1) { warnings.push(`Header row not found in "${SHEET_BRENT_FORWARD}"`); return { futures: [], netback: [] }; }

  const header = rows[headerIdx].map(c => (typeof c === 'string' ? c.toLowerCase() : ''));
  // First "Year 1" column after "date of quote" = Brent futures terminal (US$/bbl)
  const futuresCol = header.findIndex(h => h === 'year 1');
  const slopeCol = header.findIndex(h => h.includes('lng slope'));
  const effCol = header.findIndex(h => h.includes('marginal lng plant efficiency'));
  const audCol = header.findIndex(h => h.includes('aud/usd'));
  // Year-1..5 freight columns sit after "Date of estimate"; Year-1..5 netback
  // columns are the last 5 numeric columns of the row.
  const dateOfEstimateCol = header.findIndex(h => h.includes('date of estimate'));
  const freightStartCol = dateOfEstimateCol >= 0 ? dateOfEstimateCol + 1 : -1; // Year 1 freight
  // Last "Year 1" column = netback price at Wallumbilla (A$/GJ)
  let netbackCol = -1;
  for (let i = header.length - 1; i >= 0; i--) {
    if (header[i] === 'year 1') { netbackCol = i; break; }
  }

  const futures = [];
  const netback = [];
  const rawRows = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const quoteDate = row[0];
    if (!isDate(quoteDate)) continue;
    const month = ym(quoteDate);
    if (futuresCol >= 0 && typeof row[futuresCol] === 'number') {
      futures.push({ month, value: row[futuresCol] });
    }
    if (netbackCol >= 0 && netbackCol !== futuresCol && typeof row[netbackCol] === 'number') {
      netback.push({ month, value: row[netbackCol] });
    }
    rawRows.push({
      quoteDate,
      month,
      brentYear1: futuresCol >= 0 ? row[futuresCol] : null,
      slopePercent: slopeCol >= 0 ? row[slopeCol] : null,
      freightYear1: freightStartCol >= 0 ? row[freightStartCol] : null,
      freightByYear: freightStartCol >= 0 ? [0, 1, 2, 3, 4].map(k => row[freightStartCol + k]) : [],
      audUsd: audCol >= 0 ? row[audCol] : null,
      efficiency: effCol >= 0 ? row[effCol] : null,
      netbackYear1: netbackCol >= 0 ? row[netbackCol] : null,
    });
  }
  return { futures, netback, rawRows };
}

/**
 * Parse an ArrayBuffer (from fetch or file upload) into chart-ready datasets.
 */
export function parseLngWorkbook(arrayBuffer) {
  const warnings = [];
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });

  const audUsd = parseAudUsd(workbook, warnings);
  const costAssumptions = parseCostAssumptions(workbook, warnings);

  const { curves } = parseJkmForward(workbook, warnings);
  const jkmSettlement = buildHistoricalAndForward(curves, 'settlement');
  const jkmNetback = buildHistoricalAndForward(curves, 'netback');

  const brent = parseBrentForward(workbook, warnings);

  return {
    audUsd,
    costAssumptions,        // { opexByYear, transportByYear, efficiencyByYear }
    jkmSettlement,          // { historical: [{month,value}], forward: [{month,value}], latestQuoteDate }
    jkmNetback,             // same shape, A$/GJ
    jkmRawCurves: curves,   // [{quoteDate, contractMonth, settlement, freight, audUsd, efficiency, netback}]
    brentFutures: brent.futures,  // [{month, value}] US$/bbl
    brentNetback: brent.netback,  // [{month, value}] A$/GJ
    brentRawRows: brent.rawRows,  // [{quoteDate, month, brentYear1, slopePercent, freightYear1, audUsd, efficiency, netbackYear1}]
    parsedAt: new Date().toISOString(),
    warnings,
  };
}

/**
 * Merge the parsed series into recharts-ready arrays, one per chart, keyed
 * by calendar month (or day, for AUD/USD) so lines can share an X axis.
 */
export function buildChartDatasets(parsed) {
  const mergeByMonth = (series) => {
    const map = new Map();
    for (const [field, arr] of series) {
      for (const { month, value } of arr) {
        if (!map.has(month)) map.set(month, { month });
        map.get(month)[field] = value;
      }
    }
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  };

  const jkmChart = mergeByMonth([
    ['historical', parsed.jkmSettlement.historical],
    ['forward', parsed.jkmSettlement.forward],
  ]);

  const brentChart = parsed.brentFutures
    .slice()
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(r => ({ month: r.month, value: r.value }));

  const audChart = parsed.audUsd.map(r => ({ date: r.date, rate: r.rate, avg5day: r.avg5day }));

  const netbackChart = mergeByMonth([
    ['jkmHistorical', parsed.jkmNetback.historical],
    ['jkmForward', parsed.jkmNetback.forward],
    ['brentYear1', parsed.brentNetback],
  ]);

  const latest = {
    jkmSettlement: parsed.jkmSettlement.historical.at(-1)?.value ?? null,
    brentYear1: parsed.brentFutures.at(-1)?.value ?? null,
    audUsd: parsed.audUsd.at(-1)?.rate ?? null,
    jkmNetback: parsed.jkmNetback.historical.at(-1)?.value ?? null,
    brentNetback: parsed.brentNetback.at(-1)?.value ?? null,
    asOf: parsed.jkmSettlement.latestQuoteDate,
  };

  return { jkmChart, brentChart, audChart, netbackChart, latest };
}

/**
 * Recompute the JKM forward settlement + netback curve from an external
 * (e.g. CME) monthly price curve, using the ACCC's most recent freight /
 * AUD-USD / efficiency / opex / transport assumptions. This lets the JKM
 * curve be extended and refreshed daily using CME settlement data, without
 * relying on the ACCC's own pre-calculated netback figures.
 *
 * @param {object} parsed         Output of parseLngWorkbook
 * @param {{month:string, settle:number}[]} externalRows  From cmeSettlementParser
 */
export function recomputeJkmForward(parsed, externalRows) {
  if (!externalRows?.length) throw new Error('No JKM price rows to recompute from.');
  const byQuote = new Map();
  for (const r of parsed.jkmRawCurves) {
    const key = ymd(r.quoteDate);
    if (!byQuote.has(key)) byQuote.set(key, []);
    byQuote.get(key).push(r);
  }
  const quoteKeys = [...byQuote.keys()].sort();
  const latestKey = quoteKeys[quoteKeys.length - 1];
  const latestRows = (byQuote.get(latestKey) || []).slice().sort((a, b) => a.contractMonth - b.contractMonth);
  if (!latestRows.length) throw new Error('No ACCC JKM assumptions available to recompute from.');

  const freightByMonth = new Map(latestRows.map(r => [ym(r.contractMonth), r.freight]));
  const lastRow = latestRows[latestRows.length - 1];
  const fallbackFreight = lastRow.freight;
  const efficiency = lastRow.efficiency;
  const audUsd = parsed.audUsd.at(-1)?.avg5day ?? parsed.audUsd.at(-1)?.rate ?? lastRow.audUsd;

  const forward = [];
  const netbackForward = [];
  for (const { month, settle } of externalRows.slice().sort((a, b) => a.month.localeCompare(b.month))) {
    const year = Number(month.slice(0, 4));
    const usingExtrapolatedFreight = !freightByMonth.has(month);
    const freight = usingExtrapolatedFreight ? fallbackFreight : freightByMonth.get(month);
    const opex = lookupByYear(parsed.costAssumptions.opexByYear, year);
    const transport = lookupByYear(parsed.costAssumptions.transportByYear, year);
    const netback = calcNetbackAudGj({ lngPriceUsdMmbtu: settle, freightUsdMmbtu: freight, audUsdRate: audUsd, opexAudGj: opex, efficiency, transportAudGj: transport });
    forward.push({ month, value: settle, extrapolatedFreight: usingExtrapolatedFreight });
    netbackForward.push({ month, value: netback, extrapolatedFreight: usingExtrapolatedFreight });
  }
  return { forward, netbackForward, meta: { asOf: latestKey, audUsd, efficiency, fallbackFreight } };
}

/** Add `n` calendar months to a 'YYYY-MM' string. */
function addMonthsYm(yearMonth, n) {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Recompute an annualised Brent-linked netback term structure (Year 1, 2, 3, ...)
 * from an external (e.g. CME) monthly Brent futures curve, replicating the
 * ACCC's "simple average of each 12-month forward window" annualisation
 * (guide §3.1.3), then applying the LNG slope, freight, FX, opex, transport
 * and efficiency steps from the embedded methodology.
 *
 * Freight is only available from the ACCC file out to Year 5; years beyond
 * that hold the Year-5 freight estimate flat (clearly flagged in the result).
 *
 * @param {object} parsed
 * @param {{month:string, settle:number}[]} externalRows  Monthly Brent futures, from cmeSettlementParser
 * @param {{slopePercent?: number, maxYears?: number}} opts
 */
export function recomputeBrentTermStructure(parsed, externalRows, opts = {}) {
  if (!externalRows?.length) throw new Error('No Brent futures rows to recompute from.');
  const sorted = externalRows.slice().sort((a, b) => a.month.localeCompare(b.month));
  const byMonth = new Map(sorted.map(r => [r.month, r.settle]));
  const quoteMonth = sorted[0].month; // earliest pasted contract month = the current front month

  const lastRawRow = parsed.brentRawRows.at(-1);
  const slopePercent = opts.slopePercent ?? lastRawRow?.slopePercent;
  const audUsd = parsed.audUsd.at(-1)?.avg5day ?? parsed.audUsd.at(-1)?.rate ?? lastRawRow?.audUsd;
  const efficiency = lastRawRow?.efficiency;
  const freightByYear = lastRawRow?.freightByYear?.length ? lastRawRow.freightByYear : [null, null, null, null, null];
  const maxYears = opts.maxYears ?? 7;

  const years = [];
  for (let n = 1; n <= maxYears; n++) {
    const monthsInWindow = [];
    for (let k = 0; k < 12; k++) monthsInWindow.push(addMonthsYm(quoteMonth, (n - 1) * 12 + k));
    const values = monthsInWindow.map(m => byMonth.get(m)).filter(v => typeof v === 'number');
    if (!values.length) break; // no more data available at this horizon
    const avgBrentUsdBbl = values.reduce((a, b) => a + b, 0) / values.length;
    const usingExtrapolatedFreight = n > 5;
    const freight = usingExtrapolatedFreight ? freightByYear[4] : freightByYear[n - 1];
    const opex = lookupByYear(parsed.costAssumptions.opexByYear, Number(quoteMonth.slice(0, 4)) + n - 1);
    const transport = lookupByYear(parsed.costAssumptions.transportByYear, Number(quoteMonth.slice(0, 4)) + n - 1);
    const lngPriceUsdMmbtu = brentToLngPrice(avgBrentUsdBbl, slopePercent);
    const netbackAudGj = calcNetbackAudGj({ lngPriceUsdMmbtu, freightUsdMmbtu: freight, audUsdRate: audUsd, opexAudGj: opex, efficiency, transportAudGj: transport });
    years.push({
      year: n, avgBrentUsdBbl, lngPriceUsdMmbtu, netbackAudGj,
      monthsUsed: values.length, extrapolatedFreight: usingExtrapolatedFreight,
    });
  }

  return { years, meta: { quoteMonth, slopePercent, audUsd, efficiency } };
}

/**
 * Backfill the Brent-linked netback series before the ACCC workbook's own
 * Brent data starts (currently Aug 2022), using a monthly-average Brent
 * SPOT price series (e.g. from EIA) as a stand-in for the forward futures
 * strip ACCC itself uses, combined with the earliest available slope /
 * freight / efficiency / opex / transport assumptions held flat backward
 * (since none of those are available before the ACCC series starts either).
 *
 * This is a genuine approximation, not a like-for-like extension — kept
 * clearly documented and in its own result set so it's never conflated
 * with the ACCC's own forward-looking figures.
 *
 * @param {object} parsed          Output of parseLngWorkbook (audUsd should
 *                                 already be OFX-merged if applicable, so FX
 *                                 conversion for these early months is accurate)
 * @param {{month:string, value:number}[]} spotMonthly  Monthly-average Brent
 *                                 spot price, e.g. from brentSpotParser
 */
export function backfillBrentNetbackFromSpot(parsed, spotMonthly) {
  if (!parsed.brentRawRows?.length) throw new Error('No ACCC Brent assumptions available to backfill from.');
  if (!spotMonthly?.length) throw new Error('No Brent spot price rows to backfill from.');

  const firstRow = parsed.brentRawRows[0];
  const cutoffMonth = firstRow.month; // first month the ACCC's own Brent series covers
  const slopePercent = firstRow.slopePercent;
  const freight = firstRow.freightByYear?.[0] ?? firstRow.freightYear1;
  const efficiency = firstRow.efficiency;

  const audSums = new Map();
  for (const { date, rate } of parsed.audUsd || []) {
    const m = date.slice(0, 7);
    if (rate == null) continue;
    if (!audSums.has(m)) audSums.set(m, []);
    audSums.get(m).push(rate);
  }
  const audByMonth = new Map([...audSums.entries()].map(([m, arr]) => [m, arr.reduce((a, b) => a + b, 0) / arr.length]));

  const rows = [];
  let skippedNoFx = 0;
  for (const { month, value: avgBrentUsdBbl } of spotMonthly) {
    if (month >= cutoffMonth) continue; // only backfilling the gap before ACCC's own data
    const audUsdRate = audByMonth.get(month);
    if (audUsdRate == null) { skippedNoFx++; continue; }
    const year = Number(month.slice(0, 4));
    const opexAudGj = lookupByYear(parsed.costAssumptions.opexByYear, year);
    const transportAudGj = lookupByYear(parsed.costAssumptions.transportByYear, year);
    const lngPriceUsdMmbtu = brentToLngPrice(avgBrentUsdBbl, slopePercent);
    const netbackAudGj = calcNetbackAudGj({ lngPriceUsdMmbtu, freightUsdMmbtu: freight, audUsdRate, opexAudGj, efficiency, transportAudGj });
    rows.push({ month, avgBrentUsdBbl, lngPriceUsdMmbtu, netbackAudGj });
  }

  return {
    rows,
    meta: { cutoffMonth, slopePercent, freight, efficiency, skippedNoFx },
  };
}

/**
 * Attempt to fetch the workbook directly from a URL (will fail with a CORS
 * error in-browser unless accc.gov.au serves permissive CORS headers).
 */
export async function fetchLngWorkbook(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return parseLngWorkbook(buf);
}

/**
 * Parse a workbook from a File object (drag-and-drop / <input type=file>).
 */
export async function parseLngWorkbookFile(file) {
  const buf = await file.arrayBuffer();
  return parseLngWorkbook(buf);
}
