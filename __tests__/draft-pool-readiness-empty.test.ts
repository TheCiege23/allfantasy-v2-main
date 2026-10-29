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

import {
  ensureDraftPoolReady,
  getDraftPoolReadiness,
  inFlightDraftPoolBuildCount,
} from '@/lib/draft-room/ensureDraftPoolReady'

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

/*
 * 🛑 ONE COLD BUILD PER LEAGUE PER PROCESS. The cron, the draft-room open and autopick all call
 * ensureDraftPoolReady, and its only guard was a DB read that sees nothing until a build FINISHES.
 * A build overrunning the cron's 120s `withTimeout` (which races, it does not cancel) stayed alive
 * while the next caller started another — production logged builds at 522s, and
 * cron-draft-pool-prewarm ran past 5 minutes 46 times in a week.
 */
describe('concurrent callers share one cold build', () => {
  beforeEach(() => {
    h.row = null
    h.resolve.mockReset()
    h.upsert.mockReset()
    h.memory.mockReturnValue(null)
  })

  it('three overlapping callers for one league run ONE build and all get its result', async () => {
    let release!: (v: unknown) => void
    h.resolve.mockImplementation(() => new Promise((r) => { release = r }))
    h.upsert.mockResolvedValue({})

    const calls = [ensureDraftPoolReady('league-9'), ensureDraftPoolReady('league-9'), ensureDraftPoolReady('league-9')]
    await vi.waitFor(() => expect(h.resolve).toHaveBeenCalled())
    expect(inFlightDraftPoolBuildCount()).toBe(1)
    release({ sport: 'NFL', poolType: 'pro', count: 1, entries: [{ playerId: 'p1', name: 'P' }] })

    const results = await Promise.all(calls)
    expect(h.resolve).toHaveBeenCalledTimes(1)
    expect(h.upsert).toHaveBeenCalledTimes(1)
    expect(results).toEqual(Array(3).fill({ ok: true, source: 'rebuilt' }))
    expect(inFlightDraftPoolBuildCount()).toBe(0)
  })

  it('different leagues do not share, and a finished build does not stick', async () => {
    h.resolve.mockResolvedValue({ sport: 'NFL', poolType: 'pro', count: 1, entries: [{ playerId: 'p1', name: 'P' }] })
    h.upsert.mockResolvedValue({})
    await Promise.all([ensureDraftPoolReady('league-a'), ensureDraftPoolReady('league-b')])
    expect(h.resolve).toHaveBeenCalledTimes(2)
    // Sequential, after the first settled: a fresh call runs again rather than replaying a result.
    h.row = null
    await ensureDraftPoolReady('league-a')
    expect(h.resolve).toHaveBeenCalledTimes(3)
  })

  it('a build that throws clears its slot, so the next caller can retry', async () => {
    h.resolve.mockRejectedValueOnce(new Error('provider 500'))
    const first = await ensureDraftPoolReady('league-x')
    expect(first.ok).toBe(false)
    expect(inFlightDraftPoolBuildCount()).toBe(0)
    h.resolve.mockResolvedValue({ sport: 'NFL', poolType: 'pro', count: 1, entries: [{ playerId: 'p1', name: 'P' }] })
    h.upsert.mockResolvedValue({})
    expect(await ensureDraftPoolReady('league-x')).toEqual({ ok: true, source: 'rebuilt' })
  })
})
