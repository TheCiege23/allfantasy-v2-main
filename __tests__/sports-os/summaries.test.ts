import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetLayeredCacheForTests } from '@/lib/sports-os/layeredCache'
import {
  __resetSummaryRegistryForTests,
  invalidateScreen,
  invalidateScreenForLeague,
  invalidateScreenSummary,
  readScreenSummary,
  registerScreenSummary,
  registeredScreens,
  scopeKey,
  screensInvalidatedBy,
  summaryCacheKey,
} from '@/lib/sports-os/summaries'

describe('sports-os summaries', () => {
  beforeEach(() => {
    __resetSummaryRegistryForTests()
    __resetLayeredCacheForTests()
  })

  it('builds a scope key in a fixed field order, not object-key order', () => {
    // Two callers writing the same scope with the keys in a different order must land on ONE entry;
    // iterating the object would give them two and halve the hit rate silently.
    expect(scopeKey({ leagueId: 'l1', userId: 'u1' })).toBe(scopeKey({ userId: 'u1', leagueId: 'l1' }))
    expect(scopeKey({ leagueId: 'l1', userId: 'u1' })).toBe('l=l1&u=u1&')
    expect(scopeKey({})).toBe('global')
    expect(scopeKey({ leagueId: null, userId: undefined })).toBe('global')
    expect(scopeKey({ sport: 'NFL' })).toBe('sp=nfl&')
    expect(scopeKey({ period: 3 })).toBe('p=3&')
  })

  it('drops an unbounded scope value rather than keying a cache on it', () => {
    expect(scopeKey({ leagueId: 'x'.repeat(200) })).toBe('global')
  })

  it('puts the version in the cache key, so a shape change cannot be served from the old entry', () => {
    registerScreenSummary({ screen: 's', version: 1, ttlMs: 1_000, build: async () => 1, invalidatedBy: [] })
    const v1 = summaryCacheKey('s', 1, { leagueId: 'l1' })
    const v2 = summaryCacheKey('s', 2, { leagueId: 'l1' })
    expect(v1).not.toBe(v2)
    expect(v1).toContain(':v1:')
  })

  it('reads through, serves the second read from cache, and carries a timestamp', async () => {
    const build = vi.fn(async () => ({ wins: 7 }))
    registerScreenSummary({ screen: 'standings', version: 1, ttlMs: 60_000, build, invalidatedBy: [] })

    const first = await readScreenSummary<{ wins: number }>('standings', { leagueId: 'l1' })
    expect(first).toMatchObject({ data: { wins: 7 }, source: 'live' })
    expect(first.fetchedAt).toBeGreaterThan(0)

    const second = await readScreenSummary('standings', { leagueId: 'l1' })
    expect(second.source).toBe('cache')
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('keeps scopes apart', async () => {
    const build = vi.fn(async (scope) => ({ league: scope.leagueId }))
    registerScreenSummary({ screen: 'standings', version: 1, ttlMs: 60_000, build, invalidatedBy: [] })

    expect((await readScreenSummary('standings', { leagueId: 'l1' })).data).toEqual({ league: 'l1' })
    expect((await readScreenSummary('standings', { leagueId: 'l2' })).data).toEqual({ league: 'l2' })
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('rebuilds after an invalidation — the self-populating property', async () => {
    // This is the whole reason a summary is read-through: an invalidated entry costs one rebuild,
    // never a screen of nulls (CLAUDE.md, ingestCFBDStats).
    let n = 0
    registerScreenSummary({ screen: 'standings', version: 1, ttlMs: 600_000, build: async () => ++n, invalidatedBy: [] })

    expect((await readScreenSummary('standings', { leagueId: 'l1' })).data).toBe(1)
    await invalidateScreenSummary('standings', { leagueId: 'l1' })
    expect((await readScreenSummary('standings', { leagueId: 'l1' })).data).toBe(2)
  })

  it('sweeps every scope of one screen and leaves others alone', async () => {
    registerScreenSummary({ screen: 'standings', version: 1, ttlMs: 600_000, build: async () => 'a', invalidatedBy: [] })
    registerScreenSummary({ screen: 'portfolio', version: 1, ttlMs: 600_000, build: async () => 'b', invalidatedBy: [] })

    await readScreenSummary('standings', { leagueId: 'l1' })
    await readScreenSummary('standings', { leagueId: 'l2' })
    await readScreenSummary('portfolio', { leagueId: 'l1' })

    expect(invalidateScreen('standings')).toBe(2)
    expect((await readScreenSummary('portfolio', { leagueId: 'l1' })).source).toBe('cache')
  })

  it('emits leagueId FIRST and terminates every field — the two facts the league sweep rests on', () => {
    // 🛑 THIS TEST EXISTS TO FAIL IF SOMEONE REORDERS scopeKey. `summaryLeaguePrefix` builds
    // `…l=<id>&` and sweeps by prefix; if leagueId stopped being first, or the trailing `&` went
    // away, the sweep would quietly stop matching and standings would serve stale with nothing red.
    expect(scopeKey({ leagueId: 'lg1', userId: 'u1', seasonId: '2026' }).startsWith('l=lg1&')).toBe(true)

    // The terminator is what stops `lg1` matching `lg10`. Without it this is a cross-league wipe.
    expect(scopeKey({ leagueId: 'lg10', userId: 'u1' }).startsWith('l=lg1&')).toBe(false)
  })

  it('sweeps one league across users and seasons, and leaves neighbouring leagues alone', async () => {
    registerScreenSummary({ screen: 'standings', version: 1, ttlMs: 600_000, build: async () => 'board', invalidatedBy: [] })

    await readScreenSummary('standings', { leagueId: 'lg1', userId: 'u1', seasonId: '2026' })
    await readScreenSummary('standings', { leagueId: 'lg1', userId: 'u2', seasonId: '2026' })
    await readScreenSummary('standings', { leagueId: 'lg1', userId: 'u1', seasonId: '2025' })
    await readScreenSummary('standings', { leagueId: 'lg10', userId: 'u1', seasonId: '2026' })

    // Three entries for lg1 (two members, two seasons) — and NOT the lg10 entry.
    expect(await invalidateScreenForLeague('standings', 'lg1')).toBe(3)
    expect((await readScreenSummary('standings', { leagueId: 'lg10', userId: 'u1', seasonId: '2026' })).source).toBe('cache')
  })

  it('passes a bounded, league-scoped prefix to the durable tier', async () => {
    registerScreenSummary({ screen: 'standings', version: 2, ttlMs: 600_000, build: async () => 'x', invalidatedBy: [] })
    const removePrefix = vi.fn(async () => undefined)
    const durable = { read: async () => null, write: async () => undefined, removePrefix }

    await invalidateScreenForLeague('standings', 'lg1', durable)

    // Version in the prefix, league in the prefix, terminated. A screen-wide prefix here would be
    // an unbounded DELETE issued from a sync path.
    expect(removePrefix).toHaveBeenCalledWith('sos:sum:standings:v2:l=lg1&')
  })

  it('never throws when the durable sweep fails', async () => {
    // A failed invalidation costs one TTL of staleness on a labelled board. Failing the sync that
    // triggered it would be strictly worse.
    registerScreenSummary({ screen: 'standings', version: 1, ttlMs: 600_000, build: async () => 'x', invalidatedBy: [] })
    const durable = {
      read: async () => null,
      write: async () => undefined,
      removePrefix: async () => { throw new Error('db down') },
    }
    await expect(invalidateScreenForLeague('standings', 'lg1', durable)).resolves.toBe(0)
  })

  it('is a no-op for an unregistered screen or a blank league id', async () => {
    expect(await invalidateScreenForLeague('nope', 'lg1')).toBe(0)
    registerScreenSummary({ screen: 'standings', version: 1, ttlMs: 1, build: async () => 1, invalidatedBy: [] })
    expect(await invalidateScreenForLeague('standings', '')).toBe(0)
  })

  it('throws on an unregistered screen instead of rendering nothing', async () => {
    await expect(readScreenSummary('nope', {})).rejects.toThrow('No screen summary registered')
    expect(invalidateScreen('nope')).toBe(0)
    await expect(invalidateScreenSummary('nope', {})).resolves.toBeUndefined()
  })

  it('lists registered screens and the events that invalidate them', () => {
    registerScreenSummary({ screen: 'standings', version: 1, ttlMs: 1, build: async () => 1, invalidatedBy: ['a.b.c'] })
    registerScreenSummary({ screen: 'portfolio', version: 1, ttlMs: 1, build: async () => 1, invalidatedBy: ['a.b.c', 'd.e.f'] })
    expect(registeredScreens()).toEqual(['portfolio', 'standings'])
    expect(screensInvalidatedBy('a.b.c')).toEqual(['portfolio', 'standings'])
    expect(screensInvalidatedBy('d.e.f')).toEqual(['portfolio'])
    expect(screensInvalidatedBy('zzz')).toEqual([])
  })
})
