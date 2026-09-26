import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * The WNBA on Live Scores — a LIVE-ONLY sport like College Baseball: a scoreboard
 * tab, the basketball score card and the clicked-game view, and no league anywhere.
 *
 * Two traps this pins. The league normalizer turns an unknown sport into NFL. And
 * `normalizeTeamAbbrev` is the NFL table, which renamed the WNBA's "LA" Sparks
 * "LAR" and the Washington Mystics "WAS".
 */

import { SUPPORTED_SPORTS, isLiveOnlySport, isLiveSport, normalizeToLiveSport, normalizeToSupportedSport } from '@/lib/sport-scope'
import { gameDetailHref } from '@/lib/live/gameDetailLink'
import { basketballPeriodLabel, isBasketballSport } from '@/lib/live/espnGamePresentation'
import { nbaScoreboardEvent } from './fixtures/espn-nba-scoreboard'

describe('sport scope', () => {
  it('the WNBA is a live-only basketball sport, never a league sport', () => {
    expect(isLiveOnlySport('WNBA')).toBe(true)
    expect(isLiveSport('wnba')).toBe(true)
    expect(SUPPORTED_SPORTS).not.toContain('WNBA')
    expect(normalizeToLiveSport('wnba')).toBe('WNBA')
    // Unchanged league behaviour — no league flow is offered this sport.
    expect(normalizeToSupportedSport('WNBA')).toBe('NFL')
    expect(isBasketballSport('WNBA')).toBe(true)
  })

  it('plays four quarters, then OT', () => {
    expect([1, 4, 5, 6].map((p) => basketballPeriodLabel('WNBA', p))).toEqual(['Q1', 'Q4', 'OT', '2OT'])
  })

  it('a WNBA card links to the game view', () => {
    expect(gameDetailHref({ sport: 'WNBA', gameId: '401892393', espnDetail: true }, '/core/live')).toBe(
      '/core/live?sport=WNBA&game=401892393',
    )
  })
})

/* ── The page ────────────────────────────────────────────────────────────────── */

const NOW = Date.parse('2026-07-20T23:30:00Z')

const row = {
  gameId: '401857146',
  homeTeam: 'WSH',
  awayTeam: 'LA',
  homeTeamId: '16',
  awayTeamId: '6',
  homeTeamFull: 'Washington Mystics',
  awayTeamFull: 'Los Angeles Sparks',
  homeLogo: '',
  awayLogo: '',
  homeScore: 60,
  awayScore: 58,
  homeRecord: null,
  awayRecord: null,
  status: 'STATUS_IN_PROGRESS',
  statusDetail: '4:12 - 3rd',
  period: 3,
  clock: '4:12',
  completed: false,
  startTime: '2026-07-20T23:00:00Z',
  venue: null,
  broadcast: null,
  odds: null,
  overUnder: null,
  week: null,
  season: 2026,
  topPerformer: null,
  leaders: [],
}

describe('getLivePageData — WNBA', () => {
  const getLiveScoresForSport = vi.fn()
  const getCachedLiveScoresForSport = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    getLiveScoresForSport.mockReset().mockResolvedValue({
      scores: [row], fetchedAt: '2026-07-20T23:30:00Z', source: 'espn_live', refreshed: true, hasLiveGames: true, nextRefreshMs: 20_000,
    })
    getCachedLiveScoresForSport.mockReset().mockResolvedValue({ scores: [], fetchedAt: null })
    vi.doMock('@/lib/sports-live-scores-service', () => ({
      getLiveScoresForSport: (...a: unknown[]) => getLiveScoresForSport(...a),
      getCachedLiveScoresForSport: (...a: unknown[]) => getCachedLiveScoresForSport(...a),
      hasStarted: (status: unknown) => /in_progress|final|halftime/i.test(String(status)),
      LIVE_SCORES_FRESHNESS_MS: 60_000,
    }))
    vi.doMock('@/lib/prisma', () => ({ prisma: {} }))
    vi.doMock('@/lib/live/playFeedPresentation', () => ({ getPlayFeed: vi.fn(async () => []) }))
    vi.doMock('@/lib/live/winProbability', () => ({ estimateWinProbability: () => null }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.doUnmock('@/lib/sports-live-scores-service')
    vi.doUnmock('@/lib/prisma')
    vi.doUnmock('@/lib/live/playFeedPresentation')
    vi.doUnmock('@/lib/live/winProbability')
  })

  it('fetches the WNBA slate, labels its tab after the NBA, and reads a quarter clock', async () => {
    const { getLivePageData } = await import('@/lib/live/liveScoresPage')
    const data = await getLivePageData({ userId: null, sport: 'WNBA', scope: 'all' })
    expect(data.sport).toBe('WNBA')
    expect(getLiveScoresForSport.mock.calls[0]![0]).toMatchObject({ sport: 'WNBA', espnDates: undefined })
    expect(data.counts.map((c) => c.sport).slice(0, 3)).toEqual(['NFL', 'NBA', 'WNBA'])
    expect(data.counts.find((c) => c.sport === 'WNBA')?.label).toBe('WNBA')
    expect(data.games[0]?.clockLabel).toBe('Q3 · 4:12')
  })

  it("keeps ESPN's abbreviations: LA stays LA and WSH stays WSH", async () => {
    const { getLivePageData } = await import('@/lib/live/liveScoresPage')
    const g = (await getLivePageData({ userId: null, sport: 'WNBA', scope: 'all' })).games[0]!
    expect([g.away.abbrev, g.home.abbrev]).toEqual(['LA', 'WSH'])
  })

  it('control: NFL still uses its historical team aliases', async () => {
    const { getLivePageData } = await import('@/lib/live/liveScoresPage')
    const g = (await getLivePageData({ userId: null, sport: 'NFL', scope: 'all' })).games[0]!
    expect([g.away.abbrev, g.home.abbrev]).toEqual(['LAR', 'WAS'])
  })
})

