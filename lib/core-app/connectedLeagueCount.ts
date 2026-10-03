/** Current leagues plus imported past seasons, when the dashboard count is known. */
export function connectedLeagueCount(
  d: { totalLeagues?: number | null; legacyCount?: number | null } | null | undefined,
): number | null {
  if (!d || d.totalLeagues == null) return null
  return d.totalLeagues + Math.max(0, d.legacyCount ?? 0)
}
