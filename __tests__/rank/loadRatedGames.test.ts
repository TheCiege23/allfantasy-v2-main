import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  facts: [] as unknown[],
  weeks: [] as unknown[],
  native: [] as unknown[],
  leagues: [] as Array<{ id: string; platform: string; sport: string; platformLeagueId: string; name: string | null }>,
  teams: [] as unknown[],
  identities: [] as unknown[],
  appUsers: [] as Array<{ id: string }>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    matchupFact: { findMany: vi.fn(async () => db.facts) },
    weeklyMatchup: { findMany: vi.fn(async () => db.weeks) },
    redraftMatchup: { findMany: vi.fn(async () => db.native) },
    league: {
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] }; platformLeagueId?: { in: string[] } } }) =>
        db.leagues.filter((l) =>
          where.id ? where.id.in.includes(l.id) : where.platformLeagueId ? where.platformLeagueId.in.includes(l.platformLeagueId) : false,
        ),
      ),
    },
    leagueTeam: {
      findMany: vi.fn(async ({ where }: { where: { leagueId: { in: string[] } } }) =>
        (db.teams as Array<{ leagueId: string }>).filter((t) => where.leagueId.in.includes(t.leagueId)),
      ),
    },
    platformIdentity: { findMany: vi.fn(async () => db.identities) },
    appUser: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => db.appUsers.filter((u) => where.id.in.includes(u.id))),
    },
  },
}))

import { loadRatedGames, slotKey } from '@/lib/rank/skillRating/loadRatedGames'

function team(leagueId: string, externalId: string, extra: Partial<{ platformUserId: string; claimedByUserId: string; ownerName: string }> = {}) {
  return { leagueId, externalId, platformUserId: null, claimedByUserId: null, ownerName: null, teamName: null, ...extra }
}

