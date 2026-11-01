import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({
  league: vi.fn(), board: vi.fn(), scores: vi.fn(), matchup: vi.fn(), nativePlayers: vi.fn(), sportsPlayers: vi.fn(),
  roster: vi.fn(), season: vi.fn(), categoryMatchups: vi.fn(),
  standings: vi.fn(), rosters: vi.fn(), rotoPeriod: vi.fn(),
  importedCategories: vi.fn(),
  freshCategory: vi.fn(),
  freshEspn: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: h.league }, leaguePlayerWeeklyScore: { findMany: h.scores },
  weeklyMatchup: { findFirst: h.matchup }, redraftRosterPlayer: { findMany: h.nativePlayers },
  sportsPlayer: { findMany: h.sportsPlayers },
  redraftRoster: { findFirst: h.roster, findMany: h.rosters }, redraftSeason: { findFirst: h.season },
  redraftMatchup: { findMany: h.categoryMatchups },
  fantasyStanding: { findMany: h.standings },
  teamWeekResult: { findFirst: h.rotoPeriod },
  sportsDataCache: { findUnique: h.importedCategories },
} }))
vi.mock('@/lib/core-app/weekBoard', () => ({ getWeekBoard: h.board }))
vi.mock('@/lib/league-import/yahoo/YahooLeagueFetchService', () => ({ fetchYahooCategoryMatchupForWeek: h.freshCategory }))
vi.mock('@/lib/league-import/espn/EspnLeagueFetchService', () => ({ fetchEspnScheduleForSync: h.freshEspn }))
vi.mock('@/lib/core-app/weeklyCapabilities', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/core-app/weeklyCapabilities')>(),
  nativeWeeklyLeague: (league: { platform: string }) => league.platform === 'allfantasy',
}))

import { buildLiveFantasyMatchupContext } from '@/lib/chimmy/liveFantasyMatchupGrounding'

beforeEach(() => {
  vi.clearAllMocks()
  h.league.mockResolvedValue({ id: 'L1', name: 'Hoops', sport: 'NBA', platform: 'sleeper', platformLeagueId: 'P1', leagueType: 'redraft' })
  h.board.mockResolvedValue({ leagueBoard: { yourRosterId: '1', yours: { season: 2026, week: 2, opponent: { rosterId: '2', name: 'Rival' }, live: { you: 93, them: 87, margin: 6, final: false } } }, eliminationWeeks: [] })
  h.scores.mockResolvedValue([
    { playerId: 'a', rosterId: 1, points: 31.5, updatedAt: new Date('2026-11-01T20:00:00Z') },
    { playerId: 'b', rosterId: 2, points: 28, updatedAt: new Date('2026-11-01T20:00:00Z') },
  ])
  h.matchup.mockResolvedValue({ updatedAt: new Date('2026-11-01T20:02:00Z') })
  h.sportsPlayers.mockResolvedValue([{ sleeperId: 'a', name: 'Home Star' }, { sleeperId: 'b', name: 'Away Star' }])
  h.nativePlayers.mockResolvedValue([])
  h.roster.mockResolvedValue({ id: 'R1' })
  h.season.mockResolvedValue({ currentWeek: 2 })
  h.categoryMatchups.mockResolvedValue([])
  h.standings.mockResolvedValue([])
  h.rosters.mockResolvedValue([])
  h.rotoPeriod.mockResolvedValue(null)
  h.importedCategories.mockResolvedValue(null)
  h.freshCategory.mockResolvedValue(null)
  h.freshEspn.mockResolvedValue([])
})

