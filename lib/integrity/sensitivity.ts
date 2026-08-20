/**
 * Integrity sensitivity — the single source of truth shared by the detection
 * engines and the commissioner-facing settings rail.
 *
 * ⚠ THIS MODULE EXISTS BECAUSE THE SETTINGS WERE INERT. `LeagueIntegritySettings`
 * has stored `collusionSensitivity`, `tankingSensitivity`, `tankingStartWeek`
 * and the three tanking sub-rule booleans since the table was created, and the
 * `PUT` handler has always saved them — but neither engine ever read anything
 * except `tankingMonitorEnabled`. A commissioner could set sensitivity to High,
 * see it persist across reloads, and get exactly the same flags as Low.
 *
 * ⚠ NO IMPORTS. Deliberately dependency-free (no `server-only`, no prisma) so the
 * client settings rail can import the same constants the server scans with. That
 * is the whole point: handoff 11c build rule 5 says a sensitivity control always
 * ships with the plain-language threshold it maps to, and the only way that
 * sentence stays true is if the label and the engine read one number. If this
 * file ever grows a server-only import, the UI silently forks from the engine
 * and the promise on screen becomes a guess.
 *
 * ⚠ MEDIUM IS PINNED TO THE PREVIOUS HARDCODED BEHAVIOUR. `medium` is the column
 * default, so every existing league is on it. Collusion's trigger was a bare
 * `valueDifferentialPct >= 35` and tanking's bench gap was a bare `>= 5`; medium
 * reproduces both exactly. Wiring these settings up therefore changes nothing
 * for any league that never touched the control, and only does something for a
 * commissioner who deliberately moved it.
 */

export type IntegritySensitivity = 'low' | 'medium' | 'high'

export const INTEGRITY_SENSITIVITIES: readonly IntegritySensitivity[] = ['low', 'medium', 'high']

export function normalizeSensitivity(value: unknown): IntegritySensitivity {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return v === 'low' || v === 'high' ? v : 'medium'
}

/**
 * Percentage by which the two sides of a trade must differ, measured against the
 * larger side, before the trade is flagged for review.
 *
 * `medium: 35` is the number the engine used unconditionally before this module
 * existed — see the file header.
 */
export const COLLUSION_VALUE_GAP_PCT: Record<IntegritySensitivity, number> = {
  low: 50,
  medium: 35,
  high: 25,
}

/**
 * Projected points a bench player must beat a starter by before that slot counts
 * as a suspicious lineup decision. `medium: 5` matches the previous hardcoded
 * gap.
 *
 * A LOWER number is MORE sensitive, which is the opposite direction from the
 * collusion table above reading top to bottom — both are "high = catches more",
 * which is what the commissioner is choosing between.
 */
export const TANKING_BENCH_GAP_POINTS: Record<IntegritySensitivity, number> = {
  low: 9,
  medium: 5,
  high: 3,
}

/**
 * The sentence rendered directly beneath the sensitivity control. Generated from
 * the same constants the engine scans with, so it cannot drift into a claim the
 * product does not honour.
 */
export function describeCollusionSensitivity(level: IntegritySensitivity): string {
  const pct = COLLUSION_VALUE_GAP_PCT[level]
  const label = level === 'low' ? 'Low' : level === 'high' ? 'High' : 'Medium'
  return `${label} flags a trade once the two sides differ by about ${pct}% of the larger side.`
}

export function describeTankingSensitivity(level: IntegritySensitivity): string {
  const pts = TANKING_BENCH_GAP_POINTS[level]
  const label = level === 'low' ? 'Low' : level === 'high' ? 'High' : 'Medium'
  return `${label} counts a slot as suspicious once a bench option out-projects the starter by ${pts} points.`
}
