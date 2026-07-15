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
    // Per-feed normalized tables (demo risk #3 — per-feed status + last-updated).
    sportsGame: { findFirst: vi.fn() },
    sportsInjury: { findFirst: vi.fn() },
    sportsNews: { findFirst: vi.fn() },
    fantasyProjection: { findFirst: vi.fn() },
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
function fetchedRow(ageMs: number) {
  return { fetchedAt: new Date(Date.now() - ageMs) }
}
function setCaches(sports: unknown, weather: unknown) {
  vi.mocked(prisma.sportsDataCache.findFirst).mockResolvedValue(sports as never)
  vi.mocked(prisma.weatherCache.findFirst).mockResolvedValue(weather as never)
}
function setFeeds(feeds: { scores?: unknown; injuries?: unknown; news?: unknown; projections?: unknown }) {
  vi.mocked(prisma.sportsGame.findFirst).mockResolvedValue((feeds.scores ?? null) as never)
  vi.mocked(prisma.sportsInjury.findFirst).mockResolvedValue((feeds.injuries ?? null) as never)
  vi.mocked(prisma.sportsNews.findFirst).mockResolvedValue((feeds.news ?? null) as never)
  vi.mocked(prisma.fantasyProjection.findFirst).mockResolvedValue((feeds.projections ?? null) as never)
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

  it('reports per-feed status + last-updated for each live feed (real timestamps, honest null when a feed has no rows)', async () => {
    setCaches(sportsRow(60_000), weatherRow(60_000))
    // Scores/injuries/news have recent rows; projections has none (on-demand only — honest empty).
    setFeeds({
      scores: fetchedRow(2 * 60 * 60 * 1000), // 2h ago
      injuries: fetchedRow(5 * 60 * 60 * 1000), // 5h ago
      news: fetchedRow(30 * 60 * 1000), // 30m ago
      projections: null,
    })
    const res = await GET()
    const data = await res.json()

    expect(data.feeds.scores.ok).toBe(true)
    expect(typeof data.feeds.scores.lastSyncedAt).toBe('string')
    expect(data.feeds.injuries.ok).toBe(true)
    expect(data.feeds.news.ok).toBe(true)
    expect(data.feeds.weather.ok).toBe(true)
    // Projections has no rows — reported as an honest empty, never a fabricated "connected".
    expect(data.feeds.projections.ok).toBe(false)
    expect(data.feeds.projections.lastSyncedAt).toBeNull()
  })

  it('per-feed staleness does NOT flip the top-level chip (offseason: scores stale but chain alive)', async () => {
    setCaches(sportsRow(60_000), weatherRow(60_000)) // chain is alive (fresh cache write)
    setFeeds({
      scores: fetchedRow(FRESH_WINDOW_MS + 60_000), // scores stale (no games — offseason)
      injuries: fetchedRow(FRESH_WINDOW_MS + 60_000),
      news: fetchedRow(30 * 60 * 1000),
      projections: null,
    })
    const res = await GET()
    const data = await res.json()
    // Chip stays connected — the pipe is alive even though scores/injuries legitimately idle.
    expect(data.ok).toBe(true)
    expect(data.feeds.scores.ok).toBe(false)
    expect(data.feeds.news.ok).toBe(true)
  })

  it('a single feed query failure degrades that feed to null, never a whole-check 500', async () => {
    setCaches(sportsRow(60_000), weatherRow(60_000))
    vi.mocked(prisma.sportsGame.findFirst).mockRejectedValue(new Error('feed table unavailable'))
    vi.mocked(prisma.sportsInjury.findFirst).mockResolvedValue(fetchedRow(60_000) as never)
    vi.mocked(prisma.sportsNews.findFirst).mockResolvedValue(fetchedRow(60_000) as never)
    vi.mocked(prisma.fantasyProjection.findFirst).mockResolvedValue(null as never)
    const res = await GET()
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.feeds.scores.ok).toBe(false)
    expect(data.feeds.scores.lastSyncedAt).toBeNull()
    expect(data.feeds.injuries.ok).toBe(true)
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
