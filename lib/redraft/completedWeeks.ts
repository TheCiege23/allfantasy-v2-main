/**
 * The weeks a commish may edit after the fact: completed REGULAR-SEASON weeks, newest first —
 * `1 <= week < currentWeek` and below the playoff start (playoff weeks live in RedraftPlayoffMatchup).
 * Shared by Edit Matchup Scores and the past-week lineup editor so the two cannot disagree.
 */
export function editableWeeks(currentWeek: number, playoffStartWeek: number | null): number[] {
  const last = Math.min(currentWeek - 1, (playoffStartWeek ?? Number.POSITIVE_INFINITY) - 1)
  return Array.from({ length: Math.max(0, last) }, (_, i) => last - i)
}
