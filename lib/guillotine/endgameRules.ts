export type GuillotineEndgameFormat = 'last_team_standing' | 'final_four' | 'final_three' | 'final_two'
const thresholds = { last_team_standing: 1, final_two: 2, final_three: 3, final_four: 4 } as const
export function resolveGuillotineEndgame(league: { settings?: unknown; guillotineEndgame?: string | null }) {
  const settings = league.settings as Record<string, unknown> | null
  const nested = (settings?.eliminationSettings ?? settings?.elimination_settings) as Record<string, unknown> | undefined
  const setup = (settings?.conceptSetup ?? settings?.concept_setup) as Record<string, unknown> | undefined
  const guillotine = (setup?.guillotine ?? setup) as Record<string, unknown> | undefined
  const raw = settings?.guillotineEndgame ?? guillotine?.endgame ?? nested?.endgame ?? settings?.endgame ?? league.guillotineEndgame
  const format: GuillotineEndgameFormat = typeof raw === 'string' && Object.hasOwn(thresholds, raw) ? raw as GuillotineEndgameFormat : 'last_team_standing'
  return { format, threshold: thresholds[format], cumulativePeriods: format === 'last_team_standing' ? 0 : 3 }
}

/**
 * The champion of a cumulative final, once every final period is scored.
 *
 * ⚠ A TIED FINAL USED TO WAIT FOR A COMMISSIONER WHO HAD NO WAY TO ANSWER: nothing in the app could
 * settle it, so the season sat in its final stage forever. Given `seasonTotals` (each finalist's
 * points for the whole season), a tie goes to the higher season total — the same measure the chop
 * tiebreak uses, a real result rather than an invented one. Only a tie on that too stays unresolved.
 */
export function resolveCumulativeFinalWinner(
  rosterIds: string[], start: number, completedPeriod: number, periods: number,
  scores: Array<{ rosterId: string; weekOrPeriod: number; periodPoints: number }>,
  seasonTotals?: ReadonlyMap<string, number>,
): string | null {
  if (!rosterIds.length || completedPeriod < start + periods - 1) return null
  const totals = rosterIds.map(rosterId => {
    const rows = scores.filter(row => row.rosterId === rosterId && row.weekOrPeriod >= start && row.weekOrPeriod < start + periods)
    if (new Set(rows.map(row => row.weekOrPeriod)).size !== periods || rows.some(row => !Number.isFinite(row.periodPoints))) return null
    return { rosterId, points: rows.reduce((sum, row) => sum + row.periodPoints, 0) }
  })
  if (totals.some(row => row === null)) return null
  const ordered = totals.filter(row => row !== null).sort((a, b) => b.points - a.points)
  if (ordered.length === 1 || ordered[0]!.points > ordered[1]!.points) return ordered[0]!.rosterId
  if (!seasonTotals) return null
  const tied = ordered.filter(row => row.points === ordered[0]!.points)
    .map(row => ({ rosterId: row.rosterId, season: seasonTotals.get(row.rosterId) }))
  if (tied.some(row => typeof row.season !== 'number' || !Number.isFinite(row.season))) return null
  tied.sort((a, b) => b.season! - a.season!)
  return tied[0]!.season! > tied[1]!.season! ? tied[0]!.rosterId : null
}
