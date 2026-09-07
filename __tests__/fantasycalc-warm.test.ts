import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The FantasyCalc cache warmer.
 *
 * 🛑 THE POINT OF EACH TEST IS A FAILURE MODE THIS REPO HAS ALREADY PAID FOR:
 *   · a warm list that drifts from what is actually requested (the hardcoded-3-of-22 problem)
 *   · settings invented rather than read, by parsing the cache key back into a second
 *     implementation of the key format
 *   · one vendor error abandoning every remaining profile
 *   · a truncated run reporting success, so a permanently-slow vendor looks green forever
 */

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn(),
  fetchFantasyCalcValues: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { sportsDataCache: { findMany: mocks.findMany, upsert: mocks.upsert } },
}))

vi.mock('@/lib/fantasycalc-fetch', () => ({
  fetchFantasyCalcValues: mocks.fetchFantasyCalcValues,
}))

const OLD = new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString()

function row(numTeams: number, ppr: number, syncedAt = OLD) {
  return {
    cacheKey: `fantasycalc:values:dynasty:1:qbs:1:teams:${numTeams}:ppr:${ppr}`,
    data: {
      players: [{ name: 'x' }],
      settings: { isDynasty: true, numQbs: 1, numTeams, ppr },
      syncedAt,
    },
  }
}

describe('fantasycalc cache warmer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.upsert.mockResolvedValue({})
    mocks.fetchFantasyCalcValues.mockResolvedValue([{ name: 'a' }, { name: 'b' }])
  })

  it('derives the warm list from the ROW PAYLOAD, never by parsing the cache key', async () => {
    // The key says teams:14 but the payload says teams:99. The payload must win — that is what
    // proves settings are read rather than re-derived from the key format.
    mocks.findMany.mockResolvedValue([
      {
        cacheKey: 'fantasycalc:values:dynasty:1:qbs:1:teams:14:ppr:1',
        data: { players: [], settings: { isDynasty: true, numQbs: 1, numTeams: 99, ppr: 0.5 }, syncedAt: OLD },
      },
    ])
    const { listCachedFantasyCalcProfiles } = await import('@/lib/fantasycalc-db')

    const profiles = await listCachedFantasyCalcProfiles()

    expect(profiles).toHaveLength(1)
    expect(profiles[0]!.settings).toEqual({ isDynasty: true, numQbs: 1, numTeams: 99, ppr: 0.5 })
  })

  it('SKIPS a row whose payload will not parse rather than guessing its settings', async () => {
    mocks.findMany.mockResolvedValue([
      { cacheKey: 'fantasycalc:values:broken', data: { nope: true } },
      row(12, 1),
    ])
    const { listCachedFantasyCalcProfiles } = await import('@/lib/fantasycalc-db')

    const profiles = await listCachedFantasyCalcProfiles()

    // Warming a profile we cannot describe would write under an invented key.
    expect(profiles).toHaveLength(1)
    expect(profiles[0]!.settings.numTeams).toBe(12)
  })

  it('warms every stale profile, one vendor call each', async () => {
    mocks.findMany.mockResolvedValue([row(10, 1), row(12, 1), row(16, 0.5)])
    const { warmFantasyCalcCache } = await import('@/lib/fantasycalc-db')

    const result = await warmFantasyCalcCache()

    expect(result.refreshed).toBe(3)
    expect(result.failed).toBe(0)
    expect(result.timedOut).toBe(false)
    expect(mocks.fetchFantasyCalcValues).toHaveBeenCalledTimes(3)
    expect(mocks.upsert).toHaveBeenCalledTimes(3)
  })

  it('skips a profile synced within minAgeMs, so overlapping runs do not re-fetch everything', async () => {
    const fresh = new Date().toISOString()
    mocks.findMany.mockResolvedValue([row(10, 1, fresh), row(12, 1)])
    const { warmFantasyCalcCache } = await import('@/lib/fantasycalc-db')

    const result = await warmFantasyCalcCache()

    expect(result.skippedFresh).toBe(1)
    expect(result.refreshed).toBe(1)
    expect(mocks.fetchFantasyCalcValues).toHaveBeenCalledTimes(1)
  })

  it('CONTINUES after a vendor failure instead of abandoning the remaining profiles', async () => {
    mocks.findMany.mockResolvedValue([row(10, 1), row(12, 1), row(16, 1)])
    mocks.fetchFantasyCalcValues
      .mockRejectedValueOnce(new Error('FantasyCalc API error: 503'))
      .mockResolvedValue([{ name: 'a' }])
    const { warmFantasyCalcCache } = await import('@/lib/fantasycalc-db')

    const result = await warmFantasyCalcCache()

    expect(result.failed).toBe(1)
    expect(result.refreshed).toBe(2)
    // The error is carried, not swallowed — the cron records it in SyncJobRun.
    expect(result.profiles.find((p) => !p.ok)?.error).toContain('503')
  })

  it('REPORTS timedOut when the deadline truncates the run, rather than looking complete', async () => {
    mocks.findMany.mockResolvedValue([row(10, 1), row(12, 1), row(16, 1)])
    mocks.fetchFantasyCalcValues.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([{ name: 'a' }]), 25)),
    )
    const { warmFantasyCalcCache } = await import('@/lib/fantasycalc-db')

    const result = await warmFantasyCalcCache({ deadlineMs: 10 })

    // A vendor slow enough to eat the deadline every run must not report green forever.
    expect(result.timedOut).toBe(true)
    expect(result.refreshed).toBeLessThan(3)
  })
})
