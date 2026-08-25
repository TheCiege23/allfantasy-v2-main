import { beforeEach, describe, expect, it, vi } from 'vitest'

const { matchupFindMany, teamFindMany, rosterFindMany, projFindMany } = vi.hoisted(() => ({
  matchupFindMany: vi.fn(),
  teamFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
  projFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: { findMany: matchupFindMany },
    leagueTeam: { findMany: teamFindMany },
    roster: { findMany: rosterFindMany },
    fantasyProjection: { findMany: projFindMany, findFirst: vi.fn() },
  },
}))

import { getLeagueScoreboard } from '@/lib/core-app/leagueScoreboard'

const BASE = {
  leagueId: 'af-uuid',
  platformLeagueId: '99887766',
  seasonYear: 2026,
  week: 1,
  yourRosterId: 1,
  scoringSettings: { rec: 1, pass_td: 4 } as Record<string, unknown>,
  projectionWeek: { season: '2026', week: 1 },
}

/** Four teams, two games. */
function fourTeams() {
  teamFindMany.mockResolvedValue([
    { externalId: '1', teamName: 'Yours', ownerName: 'chxnk', avatarUrl: null, platformUserId: 'u1', claimedByUserId: null },
    { externalId: '2', teamName: 'DynastyDan', ownerName: 'dan', avatarUrl: null, platformUserId: 'u2', claimedByUserId: null },
    { externalId: '3', teamName: 'Third', ownerName: 'c', avatarUrl: null, platformUserId: 'u3', claimedByUserId: null },
    { externalId: '4', teamName: 'Fourth', ownerName: 'd', avatarUrl: null, platformUserId: 'u4', claimedByUserId: null },
  ])
  rosterFindMany.mockResolvedValue(
    ['u1', 'u2', 'u3', 'u4'].map((u) => ({
      platformUserId: u,
      playerData: { starters: [`${u}-a`, `${u}-b`] },
    })),
  )
}

/** Every starter priced at 10 generic / component line that scores 12. */
function pricedAll() {
  projFindMany.mockImplementation(async ({ where }: never) => {
    const ids: string[] = (where as { playerId: { in: string[] } }).playerId.in
    return ids.map((id) => ({
      playerId: id,
      projectedPoints: 10,
      stats: { name: id, stats: { rec: 2, pass_td: 1 } },
    }))
  })
}

beforeEach(() => {
  matchupFindMany.mockReset()
  teamFindMany.mockReset()
  rosterFindMany.mockReset()
  projFindMany.mockReset()
})

