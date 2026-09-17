import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  leagueTeam: { findMany: vi.fn() },
  matchupFact: { findMany: vi.fn() },
  weeklyMatchup: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { loadCareerGames, getCareerRecords } = await import('@/lib/core-app/careerRecords')

const league = (id: string) => ({ id, name: 'Dynasty Dragons', platform: 'sleeper', sport: 'NFL', platformLeagueId: 'S1' })
const fact = (leagueId: string, week: number, scoreA: number, scoreB: number, winner: string | null) => ({
  leagueId,
  season: 2024,
  weekOrPeriod: week,
  teamA: '1',
  teamB: '2',
  scoreA,
  scoreB,
  winnerTeamId: winner,
})

describe('loadCareerGames', () => {
  beforeEach(() => {
    db.leagueTeam.findMany.mockReset()
    db.matchupFact.findMany.mockReset()
    db.weeklyMatchup.findMany.mockReset().mockResolvedValue([])
  })

  function stub(facts: ReturnType<typeof fact>[]) {
    db.leagueTeam.findMany
      // your claimed teams — the same Sleeper league reached through two League rows
      .mockResolvedValueOnce([
        { externalId: '1', league: league('A') },
        { externalId: '1', league: league('B') },
      ])
      // every team in those leagues
      .mockResolvedValueOnce([
        { leagueId: 'A', externalId: '1', ownerName: 'me', teamName: null, platformUserId: 'U1', claimedByUserId: 'me' },
        { leagueId: 'A', externalId: '2', ownerName: 'Rival Ron', teamName: null, platformUserId: 'U2', claimedByUserId: null },
        { leagueId: 'B', externalId: '1', ownerName: 'me', teamName: null, platformUserId: 'U1', claimedByUserId: 'me' },
        { leagueId: 'B', externalId: '2', ownerName: 'Rival Ron', teamName: null, platformUserId: 'U2', claimedByUserId: null },
      ])
    db.matchupFact.findMany.mockResolvedValue(facts)
  }

  it('counts a game once when two league rows carry the same provider league', async () => {
    stub([fact('A', 1, 120, 100, '1'), fact('B', 1, 120, 100, '1'), fact('A', 2, 90, 110, '2'), fact('B', 2, 90, 110, '2')])
    const { games, scoring } = await loadCareerGames('me')
    expect(games).toHaveLength(2)
    expect(games.map((g) => g.result)).toEqual(['W', 'L'])
    expect(games[0]).toMatchObject({ oppKey: 'u:U2', oppName: 'Rival Ron' })
    expect(scoring.yourGames).toBe(2)
  })

  it('drops an unplayed fixture and a zero for your team, and keeps them out of the league average', async () => {
    stub([
      fact('A', 1, 0, 0, null),
      fact('A', 2, 0, 130, '2'),
      fact('A', 3, 100, 80, '1'),
    ])
    const { games, scoring } = await loadCareerGames('me')
    expect(games.map((g) => g.week)).toEqual([3])
    // week 2's zero is not a team-game; week 1 is not a fixture at all
    expect(scoring.leagueTeamGames).toBe(3)
    expect(scoring.leaguePoints).toBe(310)
  })

  it('never reports a lowest week of zero', async () => {
    stub([fact('A', 1, 0, 130, '2'), fact('A', 2, 95, 80, '1')])
    const book = await getCareerRecords('me')
    expect(book.records.find((r) => r.key === 'low-week')?.value).toBe('95.0')
    expect(book.rivals[0]).toMatchObject({ name: 'Rival Ron', meetings: 1, wins: 1 })
  })

  it('narrows by league name before reading any fact', async () => {
    db.leagueTeam.findMany.mockResolvedValueOnce([{ externalId: '1', league: league('A') }])
    const res = await loadCareerGames('me', { platform: null, sport: null, league: 'someone else', fromSeason: null, toSeason: null })
    expect(res.games).toEqual([])
    expect(db.matchupFact.findMany).not.toHaveBeenCalled()
  })
})
