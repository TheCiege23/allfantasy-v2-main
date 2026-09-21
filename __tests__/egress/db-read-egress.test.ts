/**
 * Network egress from Neon, 2026-09-21: ~2.3 GB/hour, and most of it was not user data. It was
 * caches re-shipping multi-megabyte values — every HIT on the 13 MB NFL player-pool row, every
 * stale row read only to be discarded, and every upsert echoing the whole blob back via RETURNING.
 * Each test here pins one of those, and each was seen to go red with its fix reverted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  sportsDataCache: { findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  sportsPlayer: { findMany: vi.fn() },
  allFantasyAdpSnapshot: { groupBy: vi.fn(), findMany: vi.fn() },
  playerIdentityMap: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { createTtlMemo } from '@/lib/ttl-memo'
import { cachedFetch } from '@/lib/api-cache'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createTtlMemo', () => {
  afterEach(() => vi.useRealTimers())

  it('returns a value until its TTL, then forgets it', () => {
    vi.useFakeTimers()
    const memo = createTtlMemo<number>({ ttlMs: 1000, maxEntries: 4, enabled: () => true })
    memo.set('a', 1)
    vi.advanceTimersByTime(999)
    expect(memo.get('a')).toBe(1)
    vi.advanceTimersByTime(1)
    expect(memo.get('a')).toBeUndefined()
  })

  it('holds at most maxEntries, dropping the oldest insert', () => {
    const memo = createTtlMemo<number>({ ttlMs: 60_000, maxEntries: 2, enabled: () => true })
    memo.set('a', 1)
    memo.set('b', 2)
    memo.set('c', 3)
    expect(memo.get('a')).toBeUndefined()
    expect(memo.get('b')).toBe(2)
    expect(memo.get('c')).toBe(3)
  })

  it('is a no-op under the test runner unless enabled, so cases cannot leak into each other', () => {
    const memo = createTtlMemo<number>({ ttlMs: 60_000, maxEntries: 2 })
    memo.set('a', 1)
    expect(memo.get('a')).toBeUndefined()
  })
})

describe('cachedFetch (lib/api-cache)', () => {
  it('asks Postgres only for a FRESH row, so a stale multi-MB value is never transferred', async () => {
    prismaMock.sportsDataCache.findFirst.mockResolvedValue(null)
    prismaMock.sportsDataCache.upsert.mockResolvedValue({ cacheKey: 'x' })
    await cachedFetch('k', 60, async () => ({ v: 1 }))

    const args = prismaMock.sportsDataCache.findFirst.mock.calls[0][0]
    expect(args.where.expiresAt).toEqual({ gt: expect.any(Date) })
  })

  it('writes without echoing the blob back (RETURNING only the key)', async () => {
    prismaMock.sportsDataCache.findFirst.mockResolvedValue(null)
    prismaMock.sportsDataCache.upsert.mockResolvedValue({ cacheKey: 'x' })
    await cachedFetch('k', 60, async () => ({ v: 1 }))

    expect(prismaMock.sportsDataCache.upsert.mock.calls[0][0].select).toEqual({ cacheKey: true })
  })

  it('still returns a fresh hit without calling the fetcher', async () => {
    prismaMock.sportsDataCache.findFirst.mockResolvedValue({ data: { v: 'cached' } })
    const fetcher = vi.fn()
    expect(await cachedFetch('k', 60, fetcher)).toEqual({ v: 'cached' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('SleeperCacheLayer memory eviction', () => {
  it('evicts what expires soonest, so the 24h players:all entry survives a flood of short keys', async () => {
    const { setMemoryCache, memoryCacheKeysForTest } = await import('@/lib/api-cache/SleeperCacheLayer')
    setMemoryCache('players:all', { big: true }, 24 * 60 * 60 * 1000)
    for (let i = 0; i < 560; i++) setMemoryCache(`rosters:${i}`, {}, 5 * 60 * 1000)

    const keys = memoryCacheKeysForTest()
    expect(keys).toContain('players:all')
    expect(keys.length).toBeLessThanOrEqual(501)
  })
})

describe('SportPlayerPoolResolver', () => {
  beforeEach(() => {
    process.env.AF_TTL_MEMO_IN_TESTS = '1'
    prismaMock.sportsDataCache.findFirst.mockResolvedValue(null)
    prismaMock.sportsDataCache.upsert.mockResolvedValue({ cacheKey: 'x' })
    prismaMock.sportsPlayer.findMany.mockResolvedValue([
      { id: 'p1', name: 'Saquon Barkley', position: 'RB', team: 'PHI', teamId: null, status: null, sleeperId: '4866', externalId: 'e1', age: 28, imageUrl: null, source: 'sleeper' },
      { id: 'p2', name: 'Aaron Zed', position: 'WR', team: 'DAL', teamId: null, status: null, sleeperId: '9', externalId: 'e2', age: 25, imageUrl: null, source: 'sleeper' },
    ])
    prismaMock.allFantasyAdpSnapshot.groupBy.mockResolvedValue([
      { playerKey: 'saquon barkley|rb', _min: { averageOverallPick: 3.2 } },
    ])
    prismaMock.playerIdentityMap.findMany.mockResolvedValue([])
  })
  afterEach(() => {
    delete process.env.AF_TTL_MEMO_IN_TESTS
    vi.resetModules()
  })

  it('selects only the columns it reads', async () => {
    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    await getPlayerPoolForSport('NBA', { limit: 10 })
    const select = prismaMock.sportsPlayer.findMany.mock.calls[0][0].select
    expect(select).toBeDefined()
    expect(select.college).toBeUndefined()
    expect(select.imageUrl).toBe(true)
  })

  it('ranks by the DB-computed best ADP (groupBy), not a full snapshot scan', async () => {
    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    const pool = await getPlayerPoolForSport('NBA', { limit: 10 })
    expect(prismaMock.allFantasyAdpSnapshot.groupBy).toHaveBeenCalledTimes(1)
    expect(prismaMock.allFantasyAdpSnapshot.findMany).not.toHaveBeenCalled()
    expect(pool[0].full_name).toBe('Saquon Barkley') // ADP-ranked ahead of the alphabetically-first name
  })

  it('serves a repeat call from memory, touching Postgres once, and hands out independent copies', async () => {
    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    const first = await getPlayerPoolForSport('NBA', { limit: 10 })
    first[0].full_name = 'mutated by a caller'
    const second = await getPlayerPoolForSport('NBA', { limit: 10 })

    expect(prismaMock.sportsDataCache.findFirst).toHaveBeenCalledTimes(1)
    expect(prismaMock.sportsPlayer.findMany).toHaveBeenCalledTimes(1)
    expect(second[0].full_name).toBe('Saquon Barkley')
  })

  it('does not memoise an empty pool', async () => {
    prismaMock.sportsPlayer.findMany.mockResolvedValue([])
    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    await getPlayerPoolForSport('NBA', { limit: 10 })
    await getPlayerPoolForSport('NBA', { limit: 10 })
    expect(prismaMock.sportsPlayer.findMany).toHaveBeenCalledTimes(2)
  })
})

describe('news identity registry', () => {
  beforeEach(() => {
    process.env.AF_TTL_MEMO_IN_TESTS = '1'
  })
  afterEach(() => {
    delete process.env.AF_TTL_MEMO_IN_TESTS
    vi.resetModules()
  })

  it('is read once per sport within the TTL, however many runs build an index', async () => {
    prismaMock.playerIdentityMap.findMany.mockResolvedValue([
      { id: 'i1', canonicalName: 'Saquon Barkley', currentTeam: 'PHI' },
    ])
    const { buildNewsPlayerIndex } = await import('@/lib/player-identity/resolveNewsPlayer')
    const a = await buildNewsPlayerIndex('NFL')
    const b = await buildNewsPlayerIndex('NFL')
    expect(prismaMock.playerIdentityMap.findMany).toHaveBeenCalledTimes(1)
    expect(b.resolve('Saquon Barkley').playerId).toBe('i1')
    expect(a.size).toBe(1)
  })

  it('re-reads after an empty registry, so an outage is not held for the TTL', async () => {
    prismaMock.playerIdentityMap.findMany.mockResolvedValue([])
    const { buildNewsPlayerIndex } = await import('@/lib/player-identity/resolveNewsPlayer')
    await buildNewsPlayerIndex('NFL')
    await buildNewsPlayerIndex('NFL')
    expect(prismaMock.playerIdentityMap.findMany).toHaveBeenCalledTimes(2)
  })
})