/* ── The service ─────────────────────────────────────────────────────────────── */

describe('ESPN — WNBA', () => {
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

  function wnbaEvent() {
    const e = nbaScoreboardEvent('post', '401857146')
    e.competitions[0]!.competitors[0]!.team.abbreviation = 'WSH'
    e.competitions[0]!.competitors[1]!.team.abbreviation = 'LA'
    return e
  }

  it('reads the WNBA scoreboard, keeps its abbreviations and team box, stores WNBA, never asks Rolling Insights', async () => {
    fetchMock.mockImplementation(async () => ok({ events: [wnbaEvent()] }))
    const { getLiveScoresForSport } = await import('@/lib/sports-live-scores-service')
    const result = await getLiveScoresForSport({ sport: 'WNBA' })

    expect(urls().length).toBeGreaterThan(0)
    expect(urls().every((u) => u.includes('/basketball/wnba/scoreboard'))).toBe(true)
    expect(result.scores[0]).toMatchObject({ gameId: '401857146', homeTeam: 'WSH', awayTeam: 'LA' })
    expect(result.scores[0]!.homeShooting?.fieldGoals).toEqual({ made: 34, attempted: 88, pct: '38.6' })
    expect(result.scores[0]!.awayTeamLeaders?.length).toBe(3)
    expect((upsert.mock.calls[0]![0] as { create: { sport: string } }).create.sport).toBe('WNBA')
    expect(fetchWithChain).not.toHaveBeenCalled()
  })

  it('control: the NFL scoreboard still maps WSH to WAS', async () => {
    fetchMock.mockImplementation(async () => ok({ events: [wnbaEvent()] }))
    const { fetchEspnScoreboard } = await import('@/lib/sports-live-scores-service')
    const [r] = await fetchEspnScoreboard('NFL')
    expect([r!.homeTeam, r!.awayTeam]).toEqual(['WAS', 'LAR'])
  })

  it('the game view fetches the WNBA summary, caches it under WNBA, and draws the WNBA court', async () => {
    const { rawWnba } = await import('./fixtures/espn-wnba-summary')
    fetchMock.mockImplementation(async () => ok(rawWnba()))
    const cacheUpsert = vi.fn(async () => ({}))
    vi.doMock('@/lib/prisma', () => ({
      prisma: { sportsDataCache: { findUnique: vi.fn(async () => null), upsert: cacheUpsert } },
    }))
    const { getEspnGameSummary } = await import('@/lib/sports-live-scores-service')
    const res = await getEspnGameSummary({ sport: 'WNBA', gameId: '401892393' })

    expect(urls()[0]).toContain('/basketball/wnba/summary')
    expect(urls()[0]).toContain('event=401892393')
    expect(res.detail?.basketball?.court).toBe('wnba')
    expect((cacheUpsert.mock.calls[0]![0] as { where: { cacheKey: string } }).where.cacheKey).toBe('espn:summary:v1:WNBA:401892393')
  })
})
