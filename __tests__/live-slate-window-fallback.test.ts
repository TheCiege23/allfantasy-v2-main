import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * "College Football 0" while nine NCAAF games sat in our own table.
 *
 * Measured on production 2026-08-29T00:43Z. ESPN's college-football scoreboard
 * returned 25 events whose EARLIEST kickoff was 08-29 19:00Z — seventeen minutes
 * past the end of the `now-6h .. now+18h` slate window — with the rest on
 * September 4-5. `getLiveScoresForSport` breaks its provider loop on
 * `rows.length === 0`, so 25 out-of-window rows counted as success, replaced the
 * cached rows, and the window then removed all of them.
 *
 * NFL never showed the bug because that night's NFL games fell inside the
 * window. The failure needs a provider that answers about a DIFFERENT DAY, which
 * is normal for college football in late August.
 */
const getLiveScoresForSport = vi.fn()
const getCachedLiveScoresForSport = vi.fn()

vi.mock('@/lib/sports-live-scores-service', () => ({
  getLiveScoresForSport: (...a: unknown[]) => getLiveScoresForSport(...a),
  getCachedLiveScoresForSport: (...a: unknown[]) => getCachedLiveScoresForSport(...a),
  // Real enough for these rows: every fixture here is STATUS_SCHEDULED, so the
  // card's score is withheld — which is the behaviour the assertions rely on.
  hasStarted: (status: unknown) => /in_progress|final|halftime/i.test(String(status)),
  LIVE_SCORES_FRESHNESS_MS: 60_000,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/live/playFeedPresentation', () => ({ getPlayFeed: vi.fn(async () => []) }))
vi.mock('@/lib/live/winProbability', () => ({ estimateWinProbability: () => null }))

const NOW = Date.parse('2026-08-29T00:43:00Z')

/** Minimal row: only startTime matters to the window. */
const row = (startTime: string, gameId: string) => ({
  gameId,
  homeTeam: 'H',
  awayTeam: 'A',
  homeTeamFull: 'Home',
  awayTeamFull: 'Away',
  homeLogo: '',
  awayLogo: '',
  homeScore: 0,
  awayScore: 0,
  homeRecord: null,
  awayRecord: null,
  status: 'STATUS_SCHEDULED',
  statusDetail: 'Scheduled',
  period: 0,
  clock: '',
  completed: false,
  startTime,
  venue: null,
  broadcast: null,
  odds: null,
  overUnder: null,
  week: null,
  season: 2026,
  topPerformer: null,
})

describe('live slate window fallback', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    getLiveScoresForSport.mockReset()
    getCachedLiveScoresForSport.mockReset()
  })

  it('falls back to cache when the provider answered about a different day', async () => {
    // ESPN's real response: earliest 19:00Z, 17 minutes past the window end.
    getLiveScoresForSport.mockResolvedValue({
      scores: [row('2026-08-29T19:00:00Z', 'espn-1'), row('2026-09-04T00:00:00Z', 'espn-2')],
      fetchedAt: '2026-08-29T00:43:00Z',
      source: 'espn_live',
      refreshed: true,
      hasLiveGames: false,
      nextRefreshMs: 60_000,
    })
    // Our own table, with games actually near now.
    getCachedLiveScoresForSport.mockResolvedValue({
      scores: [row('2026-08-28T22:00:00Z', 'db-1'), row('2026-08-29T01:00:00Z', 'db-2')],
      fetchedAt: '2026-08-29T00:35:00Z',
      source: 'db_cache',
      refreshed: false,
      hasLiveGames: false,
      nextRefreshMs: 300_000,
    })

    const { getLivePageData } = await import('@/lib/live/liveScoresPage')
    const data = await getLivePageData({ userId: null, sport: 'NCAAF', scope: 'all' })

    const ncaaf = data.counts.find((c) => c.sport === 'NCAAF')
    expect(ncaaf?.slateCount, 'reported an empty slate while games sat in our own table').toBe(2)
    expect(getCachedLiveScoresForSport).toHaveBeenCalled()
  })

  it('keeps the live response when it DOES have in-window games', async () => {
    getLiveScoresForSport.mockResolvedValue({
      scores: [row('2026-08-29T01:00:00Z', 'espn-live-1')],
      fetchedAt: '2026-08-29T00:43:00Z',
      source: 'espn_live',
      refreshed: true,
      hasLiveGames: true,
      nextRefreshMs: 60_000,
    })
    getCachedLiveScoresForSport.mockResolvedValue({
      scores: [row('2026-08-29T02:00:00Z', 'db-1')],
      fetchedAt: '2026-08-29T00:00:00Z',
      source: 'db_cache',
      refreshed: false,
      hasLiveGames: false,
      nextRefreshMs: 300_000,
    })

    const { getLivePageData } = await import('@/lib/live/liveScoresPage')
    const data = await getLivePageData({ userId: null, sport: 'NCAAF', scope: 'all' })

    // The live feed wins when it is actually about today — the fallback is a
    // rescue, not a preference.
    expect(data.games.some((g) => g.gameId === 'espn-live-1')).toBe(true)
  })

  it('still reports an empty slate when there genuinely are no games near now', async () => {
    // An out-of-season sport must keep reading 0. That zero is correct and the
    // fallback must not manufacture a slate from a whole cached season.
    getLiveScoresForSport.mockResolvedValue({
      scores: [row('2026-12-01T00:00:00Z', 'far-1')],
      fetchedAt: null, source: 'db_cache', refreshed: false, hasLiveGames: false, nextRefreshMs: 0,
    })
    getCachedLiveScoresForSport.mockResolvedValue({
      scores: [row('2026-12-02T00:00:00Z', 'far-2')],
      fetchedAt: null, source: 'db_cache', refreshed: false, hasLiveGames: false, nextRefreshMs: 0,
    })

    const { getLivePageData } = await import('@/lib/live/liveScoresPage')
    const data = await getLivePageData({ userId: null, sport: 'NCAAF', scope: 'all' })
    expect(data.counts.find((c) => c.sport === 'NCAAF')?.slateCount).toBe(0)
  })
})
