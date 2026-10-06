/**
 * One rounding for every one-decimal percentage Your Week shows or exports.
 *
 * 🛑 `toFixed(1)` AND EXCEL DISAGREE ON A HALF. 55.55 is stored as 55.5499…, so `toFixed(1)` printed
 * "55.5%" on the page while Excel, rounding the same cell to one decimal, printed "55.6%" (HailShiva,
 * production 2026-10-06). Round once here, half away from zero on the decimal value, and write THIS
 * number into the workbook so the page, captions, card and spreadsheet all read the same figure.
 * Never returns -0, so a tiny negative change prints "0.0", not "-0.0".
 */
export function pct1(value: number): number {
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * 10 * (1 + Number.EPSILON)) / 10
  return Object.is(rounded, -0) ? 0 : rounded
}

export function formatPct1(value: number): string {
  return pct1(value).toFixed(1)
}

/**
 * A signed one-decimal figure, such as a points margin: "+1.2", "-1.2", and plain "0.0" when it rounds
 * to nothing. Rivalry Radar printed "-0.0" as a series' average margin (a 3–1 series, production
 * 2026-10-06), coloured as a loss.
 */
export function signOf1(value: number): 'pos' | 'neg' | 'zero' {
  const r = pct1(value)
  return r > 0 ? 'pos' : r < 0 ? 'neg' : 'zero'
}

export function formatSigned1(value: number): string {
  const r = pct1(value)
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}`
}
