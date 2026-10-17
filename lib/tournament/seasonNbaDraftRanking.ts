import type { SeasonDraftPlayer } from './seasonDraftPolicy'

/** A fallback for autodraft only: measured prior-season NBA points per game, never ADP or a projection. */
export function rankNbaDraftPoolFromPriorSeason(players: SeasonDraftPlayer[], rows: unknown[]) {
  const scores = new Map<string, number>()
  const ambiguous = new Set<string>()
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    const id = String(row.player_id ?? '').trim()
    const regular = row.regular_season
    if (!/^\d+$/.test(id) || !regular || typeof regular !== 'object' || Array.isArray(regular)) continue
    const stats = regular as Record<string, unknown>
    const games = Number(stats.games_played), points = Number(stats.points)
    if (!Number.isInteger(games) || games <= 0 || !Number.isFinite(points) || points < 0) continue
    if (scores.has(id)) { ambiguous.add(id); continue }
    scores.set(id, points / games)
  }
  for (const id of ambiguous) scores.delete(id)
  const eligible = players.filter(player => player.draftIdProvenance?.namespace === 'rolling_insights' && /^\d+$/.test(player.playerId) && scores.has(player.playerId))
  eligible.sort((a, b) => scores.get(b.playerId)! - scores.get(a.playerId)! || a.playerId.localeCompare(b.playerId))
  const rankById = new Map(eligible.map((player, index) => [player.playerId, index + 1]))
  return { players: players.map(player => ({ ...player, rank: rankById.get(player.playerId) ?? player.rank ?? null })), rankedPlayers: rankById.size }
}
