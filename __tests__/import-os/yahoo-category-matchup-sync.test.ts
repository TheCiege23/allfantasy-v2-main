import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagues: vi.fn(), cache: vi.fn(), cacheWrite: vi.fn(), matchups: vi.fn(), deleteMatchups: vi.fn(), createMatchups: vi.fn(), yahoo: vi.fn(), espn: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findMany: h.leagues }, sportsDataCache: { findUnique: h.cache, upsert: h.cacheWrite },
  weeklyMatchup: { findMany: h.matchups, deleteMany: h.deleteMatchups, createMany: h.createMatchups },
} }))
vi.mock('@/lib/league-import/yahoo/YahooLeagueFetchService', () => ({
  fetchYahooWeeklyMatchupsForSync: h.yahoo,
  YahooImportConnectionError: class YahooImportConnectionError extends Error {},
  YahooImportLeagueNotFoundError: class YahooImportLeagueNotFoundError extends Error {},
}))
vi.mock('@/lib/league-import/espn/EspnLeagueFetchService', () => ({
  fetchEspnScheduleForSync: h.espn,
  EspnImportConnectionError: class EspnImportConnectionError extends Error {},
  EspnImportLeagueNotFoundError: class EspnImportLeagueNotFoundError extends Error {},
}))

import { runExternalMatchupParity } from '@/lib/import-os/collector/externalMatchupParity'

beforeEach(() => {
  vi.clearAllMocks()
  h.leagues.mockResolvedValue([{ platform: 'yahoo', platformLeagueId: '466.l.12', season: 2026,
    sport: 'NBA', userId: 'u1' }])
  h.cache.mockResolvedValue(null)
  h.cacheWrite.mockResolvedValue({})
  h.matchups.mockResolvedValue([])
  h.deleteMatchups.mockResolvedValue({ count: 0 })
  h.createMatchups.mockResolvedValue({ count: 2 })
  h.yahoo.mockResolvedValue({ schedule: [{ week: 2, season: 2026, matchups: [{
    teamKey1: '466.l.12.t.1', teamKey2: '466.l.12.t.2', points1: 0, points2: 0,
    categories1: { '5': 101, '6': 42 }, categories2: { '5': 95, '6': 40 },
  }] }] })
  h.espn.mockResolvedValue([])
})

describe('Yahoo non-NFL category matchup sync', () => {
  it('persists verified category totals without substituting scalar points', async () => {
    const out = await runExternalMatchupParity({ now: new Date('2026-11-01T20:00:00Z'), maxLeagues: 1 })
    expect(out.synced).toBe(1)
    expect(h.createMatchups).toHaveBeenCalled()
    const categoryCall = h.cacheWrite.mock.calls.find(([arg]) => arg.where.cacheKey === 'imported_category_matchup:yahoo:466.l.12:2026:2')
    expect(categoryCall?.[0].create.data.pairs).toEqual([{ roster1: '1', roster2: '2',
      categories1: { '5': 101, '6': 42 }, categories2: { '5': 95, '6': 40 } }])
  })

  it('does not store an incomplete category comparison', async () => {
    h.yahoo.mockResolvedValue({ schedule: [{ week: 2, season: 2026, matchups: [{
      teamKey1: '466.l.12.t.1', teamKey2: '466.l.12.t.2', categories1: { '5': 101, '6': 42 },
      categories2: { '5': 95 },
    }] }] })
    const out = await runExternalMatchupParity({ now: new Date('2026-11-01T20:00:00Z'), maxLeagues: 1 })
    expect(out.synced).toBe(1)
    expect(h.cacheWrite.mock.calls.some(([arg]) => String(arg.where.cacheKey).startsWith('imported_category_matchup:'))).toBe(false)
  })

  it('persists ESPN scoreByStat category pairs for the selected season', async () => {
    h.leagues.mockResolvedValue([{ platform: 'espn', platformLeagueId: '123', season: 2026,
      sport: 'MLB', userId: 'u1' }])
    h.espn.mockResolvedValue([{ week: 2, season: 2026, matchups: [{ teamId1: '1', teamId2: '2',
      categories1: { '5': 16, '8': 172 }, categories2: { '5': 12, '8': 165 } }] }])
    const out = await runExternalMatchupParity({ now: new Date('2026-06-01T20:00:00Z'), maxLeagues: 1 })
    expect(out.synced).toBe(1)
    const categoryCall = h.cacheWrite.mock.calls.find(([arg]) => arg.where.cacheKey === 'imported_category_matchup:espn:123:2026:2')
    expect(categoryCall?.[0].create.data.pairs).toEqual([{ roster1: '1', roster2: '2',
      categories1: { '5': 16, '8': 172 }, categories2: { '5': 12, '8': 165 } }])
  })
})
