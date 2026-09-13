import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * The inning label ("Bot 7th") follows the baseball DATA, not `sport === 'MLB'`.
 *
 * A baseball feed from a sport not yet added to the app (college baseball) would
 * otherwise read "P7" — a period number with no half — beside a working diamond.
 * NCAAB is used as the carrier sport only because it is a real supported sport
 * whose clock label would be "P7" without this rule.
 */
const getLiveScoresForSport = vi.fn()
const getCachedLiveScoresForSport = vi.fn()

vi.mock('@/lib/sports-live-scores-service', () => ({
  getLiveScoresForSport: (...a: unknown[]) => getLiveScoresForSport(...a),
  getCachedLiveScoresForSport: (...a: unknown[]) => getCachedLiveScoresForSport(...a),
  hasStarted: (status: unknown) => /in_progress|final|halftime/i.test(String(status)),
  LIVE_SCORES_FRESHNESS_MS: 60_000,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/live/playFeedPresentation', () => ({ getPlayFeed: vi.fn(async () => []) }))
vi.mock('@/lib/live/winProbability', () => ({ estimateWinProbability: () => null }))

const NOW = Date.parse('2026-09-13T19:00:00Z')

const baseRow = {
  gameId: 'g1',
  homeTeam: 'H',
  awayTeam: 'A',
  homeTeamFull: 'Home',
  awayTeamFull: 'Away',
  homeLogo: '',
  awayLogo: '',
  homeScore: 3,
  awayScore: 2,
  homeRecord: null,
  awayRecord: null,
  status: 'STATUS_IN_PROGRESS',
  statusDetail: 'Bot 7th',
  period: 7,
  clock: '0:00',
  completed: false,
  startTime: '2026-09-13T17:10:00Z',
  venue: null,
  broadcast: null,
  odds: null,
  overUnder: null,
  week: null,
  season: 2026,
  topPerformer: null,
}

const baseballSituation = {
  downDistanceText: null,
  shortDownDistanceText: null,
  distance: null,
  possessionTeamId: null,
  ballOnFromAway: null,
  isRedZone: false,
  homeTimeouts: null,
  awayTimeouts: null,
  lastPlayText: null,
  lastPlayType: null,
  baseball: { onFirst: false, onSecond: false, onThird: false, balls: 1, strikes: 1, outs: 1, batter: null, pitcher: null },
}

async function labelFor(row: Record<string, unknown>) {
  getLiveScoresForSport.mockResolvedValue({
    scores: [row],
    fetchedAt: '2026-09-13T19:00:00Z',
    source: 'espn_live',
    refreshed: true,
    hasLiveGames: true,
    nextRefreshMs: 60_000,
  })
  getCachedLiveScoresForSport.mockResolvedValue({ scores: [], fetchedAt: null })
  const { getLivePageData } = await import('@/lib/live/liveScoresPage')
  const data = await getLivePageData({ userId: null, sport: 'NCAAB', scope: 'all' })
  return data.games[0]?.clockLabel
}

describe('baseball inning label', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    getLiveScoresForSport.mockReset()
    getCachedLiveScoresForSport.mockReset()
  })

  it('reads the feed\'s "Bot 7th" when the row carries baseball data, whatever the sport', async () => {
    expect(await labelFor({ ...baseRow, leaders: [], situation: baseballSituation })).toBe('Bot 7th')
  })

  it('control: the same row without baseball data keeps the sport\'s period label', async () => {
    expect(await labelFor({ ...baseRow })).toBe('P7 · 0:00')
  })
})
