// utils/brentSpotParser.js
//
// Parses the EIA "Europe Brent Spot Price FOB" daily CSV (dnav/pet/hist/rbrted)
// into a clean daily + monthly series. Used to backfill the Brent-linked
// netback history from 1 Jan 2015 up to the ACCC workbook's own Brent data
// start (currently Aug 2022), since the ACCC file has no forward Brent
// futures data before that date.
//
// Note this is a genuine methodological approximation, not just a data
// splice: the ACCC's medium-term netback uses a forward-looking annualised
// Brent FUTURES strip, whereas this backfill uses contemporaneous monthly-
// average Brent SPOT price as a stand-in (futures data this far back isn't
// available from any source in this app), combined with the earliest
// available LNG slope/freight/efficiency assumptions held flat backward
// (those also aren't available before the ACCC series starts). The result
// is clearly kept in a separate field from the ACCC-sourced series so it's
// never visually confused with the real, forward-looking netback.

const HEADER_ROW_RE = /^day\s*,/i;

/** Parse "07/27/2026" or "7/9/2026" -> 'YYYY-MM-DD'. */
function parseUsDate(text) {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mo, da, yr] = m;
  return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
}

/**
 * Parse the raw EIA CSV text into a daily series: [{date, price}], sorted
 * ascending. Skips the metadata lines above the header automatically.
 */
export function parseBrentSpotCsvText(text) {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex(l => HEADER_ROW_RE.test(l));
  const dataLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;

  const out = [];
  for (const line of dataLines) {
    if (!line.trim()) continue;
    const [rawDate, rawPrice] = line.split(',');
    const date = parseUsDate(rawDate || '');
    const price = parseFloat(rawPrice);
    if (!date || isNaN(price)) continue;
    out.push({ date, price });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** Aggregate a daily series into monthly averages: [{month, value}]. */
export function monthlyAverageBrent(dailySeries) {
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

export async function parseBrentSpotFile(file) {
  const text = await file.text();
  const daily = parseBrentSpotCsvText(text);
  return { daily, monthly: monthlyAverageBrent(daily) };
}

export async function fetchBrentSpotFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const daily = parseBrentSpotCsvText(text);
  return { daily, monthly: monthlyAverageBrent(daily) };
}
