import type { PrismaClient } from '@prisma/client'
import type { ScheduleGame } from '@/lib/sports-data/riScheduleCache'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { EspnBlockedError, fetchEspnCollegeScoreboard } from './espnNcaabFetch'
import { matchCollegeScheduleGames, type EspnCollegeGame } from './espnNcaabScoreboard'
import { ESPN_COLLEGE_BOX_KEY_PREFIX, ingestEspnCollegeBoxes } from './ingestNcaabCollegeBoxes'
import type { EspnCollegeBoxScore } from './espnNcaabBoxScore'

type Db = Pick<PrismaClient, 'sportsDataCache'>
type Scoreboard = { games: EspnCollegeGame[]; rejected: number }

/** A bounded refresh over a preselected, trusted RI slate. Never map a game by name. */
export async function refreshEspnCollegeGameBoxes(db: Db, input: {
  games: readonly ScheduleGame[]
  espnForRi: ReadonlyMap<string, string>
  now: Date
  deadlineAt: number
  maxEvents: number
  fetchScoreboard?: (day: string) => Promise<Scoreboard>
  fetchBox?: (id: string) => Promise<EspnCollegeBoxScore>
}) {
  const games = input.games.filter(g => normalizeGameStatus(g.status) !== 'cancelled')
  const days = [...new Set(games.map(g => g.day))].sort()
  if (days.length > 7 || games.some(g => !g.gameId || !g.homeTeamId || !g.awayTeamId)) return { matched: new Map<string, string>(), unresolved: games.map(g => g.gameId), stored: 0, remaining: 0, blocked: false, error: 'invalid schedule' }
  const espn: EspnCollegeGame[] = []
  for (const day of days) {
    if (Date.now() >= input.deadlineAt) return { matched: new Map<string, string>(), unresolved: games.map(g => g.gameId), stored: 0, remaining: games.length, blocked: false, error: 'deadline' }
    try {
      const result = await (input.fetchScoreboard ?? fetchEspnCollegeScoreboard)(day)
      if (result.rejected) return { matched: new Map<string, string>(), unresolved: games.map(g => g.gameId), stored: 0, remaining: games.length, blocked: false, error: 'incomplete scoreboard' }
      espn.push(...result.games)
    } catch (err) {
      return { matched: new Map<string, string>(), unresolved: games.map(g => g.gameId), stored: 0, remaining: games.length, blocked: err instanceof EspnBlockedError, error: 'scoreboard unavailable' }
    }
  }
  const mapping = matchCollegeScheduleGames(games, espn, input.espnForRi)
  const finalIds = games.filter(g => normalizeGameStatus(g.status) === 'final').map(g => mapping.matched.get(g.gameId)).filter((id): id is string => Boolean(id))
  const cached = finalIds.length ? await db.sportsDataCache.findMany({ where: { cacheKey: { in: finalIds.map(id => `${ESPN_COLLEGE_BOX_KEY_PREFIX}${id}`) }, expiresAt: { gt: input.now } }, select: { cacheKey: true, data: true } }) : []
  const complete = new Set(cached.filter(r => { const v = r.data as { complete?: boolean; status?: string; eventId?: string } | null; return v?.complete === true && v.status === 'final' && r.cacheKey === `${ESPN_COLLEGE_BOX_KEY_PREFIX}${v.eventId}` }).map(r => r.cacheKey.slice(ESPN_COLLEGE_BOX_KEY_PREFIX.length)))
  const pending = finalIds.filter(id => !complete.has(id))
  const result = await ingestEspnCollegeBoxes(db, { eventIds: pending, deadlineAt: input.deadlineAt, maxEvents: input.maxEvents, now: input.now, fetchBox: input.fetchBox })
  return { ...mapping, stored: result.stored, remaining: Math.max(0, pending.length - result.stored), blocked: result.blocked, error: result.errors || result.rejected ? 'box unavailable' : null }
}
