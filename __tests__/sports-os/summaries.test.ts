import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetLayeredCacheForTests } from '@/lib/sports-os/layeredCache'
import {
  __resetSummaryRegistryForTests,
  invalidateScreen,
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
    expect(scopeKey({ leagueId: 'l1', userId: 'u1' })).toBe('l=l1&u=u1')
    expect(scopeKey({})).toBe('global')
    expect(scopeKey({ leagueId: null, userId: undefined })).toBe('global')
    expect(scopeKey({ sport: 'NFL' })).toBe('sp=nfl')
    expect(scopeKey({ period: 3 })).toBe('p=3')
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
