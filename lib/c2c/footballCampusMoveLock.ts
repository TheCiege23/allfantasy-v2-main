/**
 * The per-player kickoff lock on an NFL C2C campus lineup (owner's decision, 2026-11-24): a college player
 * cannot be moved into or out of the campus lineup once his school's game in this NFL week has kicked off.
 * The football twin of `nbaCampusMoveLock`.
 *
 * Schools come from the CFBD player pool (`SportsPlayer.college`, lib/ncaaf/cfbdRosterPool.ts) and games
 * from the CFBD schedule (`SportsGame` source `cfbd`); both carry CFBD's own school names, so a school
 * matches a game by name. Fails CLOSED like the NBA lock: a player whose school is unknown, or whose
 * school has a game with no usable time, cannot be moved, because "could not check" must never read as
 * "has not started".
 */
import { normalizeGameStatus } from '@/lib/sports/gameStatus'

export type CampusFootballGame = { homeTeam: string | null; awayTeam: string | null; startTime: Date | string | null; status: string | null }

const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase()

export function footballCampusMoveLock(input: {
  changedPlayerIds: readonly string[]
  schoolForPlayer: ReadonlyMap<string, string>
  /** This NFL week's college games (the college weeks `loadCfbWeeksForNflWeek` places in it); null when unreadable. */
  games: readonly CampusFootballGame[] | null
  now: Date
}): { lockedPlayerIds: string[]; unknownPlayerIds: string[] } {
  const lockedPlayerIds: string[] = []
  const unknownPlayerIds: string[] = []
  for (const playerId of new Set(input.changedPlayerIds)) {
    const school = norm(input.schoolForPlayer.get(playerId))
    if (!school || !input.games) { unknownPlayerIds.push(playerId); continue }
    // No game this week for his school (a bye, or the season is over): nothing to lock.
    const games = input.games.filter((g) => (norm(g.homeTeam) === school || norm(g.awayTeam) === school) && normalizeGameStatus(g.status) !== 'cancelled')
    let locked = false
    let unknown = false
    for (const game of games) {
      const status = normalizeGameStatus(game.status)
      if (status === 'live' || status === 'final') { locked = true; continue }
      const kickoff = game.startTime ? new Date(game.startTime).getTime() : NaN
      if (!Number.isFinite(kickoff)) { unknown = true; continue }
      if (kickoff <= input.now.getTime()) locked = true
    }
    if (locked) lockedPlayerIds.push(playerId)
    else if (unknown) unknownPlayerIds.push(playerId)
  }
  return { lockedPlayerIds, unknownPlayerIds }
}
