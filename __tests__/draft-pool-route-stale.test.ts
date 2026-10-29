import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The draft room's own pool request: once the 5-minute cache row expires mid-draft it must answer
 * from the last good row and leave the rebuild to the background, not run a cold build itself.
 */

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  readStale: vi.fn(),
  trigger: vi.fn(),
  resolve: vi.fn(),
  waitBuild: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn(async () => true) }))
vi.mock('@/lib/league/getEffectiveLeagueRosterTemplate', () => ({ getEffectiveLeagueRosterTemplate: vi.fn(async () => ({ sport: 'NBA' })) }))
vi.mock('@/lib/api-performance', () => ({
  API_CACHE_TTL: {},
  buildApiCacheKey: vi.fn(() => 'api:GET:pool'),
  dedupeInFlight: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  getApiCached: vi.fn(() => null),
  setApiCached: vi.fn(),
}))
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({ getResolvedDraftPoolForLeague: h.resolve }))
vi.mock('@/lib/db-first-mode', () => ({ dbFirstMode: { draftPoolCacheTtlSeconds: 300 } }))
vi.mock('@/lib/prisma', () => ({ prisma: { draftPoolCache: { findFirst: h.findFirst, upsert: vi.fn(async () => ({})) } } }))
vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({
  buildDraftPoolCacheKey: vi.fn(() => 'key-1'),
  resolveDraftPoolCacheContext: vi.fn(async () => ({ rosterFp: 'fp', standardCacheKey: 'key-1' })),
  readStaleDraftPoolRow: h.readStale,
  triggerDraftPoolPrewarmBackground: h.trigger,
  waitForInFlightDraftPoolBuild: h.waitBuild,
}))

import { GET } from '@/app/api/leagues/[leagueId]/draft/pool/route'

const call = () => GET(new NextRequest('http://localhost/api/leagues/lg/draft/pool'), { params: Promise.resolve({ leagueId: 'lg' }) })

describe('GET /draft/pool after the cache row expires', () => {
  beforeEach(() => {
    h.findFirst.mockReset().mockResolvedValue(null) // nothing fresh
    h.readStale.mockReset()
    h.trigger.mockReset()
    h.resolve.mockReset()
    h.waitBuild.mockReset().mockResolvedValue(false) // no prewarm running
  })

  it('answers from the last good row and rebuilds in the background', async () => {
    h.readStale.mockResolvedValue({ payload: { entries: [{ playerId: 'p1', name: 'Old Center' }], sport: 'NBA', count: 1 }, entryCount: 1, syncedAt: '2026-10-27T00:00:00.000Z', cacheKey: 'key-1' })
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entries.map((e: { name: string }) => e.name)).toEqual(['Old Center'])
    expect(body.meta).toMatchObject({ source: 'db-cache', cachedAt: '2026-10-27T00:00:00.000Z' })
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache')
    expect(h.readStale).toHaveBeenCalledWith('lg', { cacheKey: 'key-1', rosterFp: 'fp' })
    expect(h.trigger).toHaveBeenCalledWith('lg')
    expect(h.resolve).not.toHaveBeenCalled()
  })

  it('[control] with no usable row at all it still builds the pool itself', async () => {
    h.readStale.mockResolvedValue(null)
    h.resolve.mockResolvedValue({ sport: 'NBA', poolType: 'pro', count: 0, entries: [], rosterConfigurationIncomplete: true })
    await call()
    expect(h.resolve).toHaveBeenCalledTimes(1)
    expect(h.trigger).not.toHaveBeenCalled()
  })

  it('joins a prewarm already building this pool instead of running a second build', async () => {
    // A brand-new league: the page fired the prewarm a moment before this request.
    h.readStale.mockResolvedValue(null)
    h.waitBuild.mockResolvedValue(true)
    h.findFirst
      .mockResolvedValueOnce(null) // fresh row by cache key: not yet
      .mockResolvedValueOnce(null) // fresh row by league + fingerprint: not yet
      .mockResolvedValueOnce({ payload: { entries: [{ playerId: 'p1', name: 'New Center' }], sport: 'NBA', count: 1 }, entryCount: 1, syncedAt: new Date('2026-10-28T00:00:00.000Z') })
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entries.map((e: { name: string }) => e.name)).toEqual(['New Center'])
    expect(h.waitBuild).toHaveBeenCalledWith('lg')
    expect(h.resolve).not.toHaveBeenCalled()
  })

  it('still builds itself when the joined prewarm left no usable row', async () => {
    h.readStale.mockResolvedValue(null)
    h.waitBuild.mockResolvedValue(true)
    h.resolve.mockResolvedValue({ sport: 'NBA', poolType: 'pro', count: 0, entries: [], rosterConfigurationIncomplete: true })
    await call()
    expect(h.resolve).toHaveBeenCalledTimes(1)
  })

  it('does not wait for a prewarm when a stale row can be served right away', async () => {
    h.readStale.mockResolvedValue({ payload: { entries: [], sport: 'NBA', count: 0 }, entryCount: 0, syncedAt: null, cacheKey: 'key-1' })
    await call()
    expect(h.waitBuild).not.toHaveBeenCalled()
  })
})
