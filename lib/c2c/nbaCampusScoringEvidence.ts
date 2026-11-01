import { aggregateWeeklyStats, getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import type { ScheduleGame } from '@/lib/sports-data/riScheduleCache'

type CampusPlayer = { id: string; identityId: string; riTeamId: string; position: string }
type StatRow = { playerId: string; providerGameId: string | null; normalizedStatMap: unknown }
export type CampusBasketballPlayerScore = { playerId: string; points: number; missing: boolean; allFinal: boolean }

/** Score only rows belonging to the player's verified school games in the NBA week.
 * A missing stat in a scheduled game is withheld, never inferred to be zero. */
export function scoreBasketballCampusEvidence(input: {
  players: readonly CampusPlayer[]
  games: readonly ScheduleGame[] | null
  stats: readonly StatRow[]
  windowClosed: boolean
  scheduleCoversWindow: boolean
  scorer: (stats: Record<string, number>, position: string) => number
}): CampusBasketballPlayerScore[] {
  const normalizer = getDailySportNormalizer('NCAAB')!
  return input.players.map((player) => {
    if (!input.games || !input.scheduleCoversWindow || input.games.some((g) => !g.gameId || !g.homeTeamId || !g.awayTeamId) || !player.identityId || !player.riTeamId) return { playerId: player.id, points: 0, missing: true, allFinal: false }
    const games = input.games.filter((game) => (game.homeTeamId === player.riTeamId || game.awayTeamId === player.riTeamId) && normalizeGameStatus(game.status) !== 'cancelled')
    const matchingIds = new Set(games.map((game) => game.gameId))
    const rows = input.stats.filter((row) => row.playerId === player.identityId && row.providerGameId && matchingIds.has(row.providerGameId))
    const rowsByGame = new Map<string, StatRow[]>()
    for (const row of rows) rowsByGame.set(row.providerGameId!, [...(rowsByGame.get(row.providerGameId!) ?? []), row])
    // A stat line on a different scheduled school game may mean the athlete transferred.
    // Historical team evidence cannot safely attribute it, so withhold finalization.
    let missing = input.stats.some((row) => row.playerId === player.identityId && row.providerGameId && !matchingIds.has(row.providerGameId))
    let total = 0
    for (const game of games) {
      const gameRows = rowsByGame.get(game.gameId) ?? []
      if (gameRows.length !== 1) { missing = true; continue }
      const aggregate = aggregateWeeklyStats([gameRows[0]!.normalizedStatMap], normalizer)
      if (aggregate.gamesCounted !== 1) { missing = true; continue }
      total += input.scorer(aggregate.stats, player.position)
    }
    const allFinal = input.windowClosed && !missing && games.every((game) => normalizeGameStatus(game.status) === 'final')
    return { playerId: player.id, points: Math.round(total * 100) / 100, missing, allFinal }
  })
}
