import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * College Baseball on Live Scores — a LIVE-ONLY sport (user decision 2026-09-13).
 *
 * The trap this pins: every league sport normalizer turns an unknown sport into
 * NFL, silently. Before this change `?sport=NCAABASE` rendered the NFL slate and a
 * clicked college game fetched an NFL summary under a college event id.
 */

import {
  LIVE_ONLY_SPORTS,
  SUPPORTED_SPORTS,
  isLiveSport,
  normalizeToLiveSport,
  normalizeToSupportedSport,
} from '@/lib/sport-scope'
import { gameDetailHref } from '@/lib/live/gameDetailLink'

describe('sport scope', () => {
  it('College Baseball is a live-only sport, never a league sport', () => {
    expect(LIVE_ONLY_SPORTS).toEqual(['NCAABASE', 'WNBA'])
    expect(SUPPORTED_SPORTS).not.toContain('NCAABASE')
    expect(isLiveSport('NCAABASE')).toBe(true)
    expect(isLiveSport('ncaabase')).toBe(true)
    expect(isLiveSport('XFL')).toBe(false)
  })

  it('the live normalizer keeps college baseball; the league one still falls back to NFL', () => {
    for (const alias of ['NCAABASE', 'cbase', 'College Baseball', 'ncaa-baseball']) {
      expect(normalizeToLiveSport(alias)).toBe('NCAABASE')
    }
    expect(normalizeToLiveSport('ncaabb')).toBe('NCAAB')
    expect(normalizeToLiveSport('NFL')).toBe('NFL')
    // Unchanged league behaviour — a league flow must never be offered this sport.
    expect(normalizeToSupportedSport('NCAABASE')).toBe('NFL')
  })

  it('a college baseball card links to the game view', () => {
    expect(gameDetailHref({ sport: 'NCAABASE', gameId: '401874384', espnDetail: true }, '/live')).toBe(
      '/live?sport=NCAABASE&game=401874384',
    )
  })
})

describe('the live page asks for college baseball, not NFL', () => {
  const getLiveScoresForSport = vi.fn()
  const getCachedLiveScoresForSport = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T18:00:00Z'))
    getLiveScoresForSport.mockReset().mockResolvedValue({
      scores: [], fetchedAt: null, source: 'db_cache', refreshed: false, hasLiveGames: false, nextRefreshMs: 60_000,
    })
    getCachedLiveScoresForSport.mockReset().mockResolvedValue({ scores: [], fetchedAt: null })
    vi.doMock('@/lib/sports-live-scores-service', () => ({
      getLiveScoresForSport: (...a: unknown[]) => getLiveScoresForSport(...a),
      getCachedLiveScoresForSport: (...a: unknown[]) => getCachedLiveScoresForSport(...a),
      hasStarted: () => false,
      LIVE_SCORES_FRESHNESS_MS: 60_000,
    }))
    vi.doMock('@/lib/prisma', () => ({ prisma: {} }))
    vi.doMock('@/lib/live/playFeedPresentation', () => ({ getPlayFeed: vi.fn(async () => []) }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.doUnmock('@/lib/sports-live-scores-service')
    vi.doUnmock('@/lib/prisma')
    vi.doUnmock('@/lib/live/playFeedPresentation')
  })

  it('fetches the NCAABASE slate for the Eastern days in the window, and labels the tab', async () => {
    const { getLivePageData } = await import('@/lib/live/liveScoresPage')
    const data = await getLivePageData({ userId: null, sport: 'NCAABASE', scope: 'all' })
    expect(data.sport).toBe('NCAABASE')
    expect(getLiveScoresForSport).toHaveBeenCalledTimes(1)
    expect(getLiveScoresForSport.mock.calls[0]![0]).toMatchObject({ sport: 'NCAABASE', espnDates: ['20260418', '20260419'] })
    expect(data.counts.find((c) => c.sport === 'NCAABASE')?.label).toBe('College Baseball')
    // Every other tab, including NFL, is only counted from the cache.
    expect(getCachedLiveScoresForSport.mock.calls.map((c) => (c[0] as { sport: string }).sport)).toContain('NFL')
  })
})

/* ── The service: ESPN college baseball, persisted, never Rolling Insights ─────── */

