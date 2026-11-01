/** Pure, season-scoped movement plan. Higher rankOrder is the higher level. */
export type MovementStanding = {
  rosterId: string; leagueId: string; levelId: string
  wins: number; losses: number; ties: number; totalPoints: number
}
export type MovementLevel = { id: string; name: string; rankOrder: number; tierLabel?: string | null }
export type MovementPolicy = {
  promotionEnabled: boolean; relegationEnabled: boolean
  promotionCount: number; relegationCount: number
}
export function planUniverseMovement(
  standings: readonly MovementStanding[], levels: readonly MovementLevel[], policy: MovementPolicy,
) {
  const ordered = [...levels].sort((a, b) => a.rankOrder - b.rankOrder)
  if (new Set(ordered.map(l => l.id)).size !== ordered.length ||
      new Set(ordered.map(l => l.rankOrder)).size !== ordered.length) throw new Error('MOVEMENT_LEVELS_AMBIGUOUS')
  for (const count of [policy.promotionCount, policy.relegationCount]) {
    if (!Number.isInteger(count) || count < 0 || count > 5) throw new Error('MOVEMENT_COUNT_INVALID')
  }
  if (new Set(standings.map(r => r.rosterId)).size !== standings.length) throw new Error('MOVEMENT_ROSTERS_AMBIGUOUS')
  if (standings.some(r => !ordered.some(l => l.id === r.levelId) ||
      [r.wins, r.losses, r.ties, r.totalPoints].some(n => !Number.isFinite(n)) ||
      [r.wins, r.losses, r.ties].some(n => n < 0 || !Number.isInteger(n)))) throw new Error('MOVEMENT_STANDINGS_INVALID')
  const winPct = (r: MovementStanding) => (r.wins + r.ties / 2) / Math.max(1, r.wins + r.losses + r.ties)
  const ppw = (r: MovementStanding) => r.totalPoints / Math.max(1, r.wins + r.losses + r.ties)
  return ordered.flatMap((level, index) => {
    const rows = standings.filter(r => r.levelId === level.id).sort((a, b) =>
      winPct(b) - winPct(a) || ppw(b) - ppw(a) || a.rosterId.localeCompare(b.rosterId))
    return rows.map((row, i) => {
      const played = row.wins + row.losses + row.ties > 0
      const promote = played && policy.promotionEnabled && index < ordered.length - 1 && i < policy.promotionCount
      // Promotion wins an overlapping zone; one manager can never receive both decisions.
      const relegate = !promote && played && policy.relegationEnabled && index > 0 &&
        policy.relegationCount > 0 && i >= rows.length - policy.relegationCount
      const target = promote ? ordered[index + 1] : relegate ? ordered[index - 1] : level
      return { ...row, currentLevelId: level.id, projectedLevelId: target.id,
        fromTierLabel: level.tierLabel ?? level.name, toTierLabel: target.tierLabel ?? target.name,
        reason: promote ? 'promotion' : relegate ? 'relegation' : 'watch',
        finalTierRank: i + 1, winPct: winPct(row), pointsPerWeek: ppw(row) }
    })
  })
}
