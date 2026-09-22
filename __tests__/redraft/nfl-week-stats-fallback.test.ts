/**
 * NFL offensive scoring, when the cache this branch was written against is empty.
 *
 * `playerGameLogCache` has no scheduled writer (admin routes only; 15 rows in production), so
 * every rostered offensive player fell into `missingCachePlayerIds` and got no
 * `PlayerWeeklyScore` row at all. Team defenses scored fine — they are derived from
 * `SportsGame` — which is why production week 2 held defense rows and nothing else.
 *
 * These pin the repair and its limits:
 *   1. an uncached offensive player is scored from the week-wide provider payload;
 *   2. the cache still WINS when it has the week, so nothing regresses for a league whose
 *      cache is populated, and no provider call is made at all in that case;
 *   3. a player neither source can answer for is still reported as missing, not zeroed;
 *   4. only offensive players are fetched — defenses are not, because their ids are synthetic
 *      and the endpoint has nothing for them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  adminAuditLog: { create: vi.fn() },
  league: { findFirst: vi.fn() },
  playerGameLogCache: { findMany: vi.fn() },
  playerGameStat: { findMany: vi.fn() },
  playerIdentityMap: { findFirst: vi.fn() },
  playerWeeklyScore: { upsert: vi.fn(), findUnique: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  sportsGame: { findMany: vi.fn() },
  sportsPlayer: { findFirst: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const SEASON = { id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026, currentWeek: 2 }

function rosterPlayer(playerId: string, position: string, slotType = 'QB') {
  return { playerId, position, slotType, sport: 'NFL', team: 'KC', droppedAt: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.redraftSeason.findFirst.mockResolvedValue(SEASON)
  prismaMock.league.findFirst.mockResolvedValue({ id: 'league-1', settings: {} })
  prismaMock.redraftRoster.findMany.mockResolvedValue([{ id: 'roster-1' }])
  prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([rosterPlayer('4034', 'QB')])
  prismaMock.playerGameLogCache.findMany.mockResolvedValue([])
  prismaMock.sportsGame.findMany.mockResolvedValue([])
  prismaMock.playerWeeklyScore.upsert.mockResolvedValue({})
  prismaMock.adminAuditLog.create.mockResolvedValue({})
})

async function runSync(fetchNflWeekStats?: any) {
  const { syncPlayerWeeklyScoresForRedraftSeason } = await import('@/lib/redraft/playerWeeklyScoreService')
  return syncPlayerWeeklyScoresForRedraftSeason({
    seasonId: 'season-1',
    week: 2,
    actorId: 'test',
    fetchNflWeekStats,
  })
}

describe('NFL weekly score sync — week-wide provider fallback', () => {
  it('scores an uncached offensive player from the week-wide payload', async () => {
    const fetcher = vi.fn(async () => new Map([['4034', { pass_yds: 310, pass_td: 3 }]]))

    const summary = await runSync(fetcher)

    expect(fetcher).toHaveBeenCalledWith({ season: 2026, week: 2, playerIds: ['4034'] })
    expect(summary.scoresUpserted).toBe(1)
    expect(summary.weekStatsFromProvider).toBe(1)
    expect(summary.missingCachePlayerIds).toEqual([])

    const written = prismaMock.playerWeeklyScore.upsert.mock.calls[0]?.[0]
    expect(written.where.playerId_week_season_sport).toMatchObject({
      playerId: '4034',
      week: 2,
      season: 2026,
      sport: 'NFL',
    })
    expect(written.create.stats).toEqual({ pass_yds: 310, pass_td: 3 })
    // Still not finalized here: sealing a week is the finalizer's decision, not the sync's.
    expect(written.create.isFinalized).toBe(false)
  })

  it('prefers the cache when it holds the week, and then makes no provider call', async () => {
    prismaMock.playerGameLogCache.findMany.mockResolvedValue([
      { playerId: '4034', payload: { weeks: [{ week: 2, stats: { pass_yds: 111, pass_td: 1 } }] } },
    ])
    const fetcher = vi.fn(async () => new Map())

    const summary = await runSync(fetcher)

    expect(fetcher).not.toHaveBeenCalled()
    expect(summary.weekStatsFromProvider).toBe(0)
    expect(summary.scoresUpserted).toBe(1)
    const written = prismaMock.playerWeeklyScore.upsert.mock.calls[0]?.[0]
    expect(written.create.stats.pass_yds).toBe(111)
  })

  it('reports a player neither source can answer for, and writes nothing for him', async () => {
    const fetcher = vi.fn(async () => new Map())

    const summary = await runSync(fetcher)

    expect(summary.scoresUpserted).toBe(0)
    expect(summary.weekStatsFromProvider).toBe(0)
    expect(summary.missingCachePlayerIds).toEqual(['4034'])
    expect(prismaMock.playerWeeklyScore.upsert).not.toHaveBeenCalled()
  })

  it('asks the provider only about offensive players, never team defenses', async () => {
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([
      rosterPlayer('4034', 'QB'),
      rosterPlayer('name:Baltimore Defense:DEF:BAL', 'DEF', 'DEF'),
    ])
    const fetcher = vi.fn(async () => new Map([['4034', { pass_yds: 10 }]]))

    await runSync(fetcher)

    expect(fetcher).toHaveBeenCalledWith({ season: 2026, week: 2, playerIds: ['4034'] })
  })

  it('a provider failure leaves the player unscored rather than zeroed', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('sleeper down')
    })

    await expect(runSync(fetcher)).rejects.toThrow('sleeper down')
    expect(prismaMock.playerWeeklyScore.upsert).not.toHaveBeenCalled()
  })
})
