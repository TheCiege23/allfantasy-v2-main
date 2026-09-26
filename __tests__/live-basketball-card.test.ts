import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * The NBA and college basketball score card: each team's leaders and shooting,
 * a "Q3 · 5:42" clock, and Q1–Q4 / OT (or 1H 2H / OT) period names.
 *
 * The trap the service half pins: ESPN's basketball scoreboard sends no GAME
 * leaders, and before tip-off the per-team fields hold SEASON numbers.
 */

import { pickTeamLeaders, teamShooting } from '@/lib/live/espnGamePresentation'
import { CHA_LEADERS, CHA_STATS, DET_LEADERS, DET_STATS, nbaScoreboardEvent } from './fixtures/espn-nba-scoreboard'

/* ── The service: reading the scoreboard ─────────────────────────────────────── */

describe('fetchEspnScoreboard — basketball team box', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.doMock('@/lib/prisma', () => ({ prisma: {} }))
    vi.doMock('@/lib/workers/api-chain', () => ({ fetchWithChain: vi.fn(async () => ({ data: [] })) }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('@/lib/prisma')
    vi.doUnmock('@/lib/workers/api-chain')
  })

  const serve = (event: unknown) => fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ events: [event] }) }))

  it('reads each TEAM leaders and shooting from a finished NBA game', async () => {
    serve(nbaScoreboardEvent('post'))
    const { fetchEspnScoreboard } = await import('@/lib/sports-live-scores-service')
    const [row] = await fetchEspnScoreboard('NBA')

    expect(row!.homeTeamLeaders!.map((l) => `${l.label} ${l.shortName} ${l.statLine}`)).toEqual(['Pts L. Ball 27', 'Reb M. Bridges 8', 'Ast L. Ball 8'])
    expect(row!.awayTeamLeaders!.map((l) => l.shortName)).toEqual(['J. Duren', 'J. Duren', 'C. Cunningham'])
    expect(row!.homeShooting?.fieldGoals).toEqual({ made: 34, attempted: 88, pct: '38.6' })
    expect(row!.awayShooting?.freeThrows).toEqual({ made: 19, attempted: 26, pct: '73.1' })
    // The game itself names no leaders on this feed; it is still an ESPN row.
    expect(row!.leaders).toEqual([])
  })

  it('takes nothing before tip-off, although the same fields are full of season numbers', async () => {
    serve(nbaScoreboardEvent('pre'))
    const { fetchEspnScoreboard } = await import('@/lib/sports-live-scores-service')
    const [row] = await fetchEspnScoreboard('NBA')

    expect(row!.homeTeamLeaders).toEqual([])
    expect(row!.awayTeamLeaders).toEqual([])
    // 1,254 field goals made is a season total — never tonight's line.
    expect(row!.homeShooting).toBeNull()
    expect(row!.awayShooting).toBeNull()
  })

  it('reads a game in progress', async () => {
    serve(nbaScoreboardEvent('in'))
    const { fetchEspnScoreboard } = await import('@/lib/sports-live-scores-service')
    const [row] = await fetchEspnScoreboard('NCAAB')
    expect(row!.homeShooting?.threePointers).toEqual({ made: 13, attempted: 47, pct: '27.7' })
  })

  it('control: hockey competitors send `points` and `assists` too, and grow no team box', async () => {
    serve(nbaScoreboardEvent('post'))
    const { fetchEspnScoreboard } = await import('@/lib/sports-live-scores-service')
    const [row] = await fetchEspnScoreboard('NHL')
    expect(row).not.toHaveProperty('homeTeamLeaders')
    expect(row).not.toHaveProperty('homeShooting')
  })
})

/* ── The page: clock, team sides, remembered presentation ────────────────────── */

const NOW = Date.parse('2026-04-10T23:30:00Z')

