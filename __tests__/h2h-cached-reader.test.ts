// @vitest-environment node
/**
 * `readCachedLeagueH2H` — the H2H aggregation from the cache only, for render paths. Never a
 * Sleeper call; expiry ignored; only version-2 payloads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ cacheFind: vi.fn(), fetch: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findMany: h.cacheFind, findUnique: vi.fn(), upsert: vi.fn() } } }))

import { readCachedLeagueH2H } from '@/lib/league-history/sleeperH2HService'

beforeEach(() => {
  h.cacheFind.mockReset()
  h.fetch.mockReset()
  vi.stubGlobal('fetch', h.fetch)
})

describe('readCachedLeagueH2H', () => {
  it('🛑 one cache read keyed h2h:v2:<id>, version-2 payloads only, and never a network call', async () => {
    h.cacheFind.mockResolvedValue([
      { cacheKey: 'h2h:v2:111', data: { version: 2, sleeperLeagueId: '111' } },
      { cacheKey: 'h2h:v2:222', data: { version: 1, sleeperLeagueId: '222' } },
      { cacheKey: 'h2h:v2:333', data: null },
    ])
    const out = await readCachedLeagueH2H(['111', '222', '333', '111', ''])
    expect(h.cacheFind).toHaveBeenCalledWith({
      where: { cacheKey: { in: ['h2h:v2:111', 'h2h:v2:222', 'h2h:v2:333'] } },
      select: { cacheKey: true, data: true },
    })
    expect([...out.keys()]).toEqual(['111'])
    expect(out.get('111')).toEqual({ version: 2, sleeperLeagueId: '111' })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('no ids reads nothing', async () => {
    expect((await readCachedLeagueH2H([])).size).toBe(0)
    expect(h.cacheFind).not.toHaveBeenCalled()
  })
})