describe('loadRatedGames', () => {
  beforeEach(() => {
    db.facts = []
    db.weeks = []
    db.native = []
    db.leagues = []
    db.teams = []
    db.identities = []
    db.appUsers = []
  })

  it('resolves sides to an AF user, a linked platform account, or a platform manager', async () => {
    db.leagues = [{ id: 'L1', platform: 'sleeper', sport: 'NFL', platformLeagueId: 'S1', name: 'Dynasty' }]
    db.teams = [
      team('L1', '1', { claimedByUserId: 'me', platformUserId: 'sx-me' }),
      team('L1', '2', { platformUserId: 'sx-linked' }),
      team('L1', '3', { platformUserId: 'sx-stranger', ownerName: 'Stranger' }),
      team('L1', '4'),
    ]
    db.identities = [{ platform: 'sleeper', platformUserId: 'sx-linked', userId: 'friend' }]
    db.facts = [
      { matchupId: 'a', leagueId: 'L1', sport: 'NFL', season: 2024, weekOrPeriod: 1, teamA: '1', teamB: '2', scoreA: 110, scoreB: 100 },
      { matchupId: 'b', leagueId: 'L1', sport: 'NFL', season: 2024, weekOrPeriod: 2, teamA: '3', teamB: '4', scoreA: 90, scoreB: 95 },
    ]
    const { games } = await loadRatedGames()
    expect(games.map((g) => [g.a, g.b])).toEqual([
      ['af:me', 'af:friend'],
      ['p:sleeper:sx-stranger', 'r:S1:4'],
    ])
    expect(games[1].aName).toBe('Stranger')
  })

  it('counts a provider game once across League mirrors, and skips unplayed or zero-score fixtures', async () => {
    db.leagues = [
      { id: 'L1', platform: 'sleeper', sport: 'NFL', platformLeagueId: 'S1', name: 'A' },
      { id: 'L2', platform: 'sleeper', sport: 'NFL', platformLeagueId: 'S1', name: 'A (mirror)' },
    ]
    db.teams = [team('L1', '1', { claimedByUserId: 'me' }), team('L2', '1', { claimedByUserId: 'me' })]
    db.facts = [
      { matchupId: 'a', leagueId: 'L1', sport: 'NFL', season: 2024, weekOrPeriod: 1, teamA: '1', teamB: '2', scoreA: 110, scoreB: 100 },
      { matchupId: 'b', leagueId: 'L2', sport: 'NFL', season: 2024, weekOrPeriod: 1, teamA: '2', teamB: '1', scoreA: 100, scoreB: 110 },
      { matchupId: 'c', leagueId: 'L1', sport: 'NFL', season: 2024, weekOrPeriod: 2, teamA: '1', teamB: '2', scoreA: 0, scoreB: 0 },
      { matchupId: 'd', leagueId: 'L1', sport: 'NFL', season: 2024, weekOrPeriod: 3, teamA: '1', teamB: '2', scoreA: 0, scoreB: 88 },
    ]
    const { games, sources } = await loadRatedGames()
    expect(games).toHaveLength(1)
    expect(sources.facts).toBe(1)
  })

  it('rates a departed Sleeper manager as that person, never as whoever holds their old slot now', async () => {
    db.leagues = [{ id: 'L1', platform: 'sleeper', sport: 'NFL', platformLeagueId: 'S1', name: 'Dynasty' }]
    // Slot 5 belongs to a newcomer today; the departed manager played 2022 from it.
    db.teams = [team('L1', '5', { platformUserId: 'sx-newcomer' }), team('L1', '3', { claimedByUserId: 'me' })]
    db.identities = [{ platform: 'sleeper', platformUserId: 'sx-gone-linked', userId: 'old-friend' }]
    db.facts = [
      { matchupId: 'a', leagueId: 'L1', sport: 'NFL', season: 2022, weekOrPeriod: 1, teamA: '3', teamB: 'former:sleeper:sx-gone', scoreA: 110, scoreB: 100 },
      { matchupId: 'b', leagueId: 'L1', sport: 'NFL', season: 2022, weekOrPeriod: 2, teamA: '3', teamB: 'former:sleeper:sx-gone-linked', scoreA: 90, scoreB: 95 },
      { matchupId: 'c', leagueId: 'L1', sport: 'NFL', season: 2022, weekOrPeriod: 3, teamA: '3', teamB: 'former:sleeper:slot:2022:5', scoreA: 90, scoreB: 80 },
    ]
    const { games } = await loadRatedGames()
    expect(games.map((g) => g.b)).toEqual(['p:sleeper:sx-gone', 'af:old-friend', 'r:S1:2022:5'])
    expect(games.some((g) => g.a === 'p:sleeper:sx-newcomer' || g.b === 'p:sleeper:sx-newcomer')).toBe(false)
  })

  it('takes a provider season from the most recently written copy only', async () => {
    db.leagues = [
      { id: 'L1', platform: 'sleeper', sport: 'NFL', platformLeagueId: 'S1', name: 'A' },
      { id: 'L2', platform: 'sleeper', sport: 'NFL', platformLeagueId: 'S1', name: 'A (mirror)' },
    ]
    db.teams = [team('L1', '5', { platformUserId: 'sx-newcomer' }), team('L2', '5', { platformUserId: 'sx-newcomer' })]
    const old = new Date('2026-01-01T00:00:00Z')
    const rewritten = new Date('2026-10-01T00:00:00Z')
    db.facts = [
      // L1's copy predates the mapping fix and credits the game to slot 5's current owner.
      { matchupId: 'a', leagueId: 'L1', sport: 'NFL', season: 2022, weekOrPeriod: 1, teamA: '3', teamB: '5', scoreA: 110, scoreB: 100, createdAt: old },
      { matchupId: 'b', leagueId: 'L2', sport: 'NFL', season: 2022, weekOrPeriod: 1, teamA: '3', teamB: 'former:sleeper:sx-gone', scoreA: 110, scoreB: 100, createdAt: rewritten },
    ]
    const { games } = await loadRatedGames()
    expect(games).toHaveLength(1)
    expect(games[0].b).toBe('p:sleeper:sx-gone')
  })

  it('uses live weeks only for seasons no fact covers, pairs by matchup, and reads ties from points', async () => {
    db.leagues = [{ id: 'L1', platform: 'mfl', sport: 'NFL', platformLeagueId: 'M1', name: 'MFL' }]
    db.teams = [team('L1', '0001', { claimedByUserId: 'me' }), team('L1', '0002', { platformUserId: 'mfl-b' })]
    db.facts = [{ matchupId: 'a', leagueId: 'L1', sport: 'NFL', season: 2024, weekOrPeriod: 1, teamA: '0001', teamB: '0002', scoreA: 1, scoreB: 2 }]
    db.weeks = [
      // 2024 is covered by facts — ignored.
      { id: 'w1', leagueId: 'M1', rosterId: '1', seasonYear: 2024, week: 2, matchupId: 1, pointsFor: 100 },
      { id: 'w2', leagueId: 'M1', rosterId: '2', seasonYear: 2024, week: 2, matchupId: 1, pointsFor: 90 },
      // 2025 live: padding lost in this table, still resolves; a tie both writers would store as two losses.
      { id: 'w3', leagueId: 'M1', rosterId: '1', seasonYear: 2025, week: 1, matchupId: 7, pointsFor: 100 },
      { id: 'w4', leagueId: 'M1', rosterId: '2', seasonYear: 2025, week: 1, matchupId: 7, pointsFor: 100 },
      // A lone side (total-points league) is not a game.
      { id: 'w5', leagueId: 'M1', rosterId: '1', seasonYear: 2025, week: 2, matchupId: 9, pointsFor: 120 },
    ]
    const { games, sources } = await loadRatedGames()
    expect(sources).toEqual({ facts: 1, weeks: 1, native: 0 })
    const live = games.find((g) => g.season === 2025)!
    expect([live.a, live.b]).toEqual(['af:me', 'p:mfl:mfl-b'])
    expect(live.scoreA).toBe(live.scoreB)
    expect(slotKey('0001')).toBe('1')
    expect(slotKey('449.l.1.t.3')).toBe('449.l.1.t.3')
  })

  it('rates native AllFantasy games by owner, AF users by id', async () => {
    db.leagues = [{ id: 'N1', platform: 'manual', sport: 'NFL', platformLeagueId: 'N1', name: 'Native' }]
    db.appUsers = [{ id: 'me' }]
    db.native = [
      {
        id: 'm1',
        leagueId: 'N1',
        week: 3,
        homeScore: 120,
        awayScore: 99,
        homeRoster: { ownerId: 'me', ownerName: 'Me', teamName: null },
        awayRoster: { ownerId: 'roster:abc', ownerName: 'Open', teamName: null },
        season: { season: 2026, sport: 'NFL' },
      },
    ]
    const { games } = await loadRatedGames()
    expect(games).toHaveLength(1)
    expect([games[0].a, games[0].b]).toEqual(['af:me', 'n:N1:roster:abc'])
    expect(games[0].season).toBe(2026)
  })
})
