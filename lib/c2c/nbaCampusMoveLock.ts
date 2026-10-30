import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import type { ScheduleGame } from '@/lib/sports-data/riScheduleCache'

/** Reject a campus move when its school has already started a game, or the slate cannot prove it safe. */
export function nbaCampusMoveLock(input: { changedPlayerIds: readonly string[]; teamForPlayer: ReadonlyMap<string, string>; games: readonly ScheduleGame[] | null; now: Date }): { lockedPlayerIds: string[]; unknownPlayerIds: string[] } {
  const lockedPlayerIds: string[] = [], unknownPlayerIds: string[] = []
  for (const playerId of new Set(input.changedPlayerIds)) {
    const teamId = input.teamForPlayer.get(playerId)
    if (!teamId || !input.games || input.games.some(g => !g.homeTeamId || !g.awayTeamId)) { unknownPlayerIds.push(playerId); continue }
    const games = input.games.filter(g => (g.homeTeamId === teamId || g.awayTeamId === teamId) && normalizeGameStatus(g.status) !== 'cancelled')
    let unknown = false, locked = false
    for (const game of games) {
      const status = normalizeGameStatus(game.status)
      if (status === 'live' || status === 'final') { locked = true; continue }
      if (status === 'unknown') { unknown = true; continue }
      const kickoff = game.startTime ? new Date(game.startTime).getTime() : NaN
      if (!Number.isFinite(kickoff)) { unknown = true; continue }
      if (kickoff <= input.now.getTime()) locked = true
    }
    if (locked) lockedPlayerIds.push(playerId)
    else if (unknown) unknownPlayerIds.push(playerId)
  }
  return { lockedPlayerIds, unknownPlayerIds }
}