describe('selected league live fantasy matchup', () => {
  it('uses the league board for actual scores and league-scored starter rows for contributions', async () => {
    const out = await buildLiveFantasyMatchupContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('your team 93.00, Rival 87.00')
    expect(out).toContain('Home Star 31.50')
    expect(out).toContain('Away Star 28.00')
    expect(out).toContain('2026-11-01T20:02:00.000Z')
    expect(h.board).toHaveBeenCalledWith('u1', expect.any(Array), 'L1')
    expect(h.scores.mock.calls[0][0].where).toMatchObject({ leagueId: 'P1', seasonYear: 2026, week: 2, source: 'sleeper', isStarter: true })
  })

  it('does not turn an empty score into a reported zero', async () => {
    h.board.mockResolvedValue({ leagueBoard: { yourRosterId: '1', yours: { season: 2026, week: 2, opponent: { rosterId: '2', name: 'Rival' }, live: null } }, eliminationWeeks: [] })
    h.scores.mockResolvedValue([])
    h.matchup.mockResolvedValue(null)
    const out = await buildLiveFantasyMatchupContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('No fantasy points are on the board')
    expect(out).toContain('No score refresh time is on file')
    expect(out).not.toContain('your team 0.00')
  })

  it('withholds zero-valued player rows until the board reports a score', async () => {
    h.board.mockResolvedValue({ leagueBoard: { yourRosterId: '1', yours: { season: 2026, week: 2, opponent: { rosterId: '2', name: 'Rival' }, live: null } }, eliminationWeeks: [] })
    h.scores.mockResolvedValue([{ playerId: 'a', rosterId: 1, points: 0, updatedAt: new Date('2026-11-01T20:00:00Z') }])
    const out = await buildLiveFantasyMatchupContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('withheld until the matchup board reports points')
    expect(out).not.toContain('Home Star 0.00')
  })

  it('refuses a missing league before reading anyone’s board', async () => {
    h.league.mockResolvedValue(null)
    expect(await buildLiveFantasyMatchupContext({ leagueId: 'missing', userId: 'u1' })).toMatch(/could not be read/)
    expect(h.board).not.toHaveBeenCalled()
  })

  it('does not present a scalar score for a category league', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Hoops Categories', sport: 'NBA', platform: 'sleeper', platformLeagueId: 'P1', leagueType: 'categories', settings: {} })
    const out = await buildLiveFantasyMatchupContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toMatch(/category scoring/)
    expect(h.board).not.toHaveBeenCalled()
  })

  it('reports a verified Yahoo category pairing with a source timestamp', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Yahoo Hoops', sport: 'NBA', season: 2026,
      platform: 'yahoo', platformLeagueId: '466.l.12', leagueType: 'categories', settings: {
        yahoo_settings: { stat_categories: { stats: { 0: { stat: [{ stat_id: '5' }, { display_name: 'PTS' }] } } } },
      } })
    h.board.mockResolvedValue({ leagueBoard: { yourRosterId: '1', yours: { week: 2 } }, eliminationWeeks: [] })
    h.importedCategories.mockResolvedValue({ data: { provider: 'yahoo', leagueId: '466.l.12', season: 2026,
      week: 2, fetchedAt: '2026-11-01T20:00:00Z', pairs: [
        { roster1: '1', roster2: '2', categories1: { '5': 101, '6': 42 }, categories2: { '5': 95, '6': 40 } },
      ] } })
    const out = await buildLiveFantasyMatchupContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('PTS: you 101.00, opponent 95.00')
    expect(out).toContain('Provider totals last fetched 2026-11-01T20:00:00.000Z')
    expect(out).toContain('not a real-time update')
    expect(out).not.toContain('your team 101.00')
  })

  it('prefers an authorized current-week Yahoo scoreboard over an older snapshot', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Yahoo Hoops', sport: 'NBA', season: 2026,
      platform: 'yahoo', platformLeagueId: '466.l.12', leagueType: 'categories', settings: {} })
    h.board.mockResolvedValue({ leagueBoard: { yourRosterId: '2', yours: { week: 2 } }, eliminationWeeks: [] })
    h.freshCategory.mockResolvedValue({ week: 2, season: 2026, matchups: [{
      teamKey1: '466.l.12.t.1', teamKey2: '466.l.12.t.2', categories1: { '5': 101, '6': 42 },
      categories2: { '5': 95, '6': 40 },
    }] })
    const out = await buildLiveFantasyMatchupContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('Yahoo stat 5: you 95.00, opponent 101.00')
    expect(out).toContain('Yahoo current-week scoreboard team_stats')
    expect(h.importedCategories).not.toHaveBeenCalled()
  })

  it('reads verified ESPN category scores from the current matchup', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'ESPN Baseball', sport: 'MLB', season: 2026,
      platform: 'espn', platformLeagueId: '123', leagueType: 'categories', settings: {} })
    h.board.mockResolvedValue({ leagueBoard: { yourRosterId: '2', yours: { week: 2 } }, eliminationWeeks: [] })
    h.freshEspn.mockResolvedValue([{ week: 2, season: 2026, matchups: [{ teamId1: '1', teamId2: '2',
      categories1: { '5': 16, '8': 172 }, categories2: { '5': 12, '8': 165 } }] }])
    const out = await buildLiveFantasyMatchupContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('ESPN stat 5: you 12.00, opponent 16.00')
    expect(out).toContain('ESPN current-week matchup cumulativeScore.scoreByStat')
    expect(out).not.toContain('fantasy points:')
  })

  it('reports a native category snapshot without calling it real-time', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Hoops Categories', sport: 'NBA', season: 2026, platform: 'allfantasy',
      leagueType: 'redraft', settings: { scoring_mode: 'h2h_category' } })
    h.categoryMatchups.mockResolvedValue([{ week: 2, homeRosterId: 'R1', awayRosterId: 'R2', status: 'active',
      lineupSnapshots: { categoryMatchup: { categories: [{ label: 'PTS', aValue: 101, bValue: 95 }] } } }])
    const out = await buildLiveFantasyMatchupContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('PTS: you 101.00, opponent 95.00')
    expect(out).toContain('refresh time is not recorded')
    expect(out).not.toContain('your team 101')
    expect(h.categoryMatchups.mock.calls[0][0].where).toMatchObject({ leagueId: 'L1', week: 2 })
  })

  it('labels an old native category scoring snapshot stale', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Hoops Categories', sport: 'NBA', season: 2026,
      platform: 'allfantasy', leagueType: 'redraft', settings: { scoring_mode: 'h2h_category' } })
    h.categoryMatchups.mockResolvedValue([{ week: 2, homeRosterId: 'R1', awayRosterId: 'R2', status: 'active',
      lineupSnapshots: { redraftScoring: { scoredAt: '2020-01-01T00:00:00Z' },
        categoryMatchup: { categories: [{ label: 'PTS', aValue: 101, bValue: 95 }] } } }])
    const out = await buildLiveFantasyMatchupContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('computed 2020-01-01T00:00:00.000Z')
    expect(out).toContain('Treat it as stale')
  })

  it('reports native roto rank points from stored standings, with freshness', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Roto Hoops', sport: 'NBA', season: 2026,
      platform: 'allfantasy', leagueType: 'redraft', settings: { scoring_mode: 'roto' } })
    h.standings.mockResolvedValue([
      { rosterId: 'G1', roster: { redraftRosterId: 'R1' }, rank: 1, pointsFor: 21,
        updatedAt: new Date('2026-11-01T20:00:00Z') },
      { rosterId: 'G2', roster: { redraftRosterId: 'R2' }, rank: 2, pointsFor: 18,
        updatedAt: new Date('2026-11-01T20:00:00Z') },
    ])
    h.rotoPeriod.mockResolvedValue({ week: 3, categoryBreakdown: { teamStats: { pts: 180 } } })
    h.rosters.mockResolvedValue([{ id: 'R1', teamName: 'Home', ownerName: 'U1' },
      { id: 'R2', teamName: 'Rival', ownerName: 'U2' }])
    const out = await buildLiveFantasyMatchupContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('Your stored rank: 1')
    expect(out).toContain('21.00 category rank points')
    expect(out).toContain('Rival')
    expect(out).toContain('2026-11-01T20:00:00.000Z')
    expect(out).not.toContain('head-to-head fantasy score')
    expect(h.board).not.toHaveBeenCalled()
  })

  it('does not present a roto placement before a category period has finalized', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Roto Hoops', sport: 'NBA', season: 2026,
      platform: 'allfantasy', leagueType: 'redraft', settings: { scoring_mode: 'roto' } })
    const out = await buildLiveFantasyMatchupContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toMatch(/No finalized rotisserie category period/)
    expect(h.standings).not.toHaveBeenCalled()
  })
})
