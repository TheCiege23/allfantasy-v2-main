import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import type { ScheduleGame } from '@/lib/sports-data/riScheduleCache'
import type { EspnCollegeBoxScore } from '@/lib/espn/espnNcaabBoxScore'

export type EspnCampusPlayer = { id: string; espnId: string; espnTeamId: string; riTeamId: string; position: string }
export type EspnCampusScore = { playerId: string; points: number; missing: boolean; allFinal: boolean }

/** Score provider-ID matched ESPN boxes against the verified RI schedule in the NBA week. */
export function scoreEspnCampusEvidence(input: {
  players: readonly EspnCampusPlayer[]
  games: readonly ScheduleGame[] | null
  eventForGame: ReadonlyMap<string, string>
  boxes: ReadonlyMap<string, EspnCollegeBoxScore>
  scheduleCoversWindow: boolean
  windowClosed: boolean
  scorer: (stats: Record<string, number>, position: string) => number
}): EspnCampusScore[] {
  return input.players.map((player) => {
    if (!input.games || !input.scheduleCoversWindow || input.games.some(g => !g.gameId || !g.homeTeamId || !g.awayTeamId) || !player.espnId || !player.espnTeamId || !player.riTeamId) return { playerId: player.id, points: 0, missing: true, allFinal: false }
    const games = input.games.filter(g => (g.homeTeamId === player.riTeamId || g.awayTeamId === player.riTeamId) && normalizeGameStatus(g.status) !== 'cancelled')
    let total = 0, missing = false
    for (const game of games) {
      const eventId = input.eventForGame.get(game.gameId)
      const box = eventId ? input.boxes.get(eventId) : null
      if (!box || box.eventId !== eventId || box.status !== 'final' || !box.complete || box.rejected !== 0) { missing = true; continue }
      const lines = box.players.filter(p => p.espnId === player.espnId)
      if (lines.length !== 1 || lines[0]!.teamId !== player.espnTeamId) { missing = true; continue }
      const line = lines[0]!
      if (line.didNotPlay) continue
      if (!line.stats || Object.values(line.stats).some(v => typeof v !== 'number' || !Number.isFinite(v))) { missing = true; continue }
      total += input.scorer(line.stats, player.position)
    }
    return { playerId: player.id, points: Math.round(total * 100) / 100, missing, allFinal: input.windowClosed && !missing && games.every(g => normalizeGameStatus(g.status) === 'final') }
  })
}