const baseRow = {
  gameId: 'g1',
  homeTeam: 'CHA',
  awayTeam: 'DET',
  homeTeamId: '30',
  awayTeamId: '8',
  homeTeamFull: 'Charlotte Hornets',
  awayTeamFull: 'Detroit Pistons',
  homeLogo: '',
  awayLogo: '',
  homeScore: 90,
  awayScore: 93,
  homeRecord: null,
  awayRecord: null,
  status: 'STATUS_IN_PROGRESS',
  statusDetail: '5:42 - 3rd',
  period: 3,
  clock: '5:42',
  completed: false,
  startTime: '2026-04-10T23:00:00Z',
  venue: null,
  broadcast: null,
  odds: null,
  overUnder: null,
  week: null,
  season: 2026,
  topPerformer: null,
}

describe('getLivePageData — basketball', () => {
  const getLiveScoresForSport = vi.fn()
  const getCachedLiveScoresForSport = vi.fn()
  const estimate = vi.fn(() => ({ home: 55, away: 45, isEstimate: true }))

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    getLiveScoresForSport.mockReset()
    getCachedLiveScoresForSport.mockReset().mockResolvedValue({ scores: [], fetchedAt: null })
    vi.doMock('@/lib/sports-live-scores-service', () => ({
      getLiveScoresForSport: (...a: unknown[]) => getLiveScoresForSport(...a),
      getCachedLiveScoresForSport: (...a: unknown[]) => getCachedLiveScoresForSport(...a),
      hasStarted: (status: unknown) => /in_progress|final|halftime/i.test(String(status)),
      LIVE_SCORES_FRESHNESS_MS: 60_000,
    }))
    vi.doMock('@/lib/prisma', () => ({ prisma: {} }))
    vi.doMock('@/lib/live/playFeedPresentation', () => ({ getPlayFeed: vi.fn(async () => []) }))
    estimate.mockClear()
    vi.doMock('@/lib/live/winProbability', () => ({ estimateWinProbability: estimate }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.doUnmock('@/lib/sports-live-scores-service')
    vi.doUnmock('@/lib/prisma')
    vi.doUnmock('@/lib/live/playFeedPresentation')
    vi.doUnmock('@/lib/live/winProbability')
  })

  async function gameFor(sport: string, row: Record<string, unknown>) {
    getLiveScoresForSport.mockResolvedValue({
      scores: [row],
      fetchedAt: '2026-04-10T23:30:00Z',
      source: 'espn_live',
      refreshed: true,
      hasLiveGames: true,
      nextRefreshMs: 20_000,
    })
    const { getLivePageData } = await import('@/lib/live/liveScoresPage')
    const data = await getLivePageData({ userId: null, sport, scope: 'all' })
    return data.games[0]!
  }

  it('does not apply an NFL estimate to baseball, basketball, scheduled games or final results', async () => {
    for (const sport of ['MLB', 'NBA', 'NCAAF']) {
      expect((await gameFor(sport, { ...baseRow, period: 1, clock: '15:00' })).winProbability).toBeNull()
    }
    expect((await gameFor('NFL', { ...baseRow, status: 'STATUS_SCHEDULED' })).winProbability).toBeNull()
    expect((await gameFor('NFL', { ...baseRow, completed: true })).winProbability).toBeNull()
    expect(estimate).not.toHaveBeenCalled()
    expect((await gameFor('NFL', { ...baseRow, period: 2, clock: '5:00' })).winProbability).toMatchObject({ home: 55 })
    expect(estimate).toHaveBeenCalledOnce()
  })

  it('preserves the Cardinals abbreviation in baseball cards', async () => {
    expect((await gameFor('MLB', { ...baseRow, homeTeam: 'STL' })).home.abbrev).toBe('STL')
  })

  it.each([
    ['NBA', 3, '5:42', 'Q3 · 5:42'],
    ['NBA', 5, '1:10', 'OT · 1:10'],
    ['NBA', 6, '0:31', '2OT · 0:31'],
    ['NCAAB', 2, '3:10', '2H · 3:10'],
    ['NCAAB', 3, '0:45', 'OT · 0:45'],
  ])('%s period %i at %s reads "%s"', async (sport, period, clock, label) => {
    expect((await gameFor(sport as string, { ...baseRow, period, clock })).clockLabel).toBe(label)
  })

  it('between periods it shows ESPN status text, not a "0.0" clock', async () => {
    expect((await gameFor('NBA', { ...baseRow, status: 'STATUS_HALFTIME', statusDetail: 'Halftime', period: 2, clock: '0.0' })).clockLabel).toBe('Halftime')
    expect((await gameFor('NBA', { ...baseRow, status: 'STATUS_END_PERIOD', statusDetail: 'End of 1st', period: 1, clock: '0.0' })).clockLabel).toBe('End of 1st')
  })

  it('control: other sports keep their labels', async () => {
    expect((await gameFor('NFL', { ...baseRow, period: 5, clock: '8:00' })).clockLabel).toBe('OT · 8:00')
    expect((await gameFor('NHL', { ...baseRow, period: 2, clock: '5:00' })).clockLabel).toBe('P2 · 5:00')
  })

  it('puts each team leaders and shooting on its own side', async () => {
    const g = await gameFor('NBA', {
      ...baseRow,
      leaders: [],
      homeTeamLeaders: pickTeamLeaders(CHA_LEADERS),
      awayTeamLeaders: pickTeamLeaders(DET_LEADERS),
      homeShooting: teamShooting(CHA_STATS),
      awayShooting: teamShooting(DET_STATS),
    })
    expect(g.home.leaders.map((l) => l.shortName)).toEqual(['L. Ball', 'M. Bridges', 'L. Ball'])
    expect(g.home.leaders.every((l) => l.teamAbbrev === g.home.abbrev)).toBe(true)
    expect(g.away.leaders[2]).toMatchObject({ label: 'Ast', name: 'Cade Cunningham', statLine: '7', teamAbbrev: g.away.abbrev })
    expect(g.home.shooting?.fieldGoals).toEqual({ made: 34, attempted: 88, pct: '38.6' })
    expect(g.away.shooting?.fieldGoals).toEqual({ made: 45, attempted: 89, pct: '50.6' })
  })

  it('shows none of it before the game starts', async () => {
    const g = await gameFor('NBA', {
      ...baseRow,
      status: 'STATUS_SCHEDULED',
      period: 0,
      leaders: [],
      homeTeamLeaders: pickTeamLeaders(CHA_LEADERS),
      homeShooting: teamShooting(CHA_STATS),
    })
    expect(g.home.leaders).toEqual([])
    expect(g.home.shooting).toBeNull()
  })

  it('a cache poll keeps the team box while the line score still sums, and drops a side whose score moved', async () => {
    const { withRememberedPresentation } = await import('@/lib/live/liveScoresPage')
    const espn = {
      ...baseRow,
      gameId: 'remember-1',
      homeScore: 100,
      awayScore: 118,
      leaders: [],
      homeLinescores: [30, 35, 25, 10],
      awayLinescores: [36, 32, 25, 25],
      homeTeamLeaders: pickTeamLeaders(CHA_LEADERS),
      awayTeamLeaders: pickTeamLeaders(DET_LEADERS),
      homeShooting: teamShooting(CHA_STATS),
      awayShooting: teamShooting(DET_STATS),
    }
    withRememberedPresentation('NBA', espn, NOW)

    // A `SportsGame` row: score and status only, no ESPN presentation.
    const cached = { ...baseRow, gameId: 'remember-1', homeScore: 100, awayScore: 118 }
    const same = withRememberedPresentation('NBA', cached, NOW + 20_000)
    expect(same.homeShooting?.fieldGoals?.made).toBe(34)
    expect(same.awayTeamLeaders?.[0]?.shortName).toBe('J. Duren')

    const moved = withRememberedPresentation('NBA', { ...cached, homeScore: 102 }, NOW + 40_000)
    expect(moved.homeShooting).toBeUndefined()
    expect(moved.homeTeamLeaders).toBeUndefined()
    // The away side did not score, so its box is still true.
    expect(moved.awayShooting?.fieldGoals?.made).toBe(45)
  })
})
