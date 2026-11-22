import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ prisma: { playerGameStat: { findMany: vi.fn() } } }))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/season-week/deriveDailySportSeasonStart', () => ({ ensureDailySportSeasonStart: vi.fn(async () => undefined) }))
vi.mock('@/lib/season-week/dailySportSeasonStarts', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/season-week/dailySportSeasonStarts')>()),
  resolveDailySportWeekWindow: () => ({ start: new Date('2026-11-02T00:00:00Z'), end: new Date('2026-11-09T00:00:00Z') }),
}))
// Roster ids are game-log ids here; the bridge has its own tests.
vi.mock('@/lib/redraft/rosterGameLogIdBridge', () => ({
  bridgeRosterIdsToGameLogIds: vi.fn(async (_db: unknown, _keys: string[], ids: string[]) => ({
    gameLogIds: ids,
    rosterIdFor: (id: string) => (ids.includes(id) ? id : null),
  })),
}))

import { loadDailyDayStats, loadDailyWeekStats } from '@/lib/stat-corrections/dailyWeekStats'
import { aggregateWeeklyStats, getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'

/** The per-day re-read must bucket and sum exactly as the sync's `writePlayerDailyScores` does. */
const row = (date: string, points: number, seasonType = 'regular') => ({
  playerId: 'g1',
  sportType: 'NBA',
  season: 2026,
  gameDate: new Date(`${date}T00:00:00Z`),
  normalizedStatMap: { seasonType, stats: { points } },
})
const args = { sport: 'NBA', season: 2026, week: 3, players: [{ playerId: 'g1', playerName: 'Guard One' }] }
const normalizer = getDailySportNormalizer('NBA')!

beforeEach(() => vi.clearAllMocks())

describe('loadDailyDayStats', () => {
  it('one line per Eastern game day, each summed by the sport normalizer on its own', async () => {
    m.prisma.playerGameStat.findMany.mockResolvedValue([row('2026-11-03', 24), row('2026-11-05', 10)])
    const days = (await loadDailyDayStats(args)).get('g1')!
    expect([...days.keys()].sort()).toEqual(['2026-11-03', '2026-11-05'])
    expect(days.get('2026-11-03')).toEqual(aggregateWeeklyStats([row('2026-11-03', 24).normalizedStatMap], normalizer).stats)
    expect(days.get('2026-11-05')).toEqual(aggregateWeeklyStats([row('2026-11-05', 10).normalizedStatMap], normalizer).stats)
    // The weekly reader still returns the whole week as one line.
    const week = (await loadDailyWeekStats(args)).get('g1')!
    expect(week).toEqual(aggregateWeeklyStats([row('2026-11-03', 24), row('2026-11-05', 10)].map((r) => r.normalizedStatMap), normalizer).stats)
  })

  it('skips preseason rows, as the sync does', async () => {
    m.prisma.playerGameStat.findMany.mockResolvedValue([row('2026-11-03', 24, 'pre'), row('2026-11-05', 10)])
    const days = (await loadDailyDayStats(args)).get('g1')!
    expect([...days.keys()]).toEqual(['2026-11-05'])
  })
})
