// utils/gshBenchmarkParser.js
//
// Parses AEMO's daily GSH (Gas Supply Hub) Benchmark Price report
// (nemweb.com.au/Reports/Current/GSH/Benchmark_Price/PUBLIC_WALLUMBILLABENCHMARKPRICE_YYYYMMDD.zip)
// into a clean daily + monthly Wallumbilla spot price series.
//
// Each daily zip contains the FULL history back to March 2014 (not just
// that day), so a single successful fetch is enough — no need to walk
// back through hundreds of daily files.
//
// File format is AEMO's standard "I"/"D" record-marker CSV:
//   C,... (header/footer metadata, ignored)
//   I,GSH,BENCHMARK_PRICE,1,GAS_DATE,PRODUCT_LOCATION,PRODUCT_TYPE,BENCHMARK_PRICE,IS_FIRM,LASTCHANGED
//   D,GSH,BENCHMARK_PRICE,1,"2026/07/30 00:00:00",WAL,"Gas - NG DA Days",11.50,1,"2026/07/29 19:30:08"
//
// Wallumbilla trading was consolidated from three separate pipeline
// locations into a single "WAL" location under AEMO's Optional Hub
// Services model from 28 March 2017; before that, "WALLUMBILLA" is the
// combined location. IS_FIRM=0 rows are same-day preliminary previews
// (published before the ~7:30pm firm finalisation) and are excluded.

const WAL_TRANSITION_DATE = '2017-03-28';

function parseAemoDate(text) {
  // "2026/07/30 00:00:00" -> "2026-07-30"
  const m = text.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Minimal CSV line splitter handling quoted fields (AEMO CSVs quote dates/strings). */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Parse the raw AEMO GSH benchmark price CSV text into a clean daily
 * Wallumbilla series: [{date:'YYYY-MM-DD', price:number}], sorted ascending.
 */
export function parseGshBenchmarkCsvText(text) {
  const lines = text.split(/\r?\n/);
  const byDate = new Map();
  for (const line of lines) {
    if (!line.startsWith('D,')) continue;
    const cols = splitCsvLine(line);
    // cols: [D, GSH, BENCHMARK_PRICE, 1, GAS_DATE, PRODUCT_LOCATION, PRODUCT_TYPE, BENCHMARK_PRICE, IS_FIRM, LASTCHANGED]
    const gasDateRaw = cols[4];
    const location = cols[5];
    const price = parseFloat(cols[7]);
    const isFirm = cols[8];
    if (isFirm !== '1') continue; // skip same-day non-firm preview rows
    const date = parseAemoDate(gasDateRaw);
    if (!date || isNaN(price)) continue;

    const useThisLocation = date < WAL_TRANSITION_DATE ? location === 'WALLUMBILLA' : location === 'WAL';
    if (!useThisLocation) continue;

    byDate.set(date, price); // one row per date/location combo in the source, no averaging needed
  }
  return [...byDate.entries()].map(([date, price]) => ({ date, price })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Aggregate a daily series into monthly averages: [{month:'YYYY-MM', value:number}]. */
export function monthlyAverage(dailySeries) {
  const byMonth = new Map();
  for (const { date, price } of dailySeries) {
    const month = date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(price);
  }
  return [...byMonth.entries()]
    .map(([month, prices]) => ({ month, value: prices.reduce((a, b) => a + b, 0) / prices.length }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Parse a GSH Benchmark Price zip (ArrayBuffer) into daily + monthly series.
 */
export async function parseGshBenchmarkZip(arrayBuffer) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(arrayBuffer);
  const csvName = Object.keys(zip.files).find(f => f.toLowerCase().endsWith('.csv'));
  if (!csvName) throw new Error('No CSV found inside the GSH benchmark price zip.');
  const text = await zip.files[csvName].async('string');
  const daily = parseGshBenchmarkCsvText(text);
  const monthly = monthlyAverage(daily);
  return { daily, monthly, fileName: csvName };
}

function ymdCompact(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Fetch the latest available GSH Benchmark Price zip via the app's AEMO
 * proxy, trying today then walking back a few days (the file for "today"
 * may not be published yet, e.g. early morning, or nemweb may be a day
 * behind over a weekend). Since each file contains the FULL history, only
 * one successful fetch is needed — this is not a historical backfill loop.
 */
export async function fetchLatestGshBenchmark(maxDaysBack = 6) {
  const today = new Date();
  const errors = [];
  for (let back = 0; back <= maxDaysBack; back++) {
    const d = new Date(today);
    d.setDate(d.getDate() - back);
    const dateStr = ymdCompact(d);
    const url = `/aemo-proxy/Reports/Current/GSH/Benchmark_Price/PUBLIC_WALLUMBILLABENCHMARKPRICE_${dateStr}.zip`;
    try {
      const res = await fetch(url);
      if (!res.ok) { errors.push(`${dateStr}: HTTP ${res.status}`); continue; }
      const buf = await res.arrayBuffer();
      const result = await parseGshBenchmarkZip(buf);
      return { ...result, sourceDate: dateStr, url };
    } catch (e) {
      errors.push(`${dateStr}: ${e.message}`);
    }
  }
  throw new Error(`Could not fetch a recent GSH Benchmark Price file (tried ${maxDaysBack + 1} days back). ${errors.join('; ')}`);
}
