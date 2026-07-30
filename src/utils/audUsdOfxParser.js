// utils/audUsdOfxParser.js
//
// Parses a user-supplied OFX daily AUD/USD workbook (two columns: a plain
// text date like "January 4, 2015", and the AUD/USD rate — i.e. US$ per
// A$1, same convention as the ACCC workbook) into a clean daily series with
// a trailing 5-day average, for use as the primary FX source in place of
// the ACCC file's own AUD/USD data.

import * as XLSX from 'xlsx';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Parse "January 4, 2015" / "Jan 4 2015" / "4 January 2015" -> 'YYYY-MM-DD'. */
function parseLongDate(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();

  let m = t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/); // "January 4, 2015" / "January 4 2015"
  if (!m) m = t.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/); // "4 January 2015" (day/month swapped)
  let monthName, day, year;
  if (m && MONTHS[m[1].toLowerCase()]) { monthName = m[1]; day = m[2]; year = m[3]; }
  else if (m) { day = m[1]; monthName = m[2]; year = m[3]; }
  else return null;

  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(+day).padStart(2, '0')}`;
}

/**
 * Parse an OFX AUD/USD workbook ArrayBuffer into a clean, deduplicated daily
 * series with a trailing 5-day average.
 * @returns {{ series: {date:string, rate:number, avg5day:number}[], warnings:string[] }}
 */
export function parseOfxAudUsdWorkbook(arrayBuffer) {
  const warnings = [];
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { header: 1, raw: true, defval: null });

  const byDate = new Map(); // date -> [rates]
  let unparsed = 0;
  for (const row of rows) {
    if (!row || row.length < 2) continue;
    const [rawDate, rawRate] = row;
    const date = parseLongDate(rawDate);
    const rate = typeof rawRate === 'number' ? rawRate : parseFloat(rawRate);
    if (!date || isNaN(rate)) { unparsed++; continue; }
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(rate);
  }
  if (unparsed) warnings.push(`${unparsed} row(s) could not be parsed as a date + rate and were skipped.`);

  let duplicateDates = 0;
  const daily = [];
  for (const [date, rates] of byDate) {
    if (rates.length > 1) duplicateDates++;
    daily.push({ date, rate: rates.reduce((a, b) => a + b, 0) / rates.length });
  }
  if (duplicateDates) warnings.push(`${duplicateDates} date(s) appeared more than once in the source file — averaged.`);
  daily.sort((a, b) => a.date.localeCompare(b.date));

  // Trailing 5-entry average (ending on that day), matching the "5-day
  // average" convention used in the ACCC's own methodology — note this
  // averages the 5 most recent rows in this file (which may include
  // weekends), not strictly 5 business days.
  const series = daily.map((row, i) => {
    const window = daily.slice(Math.max(0, i - 4), i + 1);
    const avg5day = window.reduce((a, b) => a + b.rate, 0) / window.length;
    return { date: row.date, rate: row.rate, avg5day };
  });

  return { series, warnings };
}

export async function parseOfxAudUsdFile(file) {
  const buf = await file.arrayBuffer();
  return parseOfxAudUsdWorkbook(buf);
}

/**
 * Merge an OFX-sourced AUD/USD series (primary) with the ACCC workbook's own
 * AUD/USD series (used only to fill dates the OFX file doesn't cover, e.g.
 * the most recent months after the OFX extract was taken).
 */
export function mergeAudUsdSeries(ofxSeries, accAudUsd) {
  if (!ofxSeries?.length) return accAudUsd;
  const map = new Map(ofxSeries.map(r => [r.date, r]));
  const ofxMax = ofxSeries[ofxSeries.length - 1].date;
  for (const r of accAudUsd || []) {
    if (r.date > ofxMax && !map.has(r.date)) map.set(r.date, r);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
