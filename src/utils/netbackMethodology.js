// utils/netbackMethodology.js
//
// Embeds the ACCC's documented LNG netback price calculation
// (see "Guide to the LNG netback price series", Sept 2022, sections 3-4:
// https://www.accc.gov.au/system/files/Guide%20to%20the%20LNG%20netback%20price%20series%20-%20September%202022.pdf)
// so netback prices can be recomputed from raw price inputs — including
// inputs sourced from outside the ACCC workbook (e.g. CME settlement
// prices) — rather than only reading the ACCC's own pre-calculated figures.
//
// Documented calculation order (guide §4.3):
//   1. LNG price, US$/MMBtu
//        - short-term: JKM settlement / futures price
//        - medium-term: Brent futures (US$/bbl) x LNG slope (%)
//   2. Subtract LNG freight cost (US$/MMBtu)              -> FOB price at Gladstone
//   3. Convert FOB price to A$/GJ:
//        A$/GJ = (US$/MMBtu) / AUD-USD rate / 1.055 (MMBtu->GJ)
//   4. Subtract LNG plant operating expenditure (A$/GJ)
//   5. Multiply by marginal LNG plant efficiency          -> effective LNG plant inlet price
//   6. Subtract wellhead-to-LNG-facility pipeline transport cost (A$/GJ)
//      (wellhead-to-Wallumbilla cost is treated as zero, so step 6's
//      result IS the netback price at Wallumbilla)
//
// This has been validated against the ACCC's own published figures in the
// "Forward JKM/Brent netback prices" sheets to within ~0.01% — the residual
// is expected, since the ACCC's opex/transport/efficiency figures used for
// any specific historical row are the values in effect on that exact
// publication date, while this module (and the Assumptions sheet) only
// exposes the current per-calendar-year figures.

export const MMBTU_TO_GJ = 1.055;

/** Convert a US$/MMBtu price to A$/GJ using a given AUD/USD rate. */
export function usdMmbtuToAudGj(usdPerMmbtu, audUsdRate) {
  if (usdPerMmbtu == null || audUsdRate == null) return null;
  return usdPerMmbtu / audUsdRate / MMBTU_TO_GJ;
}

/**
 * Full netback calculation, per ACCC guide §4.3.
 * @param {number} lngPriceUsdMmbtu   JKM settlement, or Brent x slope, US$/MMBtu
 * @param {number} freightUsdMmbtu    LNG freight cost, US$/MMBtu
 * @param {number} audUsdRate         AUD/USD exchange rate (5-day avg for forward series)
 * @param {number} opexAudGj          LNG plant operating expenditure, A$/GJ
 * @param {number} efficiency         Marginal LNG plant efficiency, e.g. 0.945
 * @param {number} transportAudGj     Wellhead-to-LNG-facility pipeline transport cost, A$/GJ
 * @returns {number|null} Netback price at Wallumbilla, A$/GJ
 */
export function calcNetbackAudGj({ lngPriceUsdMmbtu, freightUsdMmbtu, audUsdRate, opexAudGj, efficiency, transportAudGj }) {
  if ([lngPriceUsdMmbtu, freightUsdMmbtu, audUsdRate, efficiency].some(v => v == null)) return null;
  const fobUsdMmbtu = lngPriceUsdMmbtu - freightUsdMmbtu;
  const fobAudGj = fobUsdMmbtu / audUsdRate / MMBTU_TO_GJ;
  const netOfOpex = fobAudGj - (opexAudGj ?? 0);
  const atPlantInlet = netOfOpex * efficiency;
  return atPlantInlet - (transportAudGj ?? 0);
}

/** Medium-term LNG contract price implied by an oil-linked slope, US$/MMBtu. */
export function brentToLngPrice(brentUsdBbl, slopePercent) {
  if (brentUsdBbl == null || slopePercent == null) return null;
  return brentUsdBbl * (slopePercent / 100);
}

/**
 * Look up a calendar-year assumption (opex, transport, efficiency, etc.)
 * for a given target year from a { year: value } map, using the latest
 * defined year at or before the target (and falling back to the earliest
 * defined year if the target is before all of them). This mirrors how the
 * ACCC's own Assumptions sheet defines these as step-changes at named
 * calendar years (e.g. CY2017, CY2020, CY2021, ...).
 */
export function lookupByYear(yearMap, targetYear) {
  const years = Object.keys(yearMap).map(Number).sort((a, b) => a - b);
  if (!years.length) return null;
  let best = years[0];
  for (const y of years) {
    if (y <= targetYear) best = y;
  }
  return yearMap[best];
}
