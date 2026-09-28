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
 * ⚠ TANKING'S MEDIUM IS PINNED TO THE PREVIOUS HARDCODED BEHAVIOUR (a bench gap of
 * `>= 5`). `medium` is the column default, so every existing league is on it.
 *
 * ⚠ COLLUSION'S IS NOT, ON PURPOSE. Its old trigger was `valueDifferentialPct >= 35`
 * on the scan's private value scale. On 2026-09-27 the scan was converted to run the
 * trade review, and its sensitivity now picks review flags by severity — see
 * `COLLUSION_MIN_SEVERITY`. That is a behaviour change for every league, and it is
 * the change that was asked for: one engine, so the scan cannot disagree with the
 * review panel about the same trade.
 */

export type IntegritySensitivity = 'low' | 'medium' | 'high'

export const INTEGRITY_SENSITIVITIES: readonly IntegritySensitivity[] = ['low', 'medium', 'high']

export function normalizeSensitivity(value: unknown): IntegritySensitivity {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return v === 'low' || v === 'high' ? v : 'medium'
}

/**
 * Collusion: which of the trade review's own flags open an integrity flag.
 *
 * ⚠ NOT A THRESHOLD, AND THAT IS THE POINT (2026-09-27). This used to be a value-gap
 * percentage on the scan's private value scale, so a commissioner's review panel and
 * the post-trade scan could disagree about the same trade. The scan now runs the
 * review itself (`lib/decision-os/trade/tradeReview.ts`), whose checks and severities
 * are fixed in code; sensitivity only chooses how serious a raised check must be to
 * open a case. Every level therefore sees exactly the flags the panel shows.
 *
 * Mirrors `ReviewSeverity` rather than importing it: this file stays import-free
 * (see the header).
 */
type ReviewSeverityLike = 'low' | 'medium' | 'high'

export const COLLUSION_MIN_SEVERITY: Record<IntegritySensitivity, ReviewSeverityLike> = {
  low: 'high',
  medium: 'medium',
  high: 'low',
}

const SEVERITY_RANK: Record<ReviewSeverityLike, number> = { low: 1, medium: 2, high: 3 }

/** The raised review flags serious enough, at this sensitivity, to open a collusion flag. */
export function collusionFlagsAtSensitivity<F extends { severity: ReviewSeverityLike }>(
  flags: readonly F[],
  level: IntegritySensitivity,
): F[] {
  const floor = SEVERITY_RANK[COLLUSION_MIN_SEVERITY[level]]
  return flags.filter((f) => SEVERITY_RANK[f.severity] >= floor)
}

/**
 * Projected points a bench player must beat a starter by before that slot counts
 * as a suspicious lineup decision. `medium: 5` matches the previous hardcoded
 * gap.
 *
 * A LOWER number is MORE sensitive. "High = catches more" is what the commissioner
 * is choosing between, for both controls.
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
  const floor = COLLUSION_MIN_SEVERITY[level]
  if (floor === 'high') return 'Low flags a trade only for a heavily lopsided value gap or, in a one-season league, a tanking signal.'
  if (floor === 'medium') {
    return 'Medium flags a heavily lopsided value gap, a tanking signal, a dynasty or keeper rebuild, repeat partners who all lean one way, an inactive manager, or an eliminated team sending starters to a contender.'
  }
  return 'High flags every trade review flag, including a lopsided trade rushed in just before the deadline.'
}

export function describeTankingSensitivity(level: IntegritySensitivity): string {
  const pts = TANKING_BENCH_GAP_POINTS[level]
  const label = level === 'low' ? 'Low' : level === 'high' ? 'High' : 'Medium'
  return `${label} counts a slot as suspicious once a bench option out-projects the starter by ${pts} points.`
}
