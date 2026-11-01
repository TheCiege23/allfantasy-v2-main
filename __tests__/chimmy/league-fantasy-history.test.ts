import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ league: vi.fn(), career: vi.fn(), roster: vi.fn(), matchups: vi.fn(),
  nativePlayers: vi.fn(), sportsPlayers: vi.fn(), identities: vi.fn(), scores: vi.fn(),
  teams: vi.fn(), categoryCache: vi.fn(), board: vi.fn(), seasonFacts: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.league },
  redraftRoster: { findMany: h.roster }, redraftMatchup: { findMany: h.matchups },
  redraftRosterPlayer: { findMany: h.nativePlayers }, sportsPlayer: { findMany: h.sportsPlayers },
  playerIdentityMap: { findMany: h.identities }, leaguePlayerWeeklyScore: { findMany: h.scores },
  leagueTeam: { findMany: h.teams }, sportsDataCache: { findMany: h.categoryCache },
  seasonStandingFact: { findMany: h.seasonFacts } } }))
vi.mock('@/lib/core-app/careerRecords', () => ({ loadCareerGames: h.career }))
vi.mock('@/lib/core-app/weekBoard', () => ({ getWeekBoard: h.board }))

import { buildLeagueFantasyHistoryContext } from '@/lib/chimmy/leagueFantasyHistoryGrounding'

beforeEach(() => {
  vi.clearAllMocks()
  h.league.mockResolvedValue({ id: 'L1', name: 'Fantasy Hoops', sport: 'NBA', leagueType: 'redraft', settings: {} })
  h.career.mockResolvedValue({ games: [
    { leagueId: 'L1', leagueName: 'Fantasy Hoops', season: 2024, week: 8, myScore: 101, oppScore: 97, result: 'W', oppName: 'Rival' },
    { leagueId: 'L1', leagueName: 'Fantasy Hoops', season: 2023, week: 8, myScore: 90, oppScore: 93, result: 'L', oppName: 'Other' },
    { leagueId: 'L2', leagueName: 'Fantasy Hoops', season: 2024, week: 8, myScore: 150, oppScore: 10, result: 'W', oppName: 'Stranger' },
  ] })
  h.roster.mockResolvedValue([{ id: 'R1' }, { id: 'R-old' }])
  h.matchups.mockResolvedValue([])
  h.nativePlayers.mockResolvedValue([])
  h.sportsPlayers.mockResolvedValue([])
  h.identities.mockResolvedValue([])
  h.scores.mockResolvedValue([])
  h.teams.mockResolvedValue([])
  h.categoryCache.mockResolvedValue([])
  h.board.mockResolvedValue({ leagueBoard: null })
  h.seasonFacts.mockResolvedValue([])
})

