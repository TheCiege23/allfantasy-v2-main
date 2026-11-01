import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import type { ScheduleGame } from '@/lib/sports-data/riScheduleCache'

export type EspnCollegeGame = { id: string; day: string; homeTeamId: string; awayTeamId: string; startTime: string; status: 'scheduled' | 'live' | 'final' | 'unknown' }
const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {}

/** Parse the scoreboard without treating malformed or duplicate events as a complete slate. */
export function parseEspnCollegeScoreboard(body: unknown): { games: EspnCollegeGame[]; rejected: number } {
  const rawEvents = obj(body).events
  if (!Array.isArray(rawEvents)) return { games: [], rejected: 1 }
  const games: EspnCollegeGame[] = []
  const ids = new Set<string>()
  let rejected = 0
  for (const raw of rawEvents) {
    const event = obj(raw)
    const id = String(event.id ?? '')
    const startTime = String(event.date ?? '')
    const date = new Date(startTime)
    const day = Number.isFinite(date.getTime()) ? easternCalendarDay(date)?.toISOString().slice(0, 10) : null
    const competitions = Array.isArray(event.competitions) ? event.competitions : []
    const competition = obj(competitions[0])
    const teams = Array.isArray(competition.competitors) ? competition.competitors : []
    const home = teams.filter((x: any) => x?.homeAway === 'home')
    const away = teams.filter((x: any) => x?.homeAway === 'away')
    const homeTeamId = String(obj(obj(home[0]).team).id ?? '')
    const awayTeamId = String(obj(obj(away[0]).team).id ?? '')
    if (!/^\d+$/.test(id) || ids.has(id) || !day || competitions.length !== 1 || teams.length !== 2 || home.length !== 1 || away.length !== 1 || !/^\d+$/.test(homeTeamId) || !/^\d+$/.test(awayTeamId) || homeTeamId === awayTeamId) { rejected++; continue }
    ids.add(id)
    const state = obj(obj(competition.status).type).state
    const status = state === 'post' ? 'final' : state === 'in' ? 'live' : state === 'pre' ? 'scheduled' : 'unknown'
    games.push({ id, day, homeTeamId, awayTeamId, startTime, status })
  }
  return { games, rejected }
}

/** Cross-check the RI schedule by date and both provider school IDs; refuse ties. */
export function matchCollegeScheduleGames(riGames: readonly ScheduleGame[], espnGames: readonly EspnCollegeGame[], espnForRi: ReadonlyMap<string, string>): { matched: Map<string, string>; unresolved: string[] } {
  const candidates = new Map<string, string[]>()
  for (const game of riGames) {
    const home = game.homeTeamId ? espnForRi.get(game.homeTeamId) : null
    const away = game.awayTeamId ? espnForRi.get(game.awayTeamId) : null
    const matches = home && away ? espnGames.filter((e) => e.day === game.day && e.homeTeamId === home && e.awayTeamId === away).map((e) => e.id) : []
    candidates.set(game.gameId, matches)
  }
  const claims = new Map<string, number>()
  for (const ids of candidates.values()) if (ids.length === 1) claims.set(ids[0]!, (claims.get(ids[0]!) ?? 0) + 1)
  const matched = new Map<string, string>()
  const unresolved: string[] = []
  for (const [id, ids] of candidates) if (ids.length === 1 && claims.get(ids[0]!) === 1) matched.set(id, ids[0]!); else unresolved.push(id)
  return { matched, unresolved }
}
