import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * College football's live field needs ESPN's DATED scoreboard.
 *
 * Measured 2026-09-13: the undated college-football scoreboard is a 24-game
 * featured subset across the week; the dated FBS day is 80 (2026-09-12) or 71
 * (2026-09-19). Games missing from the undated call arrive with no `situation`,
 * so their cards cannot draw down, distance or the ball.
 */

import { espnScoreboardDatesForWindow } from '@/lib/live/espnGamePresentation'

const H = 60 * 60 * 1000

describe('espnScoreboardDatesForWindow', () => {
  it('covers a Saturday slate window (-6h .. +18h) as two US Eastern days', () => {
    const now = Date.parse('2026-09-12T18:00:00Z') // 2pm ET Saturday
    expect(espnScoreboardDatesForWindow(now - 6 * H, now + 18 * H)).toEqual(['20260912', '20260913'])
  })

  it('uses the EASTERN date, not UTC, for a late-night window', () => {
    // 01:00Z–03:00Z on the 13th is 9pm–11pm ET on the 12th. A UTC date would ask for the 13th.
    const from = Date.parse('2026-09-13T01:00:00Z')
    const to = Date.parse('2026-09-13T03:00:00Z')
    expect(espnScoreboardDatesForWindow(from, to)).toEqual(['20260912'])
  })

  it('returns nothing for a reversed or invalid window', () => {
    expect(espnScoreboardDatesForWindow(10, 5)).toEqual([])
    expect(espnScoreboardDatesForWindow(Number.NaN, 5)).toEqual([])
  })
})

/* ── The live page passes the dates for NCAAF only ─────────────────────────── */

describe('live page asks for dated ESPN slates for college football only', () => {
  const getLiveScoresForSport = vi.fn()
  const getCachedLiveScoresForSport = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T18:00:00Z'))
    getLiveScoresForSport.mockReset().mockResolvedValue({
      scores: [],
      fetchedAt: null,
      source: 'db_cache',
      refreshed: false,
      hasLiveGames: false,
      nextRefreshMs: 60_000,
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

  it('NCAAF: passes the Eastern days the slate window covers', async () => {
    const { getLivePageData } = await import('@/lib/live/liveScoresPage')
    await getLivePageData({ userId: null, sport: 'NCAAF', scope: 'all' })
    expect(getLiveScoresForSport).toHaveBeenCalledTimes(1)
    expect(getLiveScoresForSport.mock.calls[0]![0]).toMatchObject({
      sport: 'NCAAF',
      espnDates: ['20260912', '20260913'],
    })
  })

  it('control: NFL keeps the undated call', async () => {
    const { getLivePageData } = await import('@/lib/live/liveScoresPage')
    await getLivePageData({ userId: null, sport: 'NFL', scope: 'all' })
    expect(getLiveScoresForSport).toHaveBeenCalledTimes(1)
    expect(getLiveScoresForSport.mock.calls[0]![0].espnDates).toBeUndefined()
  })
})

/* ── The service puts the dates on the ESPN URL, and falls back when empty ──── */

function espnEvent(id: string) {
  return {
    id,
    date: '2026-09-12T19:30Z',
    season: { year: 2026 },
    week: { number: 3 },
    competitions: [
      {
        startDate: '2026-09-12T19:30Z',
        status: { type: { name: 'STATUS_IN_PROGRESS', shortDetail: '8:12 - 2nd', completed: false }, period: 2, displayClock: '8:12' },
        competitors: [
          { homeAway: 'home', score: '14', team: { abbreviation: 'TEX', displayName: 'Texas Longhorns', logo: '', id: '251' } },
          { homeAway: 'away', score: '7', team: { abbreviation: 'OSU', displayName: 'Ohio State Buckeyes', logo: '', id: '194' } },
        ],
        situation: { possessionText: 'TEX 35', possession: '194', downDistanceText: '2nd & 7 at TEX 35', distance: 7 },
      },
    ],
  }
}

describe('getLiveScoresForSport with espnDates', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        sportsGame: { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) },
        sportsDataCache: { findUnique: vi.fn(async () => null) },
      },
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('@/lib/prisma')
  })

  const ok = (events: unknown[]) => ({ ok: true, json: async () => ({ events }) })
  const espnUrls = () =>
    fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('college-football/scoreboard'))

  it('requests each dated day, and the card data carries the placed ball', async () => {
    fetchMock.mockImplementation(async () => ok([espnEvent('401900001')]))
    const { getLiveScoresForSport } = await import('@/lib/sports-live-scores-service')
    const result = await getLiveScoresForSport({ sport: 'NCAAF', espnDates: ['20260912', '20260913'] })

    const urls = espnUrls()
    expect(urls.some((u) => u.includes('dates=20260912'))).toBe(true)
    expect(urls.some((u) => u.includes('dates=20260913'))).toBe(true)
    expect(urls.every((u) => u.includes('dates='))).toBe(true)
    // TEX is home; OSU has the ball on the TEX 35 → 65 yards from the away goal line.
    expect(result.scores[0]?.situation?.ballOnFromAway).toBe(65)
  })

  it('falls back to the undated scoreboard when the dated days are empty', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('dates=') ? ok([]) : ok([espnEvent('401900002')]),
    )
    const { getLiveScoresForSport } = await import('@/lib/sports-live-scores-service')
    const result = await getLiveScoresForSport({ sport: 'NCAAF', espnDates: ['20260915'] })

    const urls = espnUrls()
    expect(urls.some((u) => u.includes('dates=20260915'))).toBe(true)
    expect(urls.some((u) => !u.includes('dates='))).toBe(true)
    expect(result.scores.map((s) => s.gameId)).toEqual(['401900002'])
  })

  it('control: without espnDates the call is undated, exactly as before', async () => {
    fetchMock.mockImplementation(async () => ok([espnEvent('401900003')]))
    const { getLiveScoresForSport } = await import('@/lib/sports-live-scores-service')
    await getLiveScoresForSport({ sport: 'NCAAF' })

    const urls = espnUrls()
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.every((u) => !u.includes('dates='))).toBe(true)
  })
})