describe('getLeagueScoreboard', () => {
  it('⚠ shows EVERY game in the league, not only yours', async () => {
    // The league home rendered one matchup — the viewer's — on a screen whose
    // whole subject is the league.
    matchupFindMany.mockResolvedValue([
      { rosterId: 1, matchupId: 1, pointsFor: 118.2, win: 1 },
      { rosterId: 2, matchupId: 1, pointsFor: 101.4, win: 0 },
      { rosterId: 3, matchupId: 2, pointsFor: 96.0, win: 0 },
      { rosterId: 4, matchupId: 2, pointsFor: 133.7, win: 1 },
    ])
    fourTeams()

    const sb = await getLeagueScoreboard(BASE)
    expect(sb!.games).toHaveLength(2)
    expect(sb!.allUnplayed).toBe(false)
    expect(sb!.games.flatMap((g) => g.teams.map((t) => t.teamName))).toContain('Fourth')
  })

  it('puts your own game first, and marks it', async () => {
    matchupFindMany.mockResolvedValue([
      { rosterId: 3, matchupId: 1, pointsFor: 96.0, win: 0 },
      { rosterId: 4, matchupId: 1, pointsFor: 133.7, win: 1 },
      { rosterId: 1, matchupId: 2, pointsFor: 118.2, win: 1 },
      { rosterId: 2, matchupId: 2, pointsFor: 101.4, win: 0 },
    ])
    fourTeams()

    const sb = await getLeagueScoreboard(BASE)
    expect(sb!.games[0].teams.some((t) => t.isYou)).toBe(true)
  })

  it('⚠ treats an all-zero week as UNPLAYED, not as a league of 0-0 ties', async () => {
    /*
     * THE BUG THIS GUARDS. Sync bootstraps every week at 0-0, so a single 0.0
     * row is meaningless. "Scored" has to be a property of the whole week or
     * the board reports six ties in August.
     */
    matchupFindMany.mockResolvedValue([
      { rosterId: 1, matchupId: 1, pointsFor: 0, win: 0 },
      { rosterId: 2, matchupId: 1, pointsFor: 0, win: 0 },
    ])
    fourTeams()
    pricedAll()

    const sb = await getLeagueScoreboard(BASE)
    expect(sb!.allUnplayed).toBe(true)
    expect(sb!.games[0].teams[0].points).toBeNull()
    // ...and it fills the gap with a projection instead of showing nothing.
    expect(sb!.games[0].teams[0].projected).toBeGreaterThan(0)
  })

  it('scores projections under the LEAGUE rules, not generic PPR', async () => {
    matchupFindMany.mockResolvedValue([
      { rosterId: 1, matchupId: 1, pointsFor: 0, win: 0 },
      { rosterId: 2, matchupId: 1, pointsFor: 0, win: 0 },
    ])
    fourTeams()
    pricedAll()

    // rec:1 x2 + pass_td:4 x1 = 6 per player, two starters = 12.
    // Generic would have been 10 each = 20.
    const sb = await getLeagueScoreboard(BASE)
    expect(sb!.games[0].teams[0].projected).toBe(12)
  })

  it('falls back to the generic number when the league has no scoring on file', async () => {
    matchupFindMany.mockResolvedValue([
      { rosterId: 1, matchupId: 1, pointsFor: 0, win: 0 },
      { rosterId: 2, matchupId: 1, pointsFor: 0, win: 0 },
    ])
    fourTeams()
    pricedAll()

    const sb = await getLeagueScoreboard({ ...BASE, scoringSettings: null })
    expect(sb!.games[0].teams[0].projected).toBe(20)
  })

  it('⚠ withholds the margin when the two sides were measured differently', async () => {
    /*
     * A gap between two projections built from different numbers of priced
     * starters is an artefact of coverage, not of the teams. Printing it as a
     * margin invites someone to read a data hole as a lead.
     */
    matchupFindMany.mockResolvedValue([
      { rosterId: 1, matchupId: 1, pointsFor: 0, win: 0 },
      { rosterId: 2, matchupId: 1, pointsFor: 0, win: 0 },
    ])
    teamFindMany.mockResolvedValue([
      { externalId: '1', teamName: 'Yours', ownerName: 'a', avatarUrl: null, platformUserId: 'u1', claimedByUserId: null },
      { externalId: '2', teamName: 'Them', ownerName: 'b', avatarUrl: null, platformUserId: 'u2', claimedByUserId: null },
    ])
    rosterFindMany.mockResolvedValue([
      { platformUserId: 'u1', playerData: { starters: ['x1', 'x2'] } },
      { platformUserId: 'u2', playerData: { starters: ['y1', 'y2'] } },
    ])
    // Only three of the four starters are priced.
    projFindMany.mockResolvedValue([
      { playerId: 'x1', projectedPoints: 10, stats: { stats: { rec: 2 } } },
      { playerId: 'x2', projectedPoints: 10, stats: { stats: { rec: 2 } } },
      { playerId: 'y1', projectedPoints: 10, stats: { stats: { rec: 2 } } },
    ])

    const sb = await getLeagueScoreboard(BASE)
    expect(sb!.games[0].margin).toBeNull()
  })

  it('reports a margin once a week is genuinely scored', async () => {
    matchupFindMany.mockResolvedValue([
      { rosterId: 1, matchupId: 1, pointsFor: 118.2, win: 1 },
      { rosterId: 2, matchupId: 1, pointsFor: 101.4, win: 0 },
    ])
    fourTeams()

    const sb = await getLeagueScoreboard(BASE)
    expect(sb!.games[0].margin).toBeCloseTo(16.8, 1)
  })

  it('keeps an unpaired team visible rather than dropping it', async () => {
    // A league that recorded the week without pairing teams is common before a
    // season starts. Silently dropping those rows loses half the league.
    matchupFindMany.mockResolvedValue([
      { rosterId: 1, matchupId: null, pointsFor: 0, win: 0 },
      { rosterId: 2, matchupId: null, pointsFor: 0, win: 0 },
    ])
    fourTeams()
    pricedAll()

    const sb = await getLeagueScoreboard(BASE)
    expect(sb!.games).toHaveLength(0)
    expect(sb!.unpaired).toHaveLength(2)
  })

  it('⚠ returns null on the WRONG league id rather than an empty board', async () => {
    // WeeklyMatchup.leagueId is the PLATFORM id. Passing League.id returns no
    // rows, and null is the signal the caller needs to say "no schedule on
    // file" instead of rendering an empty scoreboard.
    matchupFindMany.mockResolvedValue([])
    expect(await getLeagueScoreboard(BASE)).toBeNull()
    expect(await getLeagueScoreboard({ ...BASE, platformLeagueId: null })).toBeNull()
  })

  it('⚠ prices the CLAIMED team, whose platformUserId is null', async () => {
    /*
     * THE BUG. `LeagueTeam.platformUserId` is nullable and is most often null
     * on the claimed team — the viewer's own. The roster join used that column
     * alone, so every other team in the league priced and yours showed "—".
     * The worst possible row to lose.
     */
    matchupFindMany.mockResolvedValue([
      { rosterId: 1, matchupId: 1, pointsFor: 0, win: 0 },
      { rosterId: 2, matchupId: 1, pointsFor: 0, win: 0 },
    ])
    teamFindMany.mockResolvedValue([
      {
        externalId: '1', teamName: 'Yours', ownerName: 'you', avatarUrl: null,
        // Claimed team: no platform id, only our own user id.
        platformUserId: null, claimedByUserId: 'af-user-1',
      },
      {
        externalId: '2', teamName: 'Them', ownerName: 'them', avatarUrl: null,
        platformUserId: 'u2', claimedByUserId: null,
      },
    ])
    rosterFindMany.mockResolvedValue([
      { platformUserId: 'af-user-1', playerData: { starters: ['a', 'b'] } },
      { platformUserId: 'u2', playerData: { starters: ['c', 'd'] } },
    ])
    pricedAll()

    const sb = await getLeagueScoreboard(BASE)
    const yours = sb!.games[0].teams.find((t) => t.rosterId === 1)!
    expect(yours.projected).not.toBeNull()
    expect(yours.starterCount).toBe(2)
  })

  it('falls back to the external id when a roster is stored under it', async () => {
    matchupFindMany.mockResolvedValue([
      { rosterId: 1, matchupId: 1, pointsFor: 0, win: 0 },
      { rosterId: 2, matchupId: 1, pointsFor: 0, win: 0 },
    ])
    teamFindMany.mockResolvedValue([
      {
        externalId: '1', teamName: 'Yours', ownerName: 'you', avatarUrl: null,
        platformUserId: null, claimedByUserId: null,
      },
      {
        externalId: '2', teamName: 'Them', ownerName: 'them', avatarUrl: null,
        platformUserId: 'u2', claimedByUserId: null,
      },
    ])
    rosterFindMany.mockResolvedValue([
      { platformUserId: '1', playerData: { starters: ['a', 'b'] } },
      { platformUserId: 'u2', playerData: { starters: ['c', 'd'] } },
    ])
    pricedAll()

    const sb = await getLeagueScoreboard(BASE)
    expect(sb!.games[0].teams.find((t) => t.rosterId === 1)!.projected).not.toBeNull()
  })
})