describe('selected-league fantasy history', () => {
  it('shows only played games of the selected league and season', async () => {
    const out = await buildLeagueFantasyHistoryContext({ leagueId: 'L1', userId: 'u1', season: 2024 })
    expect(out).toContain('2024 week 8: W 101.00–97.00 versus Rival')
    expect(out).not.toContain('Stranger')
    expect(out).not.toContain('2023 week 8')
    expect(h.career).toHaveBeenCalledWith('u1', expect.objectContaining({ league: 'fantasy hoops', fromSeason: 2024, toSeason: 2024 }))
  })

  it('labels missing history as a data gap rather than a 0–0 game', async () => {
    h.career.mockResolvedValue({ games: [] })
    const out = await buildLeagueFantasyHistoryContext({ leagueId: 'L1', userId: 'u1', season: 2020 })
    expect(out).toMatch(/data gap/)
    expect(out).not.toContain('0–0')
  })

  it('reports finalized native category history without treating it as points', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Cats', sport: 'NBA', leagueType: 'redraft', platform: 'allfantasy',
      settings: { scoring_mode: 'h2h_category' } })
    h.matchups.mockResolvedValue([{ week: 8, season: { season: 2024 }, homeRosterId: 'R1',
      lineupSnapshots: { categoryMatchup: { aWins: 6, bWins: 3, ties: 0,
        categories: [{ label: 'PTS', aValue: 101, bValue: 97 }] } } }])
    const out = await buildLeagueFantasyHistoryContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('2024 week 8, categories won 6-3-0 tied: PTS 101.00 vs 97.00')
    expect(out).toContain('not fantasy points')
    expect(h.career).not.toHaveBeenCalled()
    expect(h.matchups.mock.calls[0][0].where.OR).toEqual([
      { homeRosterId: { in: ['R1', 'R-old'] } }, { awayRosterId: { in: ['R1', 'R-old'] } },
    ])
  })

  it('does not invent a rotisserie rank from a category snapshot', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Roto', sport: 'NBA', leagueType: 'redraft', platform: 'allfantasy',
      settings: { scoring_mode: 'roto' } })
    h.matchups.mockResolvedValue([{ week: 8, season: { season: 2024 }, homeRosterId: 'R1',
      lineupSnapshots: { categoryMatchup: { categories: [{ label: 'REB', aValue: 70, bValue: 60 }] } } }])
    const out = await buildLeagueFantasyHistoryContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('2024 week 8: REB 70.00 vs 60.00')
    expect(out).toContain('Rotisserie ranks')
    expect(out).not.toContain('categories won')
  })

  it('shows only matched league-scored player weeks and labels correction status', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Fantasy Hoops', sport: 'NBA', leagueType: 'redraft',
      platform: 'allfantasy', settings: {} })
    h.nativePlayers.mockResolvedValue([{ playerId: 'P7' }])
    h.scores.mockResolvedValue([{ seasonYear: 2026, week: 4, points: 23.5, isStarter: true,
      isFinalized: false, updatedAt: new Date('2026-11-01T20:00:00Z') }])
    const out = await buildLeagueFantasyHistoryContext({ leagueId: 'L1', userId: 'u1',
      player: 'Exact Player', season: 2026 })
    expect(out).toContain('23.50 league-scored fantasy points (starter, subject to correction')
    expect(h.scores.mock.calls[0][0].where).toMatchObject({ leagueId: 'L1', source: 'allfantasy',
      playerId: 'P7', seasonYear: 2026 })
    expect(h.career).not.toHaveBeenCalled()
  })

  it('refuses ambiguous player identities before reading fantasy points', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Fantasy Hoops', sport: 'NBA', leagueType: 'redraft',
      platform: 'allfantasy', settings: {} })
    h.nativePlayers.mockResolvedValue([{ playerId: 'P7' }, { playerId: 'P8' }])
    const out = await buildLeagueFantasyHistoryContext({ leagueId: 'L1', userId: 'u1', player: 'Same Name' })
    expect(out).toMatch(/multiple player IDs/)
    expect(h.scores).not.toHaveBeenCalled()
  })

  it('reads imported ESPN category snapshots for the claimed team without inventing wins', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'ESPN Cats', sport: 'NBA', season: 2026,
      platform: 'espn', platformLeagueId: 'P1', leagueType: 'categories', settings: {} })
    h.teams.mockResolvedValue([{ externalId: '2' }])
    h.categoryCache.mockResolvedValue([{ data: { provider: 'espn', leagueId: 'P1', season: 2026,
      week: 4, fetchedAt: '2026-11-01T20:00:00Z', pairs: [{ roster1: '1', roster2: '2',
        categories1: { '5': 101, '6': 42 }, categories2: { '5': 95, '6': 40 } }] } }])
    const out = await buildLeagueFantasyHistoryContext({ leagueId: 'L1', userId: 'u1', week: 4 })
    expect(out).toContain('2026 week 4: stat 5 95.00 vs 101.00')
    expect(out).toContain('final status, category winners and fantasy points are not inferred')
    expect(h.categoryCache.mock.calls[0][0].where.cacheKey.startsWith).toContain('imported_category_matchup:espn:P1:2026:4')
  })

  it('reads ESPN player history through the ESPN identity column', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'ESPN Hoops', sport: 'NBA', season: 2026,
      platform: 'espn', platformLeagueId: 'P1', leagueType: 'redraft', settings: {} })
    h.identities.mockResolvedValue([{ espnId: 'E7', fleaflickerId: null, mflId: null }])
    h.scores.mockResolvedValue([{ seasonYear: 2026, week: 2, points: 30,
      isStarter: true, isFinalized: true, updatedAt: new Date('2026-11-01T20:00:00Z') }])
    const out = await buildLeagueFantasyHistoryContext({ leagueId: 'L1', userId: 'u1', player: 'Exact Player' })
    expect(out).toContain('30.00 league-scored fantasy points')
    expect(h.scores.mock.calls[0][0].where).toMatchObject({ leagueId: 'P1', source: 'espn', playerId: 'E7' })
  })

  it('shows imported roto season ranks without claiming old manager identity', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Yahoo Roto', sport: 'NBA', season: 2026,
      platform: 'yahoo', platformLeagueId: 'P1', leagueType: 'redraft', settings: { scoring_mode: 'roto' } })
    h.teams.mockResolvedValue([{ externalId: '2', teamName: 'Current Name', ownerName: 'Current Owner' }])
    h.seasonFacts.mockResolvedValue([{ season: 2025, teamId: '2', rank: 2,
      wins: 0, losses: 0, ties: 0, pointsFor: 42 }])
    const out = await buildLeagueFantasyHistoryContext({ leagueId: 'L1', userId: 'u1', season: 2025 })
    expect(out).toContain('2025: 2. Current Name')
    expect(out).toContain('no past manager identity is inferred')
  })
})
