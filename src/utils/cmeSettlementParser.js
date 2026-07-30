// utils/cmeSettlementParser.js
//
// CME Group's settlement pages (e.g. cmegroup.com/.../lng-japan-korea-marker-
// platts-swap.settlements.html and .../brent-crude-oil.settlements.html) are
// client-side rendered and not reliably fetchable cross-origin, so this
// module parses the table when the user copies it from the page and pastes
// it in — rather than guessing at an unverified scraping endpoint.
//
// It's intentionally tolerant of layout: CME's settlement tables generally
// have a header row containing "Month" and a settlement-price column, but
// the exact column set/order varies by product and over time. We detect the
// header row and the most likely settlement-price column, rather than
// assuming fixed positions.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function splitCells(line) {
  return line.split(/\t+|,|\s{2,}/).map(c => c.trim()).filter(c => c !== '');
}

/** Parse a contract-month token into 'YYYY-MM'. Handles "AUG 2026", "AUG26",
 * "AUG-26", "2026-08", "08/2026", "Aug 2026" etc. Returns null if unparseable. */
export function parseContractMonth(token) {
  if (!token) return null;
  const t = token.trim();

  // YYYY-MM or YYYY/MM
  let m = t.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}`;

  // MM-YYYY or MM/YYYY
  m = t.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[2]}-${String(+m[1]).padStart(2, '0')}`;

  // "AUG 2026", "AUG-2026", "AUG2026", "AUG26", "AUG-26", "AUGUST 2026"
  m = t.match(/^([a-zA-Z]{3,9})[\s-]?(\d{2,4})$/);
  if (m) {
    const monKey = m[1].slice(0, 3).toLowerCase();
    const mon = MONTHS[monKey];
    if (!mon) return null;
    let year = Number(m[2]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return `${year}-${String(mon).padStart(2, '0')}`;
  }
  return null;
}

/**
 * Guess the Settle column index when there's no header row, by recognising
 * CME's standard futures-table layout: Month, Open, High, Low, Last, Change,
 * Settle, Est. Volume, Prior day OI. Open/High/Low/Last are usually "-" for
 * forward months with no trades, and Change is a signed value immediately
 * before Settle — so "first numeric column" alone would wrongly grab Change.
 * Returns -1 if the layout doesn't match (caller falls back to first-numeric).
 */
function guessSettleColNoHeader(row) {
  if (row.length < 7) return -1;
  const isDashOrBlank = c => c === '-' || c === '';
  const isSignedNumber = c => /^[+-]/.test(c) && !isNaN(parseFloat(c));
  const isPlainNumber = c => !isNaN(parseFloat(c)) && parseFloat(c) >= 0 && !/^[+-]/.test(c);
  // Columns 1-4 (Open/High/Low/Last) blank, column 5 a signed Change, column 6 the Settle value
  if ([1, 2, 3, 4].every(i => isDashOrBlank(row[i])) && isSignedNumber(row[5]) && isPlainNumber(row[6])) {
    return 6;
  }
  return -1;
}

/**
 * Parse pasted CME settlement-table text into [{month:'YYYY-MM', settle:number}],
 * sorted ascending. Throws with a helpful message if no usable rows are found.
 */
export function parseCmePasteText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('No text pasted.');

  let headerIdx = -1;
  let cells = [];
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    cells = splitCells(lines[i]);
    if (cells.some(c => /^month$/i.test(c))) { headerIdx = i; break; }
  }

  let settleCol = -1;
  if (headerIdx >= 0) {
    // Prefer an exact "settle" column, then "prior settle", then "last"/"close"
    settleCol = cells.findIndex(c => /^settle$/i.test(c));
    if (settleCol === -1) settleCol = cells.findIndex(c => /settle/i.test(c));
    if (settleCol === -1) settleCol = cells.findIndex(c => /^(last|close)$/i.test(c));
  } else {
    // No header — try to recognise the standard CME layout from the first
    // plausible data row (month token in column 0).
    for (const line of lines) {
      const row = splitCells(line);
      if (row.length >= 2 && parseContractMonth(row[0])) {
        settleCol = guessSettleColNoHeader(row);
        break;
      }
    }
  }

  const dataStart = headerIdx >= 0 ? headerIdx + 1 : 0;
  const out = [];
  const skipped = [];

  for (let i = dataStart; i < lines.length; i++) {
    const row = splitCells(lines[i]);
    if (row.length < 2) { skipped.push(lines[i]); continue; }
    const month = parseContractMonth(row[0]);
    if (!month) { skipped.push(lines[i]); continue; }

    let value = null;
    if (settleCol >= 1 && settleCol < row.length) {
      const v = parseFloat(row[settleCol].replace(/,/g, ''));
      if (!isNaN(v)) value = v;
    }
    if (value == null) {
      // Fall back: first numeric-looking token after the month
      for (let c = 1; c < row.length; c++) {
        const v = parseFloat(row[c].replace(/,/g, ''));
        if (!isNaN(v)) { value = v; break; }
      }
    }
    if (value == null) { skipped.push(lines[i]); continue; }
    out.push({ month, settle: value });
  }

  if (!out.length) {
    throw new Error('Could not find any rows with a recognisable contract month + price. Make sure you copied the settlement table including its header row.');
  }

  // De-dupe by month (keep last occurrence, in case the paste has repeated headers/rows)
  const byMonth = new Map();
  for (const r of out) byMonth.set(r.month, r.settle);
  const deduped = [...byMonth.entries()].map(([month, settle]) => ({ month, settle })).sort((a, b) => a.month.localeCompare(b.month));

  return { rows: deduped, skippedCount: skipped.length };
}
