import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  row: null as null | { payload: unknown; entryCount: number; syncedAt: Date; cacheKey: string },
  resolve: vi.fn(),
  upsert: vi.fn(),
  memory: vi.fn(() => null),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { draftPoolCache: {
    findFirst: vi.fn(async () => h.row),
    upsert: h.upsert,
  } },
}))
vi.mock('@/lib/league/getEffectiveLeagueRosterTemplate', () => ({
  getEffectiveLeagueRosterTemplate: vi.fn(async () => ({
    template: {}, hasPersistedRosterSchema: true, allowedPositions: ['QB'],
  })),
  starterEligiblePlayerPositionsFromTemplate: vi.fn(() => new Set(['QB'])),
}))
vi.mock('@/lib/draft-room/draft-pool-eligible-positions', () => ({
  rosterFingerprintFromEligible: vi.fn(() => 'QB'),
}))
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({
  getResolvedDraftPoolForLeague: h.resolve,
}))
vi.mock('@/lib/db-first-mode', () => ({ dbFirstMode: { draftPoolCacheTtlSeconds: 3600 } }))
vi.mock('@/lib/api-performance', () => ({ getApiCached: h.memory }))

import { ensureDraftPoolReady, getDraftPoolReadiness } from '@/lib/draft-room/ensureDraftPoolReady'

describe('cold draft pool readiness', () => {
  beforeEach(() => {
    h.row = null
    h.resolve.mockReset()
    h.upsert.mockReset()
    h.memory.mockReturnValue(null)
  })

  it('does not accept or persist an empty player feed as a ready draft pool', async () => {
    h.memory.mockReturnValue({ body: { entries: [], count: 300 } } as never)
    h.row = { payload: { entries: [], count: 300 }, entryCount: 300,
      syncedAt: new Date(), cacheKey: 'stale-empty' }
    expect((await getDraftPoolReadiness('league-1')).ready).toBe(false)

    h.resolve.mockResolvedValue({ sport: 'NFL', poolType: 'pro', count: 0, entries: [] })
    expect(await ensureDraftPoolReady('league-1')).toEqual({
      ok: false, error: 'Draft pool is empty. Check the player feed and try again.',
    })
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('persists a nonempty cold pool under a database-safe key', async () => {
    h.resolve.mockResolvedValue({ sport: 'NFL', poolType: 'pro', count: 1,
      entries: [{ playerId: 'player-1', name: 'Test Player' }] })
    h.upsert.mockImplementation(async ({ create }: { create: { cacheKey: string; payload: unknown } }) => {
      h.row = { cacheKey: create.cacheKey, payload: create.payload,
        entryCount: 1, syncedAt: new Date() }
      return { cacheKey: create.cacheKey, entryCount: 1 }
    })

    expect(await ensureDraftPoolReady('league-1')).toEqual({ ok: true, source: 'rebuilt' })
    expect(h.upsert).toHaveBeenCalledOnce()
    expect(h.upsert.mock.calls[0]![0].create.cacheKey.length).toBeLessThanOrEqual(191)
    expect((await getDraftPoolReadiness('league-1')).ready).toBe(true)
  })
})