function cbaseEvent(id: string) {
  return {
    id,
    date: '2026-04-18T18:00Z',
    season: { year: 2026 },
    competitions: [
      {
        startDate: '2026-04-18T18:00Z',
        status: { type: { name: 'STATUS_IN_PROGRESS', shortDetail: 'Top 5th', completed: false }, period: 5, displayClock: '0:00' },
        competitors: [
          { homeAway: 'home', score: '3', hits: 7, errors: 1, team: { abbreviation: 'MSST', displayName: 'Mississippi State Bulldogs', logo: '', id: '150' }, linescores: [{ displayValue: '1' }, { displayValue: '2' }] },
          { homeAway: 'away', score: '2', hits: 5, errors: 0, team: { abbreviation: 'UGA', displayName: 'Georgia Bulldogs', logo: '', id: '78' }, linescores: [{ displayValue: '0' }, { displayValue: '2' }] },
        ],
      },
    ],
  }
}

describe('getLiveScoresForSport — NCAABASE', () => {
  const fetchMock = vi.fn()
  const upsert = vi.fn(async () => ({}))
  const fetchWithChain = vi.fn(async () => ({ data: [] }))

  beforeEach(() => {
    vi.resetModules()
    fetchMock.mockReset()
    upsert.mockClear()
    fetchWithChain.mockClear()
    vi.stubGlobal('fetch', fetchMock)
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        sportsGame: { findMany: vi.fn(async () => []), upsert },
        sportsDataCache: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
      },
    }))
    vi.doMock('@/lib/workers/api-chain', () => ({ fetchWithChain }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('@/lib/prisma')
    vi.doUnmock('@/lib/workers/api-chain')
  })

  const ok = (body: unknown) => ({ ok: true, json: async () => body })
  const urls = () => fetchMock.mock.calls.map((c) => String(c[0]))

  it('reads the college-baseball scoreboard, keeps R-H-E, and stores the rows as NCAABASE', async () => {
    fetchMock.mockImplementation(async () => ok({ events: [cbaseEvent('401900111')] }))
    const { getLiveScoresForSport } = await import('@/lib/sports-live-scores-service')
    const result = await getLiveScoresForSport({ sport: 'NCAABASE' })

    expect(urls().length).toBeGreaterThan(0)
    expect(urls().every((u) => u.includes('/baseball/college-baseball/scoreboard'))).toBe(true)
    expect(result.scores[0]).toMatchObject({ gameId: '401900111', homeHits: 7, homeErrors: 1, awayHits: 5, statusDetail: 'Top 5th' })
    expect((upsert.mock.calls[0]![0] as { create: { sport: string } }).create.sport).toBe('NCAABASE')
    expect(fetchWithChain).not.toHaveBeenCalled()
  })

  it('an empty off-season scoreboard is not asked for again on every poll', async () => {
    fetchMock.mockImplementation(async () => ok({ events: [] }))
    const { getLiveScoresForSport } = await import('@/lib/sports-live-scores-service')
    await getLiveScoresForSport({ sport: 'NCAABASE' })
    const afterFirst = fetchMock.mock.calls.length
    expect(afterFirst).toBeGreaterThan(0)

    await getLiveScoresForSport({ sport: 'NCAABASE' })
    expect(fetchMock.mock.calls.length).toBe(afterFirst)
    // Rolling Insights has no college baseball and is never asked.
    expect(fetchWithChain).not.toHaveBeenCalled()

    // A forced refresh still goes through.
    await getLiveScoresForSport({ sport: 'NCAABASE', forceRefresh: true })
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirst)
  })

  it('control: an empty NFL scoreboard keeps asking, as before', async () => {
    fetchMock.mockImplementation(async () => ok({ events: [] }))
    const { getLiveScoresForSport } = await import('@/lib/sports-live-scores-service')
    await getLiveScoresForSport({ sport: 'NFL' })
    const afterFirst = fetchMock.mock.calls.length
    await getLiveScoresForSport({ sport: 'NFL' })
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirst)
  })

  it('the game view fetches the COLLEGE summary and caches it under NCAABASE', async () => {
    const { rawMlb } = await import('./fixtures/espn-mlb-summary')
    fetchMock.mockImplementation(async () => ok(rawMlb()))
    const cacheUpsert = vi.fn(async () => ({}))
    vi.doMock('@/lib/prisma', () => ({
      prisma: { sportsDataCache: { findUnique: vi.fn(async () => null), upsert: cacheUpsert } },
    }))
    const { getEspnGameSummary } = await import('@/lib/sports-live-scores-service')
    const res = await getEspnGameSummary({ sport: 'NCAABASE', gameId: '401874384' })

    expect(urls()[0]).toContain('/baseball/college-baseball/summary')
    expect(urls()[0]).toContain('event=401874384')
    expect(res.detail?.baseball).not.toBeNull()
    expect(res.detail?.sport).toBe('NCAABASE')
    expect((cacheUpsert.mock.calls[0]![0] as { where: { cacheKey: string } }).where.cacheKey).toBe(
      'espn:summary:v1:NCAABASE:401874384',
    )
  })
})
