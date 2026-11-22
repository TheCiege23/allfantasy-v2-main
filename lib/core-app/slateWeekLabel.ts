/**
 * The top bar's week chip: "NFL WK 9", "NCAAF PRE WK 1".
 *
 * ⚠ WEEK 0 IS NOT A WEEK. College basketball and other sports without a weekly slate store 0,
 * and the chip read "NCAAB WK 0" on live /core (2026-11-05), which looks broken rather than
 * informative. A week below 1 is no chip at all, the same answer as an unknown week.
 *
 * Client-safe: no prisma, no 'server-only'.
 */
export function slateWeekLabel(
  sport: string,
  slate: string | null | undefined,
  week: number | null | undefined,
): string | null {
  if (week == null || !Number.isFinite(week) || week < 1) return null
  const phase = slate === 'pre' ? ' PRE' : slate === 'post' ? ' POST' : ''
  return `${sport}${phase} WK ${week}`
}
