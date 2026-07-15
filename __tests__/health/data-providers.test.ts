import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression coverage for the dashboard "Live data connected" chip
 * (AF_DATA_PROVENANCE_AUDIT.md demo risk #3).
 *
 * Two failure modes are guarded here:
 *  1. The ORIGINAL bug — the chip was hardcoded green with no check. These tests prove
 *     `ok` is now a real function of cache freshness (false when sports data is stale).
 *  2. The RESIDUAL bug — gating `ok` on weather freshness made the chip read
 *     "Data sync delayed" permanently in the NFL offseason (weather only refreshes around
 *     games). The offseason cases below prove stale/empty weather no longer flips the chip;
 *     sports-data freshness is the primary signal.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: { findFirst: vi.fn() },
    weatherCache: { findFirst: vi.fn() },
  },
}))

import { GET } from '@/app/api/health/data-providers/route'
import { prisma } from '@/lib/prisma'

const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000

function sportsRow(ageMs: number) {
  return { createdAt: new Date(Date.now() - ageMs) }
}
function weatherRow(ageMs: number) {
  return { fetchedAt: new Date(Date.now() - ageMs) }
}
function setCaches(sports: unknown, weather: unknown) {
  vi.mocked(prisma.sportsDataCache.findFirst).mockResolvedValue(sports as never)
  vi.mocked(prisma.weatherCache.findFirst).mockResolvedValue(weather as never)
}

describe('GET /api/health/data-providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ok:true when sports and weather caches are both fresh', async () => {
    setCaches(sportsRow(60_000), weatherRow(60_000))
    const res = await GET()
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.sports.ok).toBe(true)
    expect(data.weather.ok).toBe(true)
    expect(data.degraded).toBe(false)
  })

  it('OFFSEASON: ok:true when sports is fresh but the weather cache is STALE — weather must not flip the chip', async () => {
    setCaches(sportsRow(60_000), weatherRow(FRESH_WINDOW_MS + 60_000))
    const res = await GET()
    const data = await res.json()
    // The residual-bug regression: stale offseason weather no longer forces "Data sync delayed".
    expect(data.ok).toBe(true)
    expect(data.sports.ok).toBe(true)
    expect(data.weather.ok).toBe(false)
    // ...but the sports-fresh / weather-stale state is still surfaced for observability.
    expect(data.degraded).toBe(true)
  })

  it('OFFSEASON: ok:true when the weather cache is EMPTY (no rows) but sports is fresh', async () => {
    setCaches(sportsRow(60_000), null)
    const res = await GET()
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.weather.ok).toBe(false)
    expect(data.weather.lastSyncedAt).toBeNull()
    expect(data.degraded).toBe(true)
  })

  it('NEGATIVE: ok:false when sports data is STALE (chip shows "Data sync delayed")', async () => {
    setCaches(sportsRow(FRESH_WINDOW_MS + 60_000), weatherRow(60_000))
    const res = await GET()
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.sports.ok).toBe(false)
  })

  it('NEGATIVE: ok:false when there is no sports cache at all (empty DB — not silently green)', async () => {
    setCaches(null, null)
    const res = await GET()
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.sports.ok).toBe(false)
    expect(data.sports.lastSyncedAt).toBeNull()
  })

  it('is loud, not silently green: a DB failure returns ok:false with status 500 and logs the error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(prisma.sportsDataCache.findFirst).mockRejectedValue(new Error('connection refused'))
    vi.mocked(prisma.weatherCache.findFirst).mockResolvedValue(weatherRow(60_000) as never)
    const res = await GET()
    const data = await res.json()
    expect(res.status).toBe(500)
    expect(data.ok).toBe(false)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
