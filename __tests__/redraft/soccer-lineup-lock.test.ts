import { describe, expect, it } from 'vitest'
import { buildWeekKickoffMap, hydrateRedraftLineupLocks } from '@/lib/redraft/lineupLock'
import { scheduleKeyPrefix, type ScheduleGame } from '@/lib/sports-data/riScheduleCache'
import { dailySportWeekForInstant, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'

const prefix = scheduleKeyPrefix('SOCCER', 2026)
const games: ScheduleGame[] = [
  { gameId: 'gap', day: '2026-09-25', startTime: '2026-09-25T19:00:00Z', status: 'scheduled',
    seasonType: 'regular', eventName: null, replacedBy: null, homeTeam: 'Wrong window', awayTeam: 'Other', homeTeamId: '7', awayTeamId: '8' },
  { gameId: 'correct', day: '2026-10-10', startTime: '2026-10-10T15:00:00Z', status: 'scheduled',
    seasonType: 'regular', eventName: null, replacedBy: null, homeTeam: 'Club Seven', awayTeam: 'Club Nine', homeTeamId: '7', awayTeamId: '9' },
  { gameId: 'name-only', day: '2026-10-11', startTime: '2026-10-11T15:00:00Z', status: 'scheduled',
    seasonType: 'regular', eventName: null, replacedBy: null, homeTeam: 'Club Ten', awayTeam: 'Club Eleven' },
]

function db(slate: ScheduleGame[] | null = games) {
  const byKey = new Map<string, ScheduleGame[]>()
  for (const g of slate ?? []) byKey.set(`${prefix}${g.day}`, [...(byKey.get(`${prefix}${g.day}`) ?? []), g])
  return { sportsDataCache: {
    findUnique: async ({ where }: { where: { cacheKey: string } }) => slate && where.cacheKey === `${prefix}meta` ? { data: {} } : null,
    findMany: async ({ where }: { where: { cacheKey: { in: string[] } } }) =>
      where.cacheKey.in.filter((key) => byKey.has(key)).map((key) => ({ cacheKey: key, data: { games: byKey.get(key) } })),
  } } as never
}

describe('soccer gameweek lineup lock', () => {
  it('uses the curated gameweek after the international break and RI club IDs', async () => {
    const map = await buildWeekKickoffMap(db(), { sport: 'SOCCER', season: 2026, week: 7 })
    expect(map.byTeam.get('7')?.toISOString()).toBe('2026-10-10T15:00:00.000Z')
    expect(map.byTeam.has('CLUB SEVEN')).toBe(false)
    expect(map.byTeam.has('CLUB TEN')).toBe(false)
    const before = await hydrateRedraftLineupLocks(db(), { sport: 'SOCCER', season: 2026, week: 7,
      rosterId: 'r', leagueSettings: {}, now: new Date('2026-10-10T14:59:59Z'),
      players: [{ playerId: 'p7', team: '7' }, { playerId: 'p10', team: '10' }] })
    expect(before.players.map((p) => p.isLocked)).toEqual([false, false])
    const after = await hydrateRedraftLineupLocks(db(), { sport: 'SOCCER', season: 2026, week: 7,
      rosterId: 'r', leagueSettings: {}, now: new Date('2026-10-10T15:00:00Z'),
      players: [{ playerId: 'p7', team: '7' }, { playerId: 'p10', team: '10' }] })
    expect(after.players.map((p) => p.isLocked)).toEqual([true, false])
  })

  it('fails open with a warning when the season schedule is absent', async () => {
    const map = await buildWeekKickoffMap(db(null), { sport: 'SOCCER', season: 2026, week: 7 })
    expect(map.byTeam.size).toBe(0)
    expect(map.warnings.join(' ')).toMatch(/schedule is not synced/)
  })

  it('never converts a future soccer season into ordinary seven-day weeks', () => {
    expect(resolveDailySportWeekWindow('SOCCER', 2027, 1)).toBeNull()
    expect(dailySportWeekForInstant('SOCCER', 2027, new Date('2027-08-20T20:00:00Z'))).toBeNull()
  })
})
