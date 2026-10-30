import type { PrismaClient } from '@prisma/client'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { readRiScheduleWindow } from '@/lib/sports-data/riScheduleCache'
import { bridgeNcaabCampusTeams, bridgeRiNcaabTeams } from '@/lib/redraft/ncaabCampusTeamBridge'
import { refreshEspnCollegeGameBoxes } from '@/lib/espn/refreshNcaabCollegeGameBoxes'

export const nbaCampusGameMappingKey = (season: number, week: number) => `c2c:nba:games:${season}:${week}`
type Db = Pick<PrismaClient, 'sportsDataCache' | 'teamProviderIdentity'>

/** Refresh only schools with a saved campus lineup, bounded by the worker's deadline. */
export async function refreshNbaCampusWeek(db: Db, input: { season: number; week: number; now: Date; deadlineAt: number; maxEvents: number }) {
  const window = resolveDailySportWeekWindow('NBA', input.season, input.week)
  if (!window) return { skipped: 'unknown NBA week' }
  const snapshots = await db.sportsDataCache.findMany({ where: { cacheKey: { startsWith: 'c2c:nba:weekly:', endsWith: `:${input.season}:${input.week}` }, expiresAt: { gt: input.now } }, select: { data: true } })
  const espnTeams = new Set<string>()
  for (const row of snapshots) {
    const data = row.data as { season?: unknown; week?: unknown; players?: Array<{ id?: unknown; espnId?: unknown; teamId?: unknown }> } | null
    if (data?.season !== input.season || data.week !== input.week || !Array.isArray(data.players)) continue
    for (const p of data.players) if (typeof p.espnId === 'string' && typeof p.id === 'string' && p.id === `espn:ncaab:${p.espnId}` && /^\d+$/.test(p.espnId) && typeof p.teamId === 'string' && /^\d+$/.test(p.teamId)) espnTeams.add(p.teamId)
  }
  if (!espnTeams.size) return { skipped: 'no campus starters' }
  const [schedule, teamBridge] = await Promise.all([
    readRiScheduleWindow(db as never, { sport: 'NCAAB', season: input.season, window }),
    bridgeNcaabCampusTeams(db, [...espnTeams]),
  ])
  if (!schedule) return { skipped: 'college schedule unavailable' }
  const riTeams = new Set(teamBridge.resolved.values())
  const games = schedule.filter(g => riTeams.has(g.homeTeamId ?? '') || riTeams.has(g.awayTeamId ?? ''))
  const allRi = [...new Set(games.flatMap(g => [g.homeTeamId, g.awayTeamId]).filter((x): x is string => Boolean(x)))]
  const inverse = await bridgeRiNcaabTeams(db, allRi)
  const refresh = await refreshEspnCollegeGameBoxes(db, { games, espnForRi: inverse.resolved, now: input.now, deadlineAt: input.deadlineAt, maxEvents: input.maxEvents })
  if (refresh.error === 'deadline' || refresh.error === 'scoreboard unavailable' || refresh.error === 'incomplete scoreboard' || refresh.error === 'invalid schedule') return { skipped: refresh.error, blocked: refresh.blocked }
  const mappings = games.flatMap(g => {
    const eventId = refresh.matched.get(g.gameId)
    return eventId ? [{ gameId: g.gameId, eventId, day: g.day, homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId }] : []
  })
  const key = nbaCampusGameMappingKey(input.season, input.week)
  const data = toPrismaJsonInput({ season: input.season, week: input.week, mappings, observedAt: input.now.toISOString() })
  const expiresAt = new Date(input.now.getTime() + 730 * 24 * 60 * 60 * 1000)
  await db.sportsDataCache.upsert({ where: { cacheKey: key }, create: { cacheKey: key, data, expiresAt }, update: { data, expiresAt } })
  return { schools: espnTeams.size, unresolvedSchools: teamBridge.unresolved.length, games: games.length, matched: mappings.length, unresolvedGames: refresh.unresolved.length, boxesStored: refresh.stored, boxesRemaining: refresh.remaining, blocked: refresh.blocked }
}
