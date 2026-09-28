import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `loadCareerLedger`'s fourth source: teams a manager has CLAIMED.
 *
 * A member who joins a league someone else imported owns no `League` row — only
 * `LeagueTeam.claimedByUserId` — and Sleeper unified / MFL / Fleaflicker imports
 * never write `League.import_*`. Before this source both got zero ledger rows.
 *
 * ⚠ THE DOUBLE HONOURS THE `where` CLAUSES THE LOADER SENDS (ids, lifecycle,
 * platform), so an exclusion that only exists in the query is still exercised.
 */

type TeamRow = {
  id: string
  claimedByUserId: string | null
  lifecycleState?: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  currentRank: number | null
  lastUpdatedAt: Date
  league: {
    id: string
    name: string
    platform: string
    platformLeagueId: string
    sport: string
    season: number
    leagueSize: number | null
    playoffTeams: number | null
    isDynasty: boolean
    leagueType: string | null
    leagueVariant: string | null
    scoring: string | null
    status: string | null
    updatedAt: Date
    lastSyncedAt: Date | null
  }
}

const state = {
  imported: [] as Array<Record<string, unknown>>,
  links: [] as Array<{ id: string; legacyUserId: string | null }>,
  legacy: [] as Array<Record<string, unknown>>,
  teams: [] as TeamRow[],
  seasons: [] as Array<{ leagueId: string; season: number; championTeamId: string | null }>,
  failTeams: false,
  failSeasons: false,
}

const h = vi.hoisted(() => ({ teamWhere: [] as unknown[] }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findMany: vi.fn(async (args: { where: { userId: { in: string[] } } }) =>
        state.imported.filter((l) => args.where.userId.in.includes(l.userId as string)),
      ),
    },
    appUser: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] } } }) =>
        state.links.filter((l) => args.where.id.in.includes(l.id)),
      ),
    },
    legacyLeague: {
      findMany: vi.fn(async (args: { where: { userId: { in: string[] } } }) =>
        state.legacy.filter((l) => args.where.userId.in.includes(l.userId as string)),
      ),
    },
    franchiseSeason: { findMany: vi.fn(async () => []) },
    leagueTeam: {
      findMany: vi.fn(async (args: { where: Record<string, any> }) => {
        h.teamWhere.push(args.where)
        if (state.failTeams) throw new Error('league_teams unreadable')
        const w = args.where
        return state.teams.filter(
          (t) =>
            t.claimedByUserId != null &&
            w.claimedByUserId.in.includes(t.claimedByUserId) &&
            (w.lifecycleState?.not == null || t.lifecycleState !== w.lifecycleState.not) &&
            !(w.league?.platform?.notIn ?? []).includes(t.league.platform),
        )
      }),
    },
    leagueSeason: {
      findMany: vi.fn(async (args: { where: { leagueId: { in: string[] } } }) => {
        if (state.failSeasons) throw new Error('league_seasons unreadable')
        return state.seasons.filter((s) => args.where.leagueId.in.includes(s.leagueId) && s.championTeamId != null)
      }),
    },
  },
}))

import { loadCareerLedger, NATIVE_PLATFORMS } from '@/lib/rank/careerLedger'

const T0 = new Date('2026-09-20T00:00:00Z')

function team(over: Partial<TeamRow> & { league?: Partial<TeamRow['league']> } = {}): TeamRow {
  const { league, ...rest } = over
  return {
    id: 'team-1',
    claimedByUserId: 'joiner',
    lifecycleState: 'UNKNOWN',
    wins: 3,
    losses: 1,
    ties: 0,
    pointsFor: 480.5,
    currentRank: 2,
    lastUpdatedAt: T0,
    ...rest,
    league: {
      id: 'league-1',
      name: 'Bla bla bla',
      platform: 'sleeper',
      platformLeagueId: 'SL1',
      sport: 'nfl',
      season: 2026,
      leagueSize: 12,
      playoffTeams: 6,
      isDynasty: false,
      leagueType: 'redraft',
      leagueVariant: null,
      scoring: 'PPR',
      status: 'in_season',
      updatedAt: T0,
      lastSyncedAt: null,
      ...league,
    },
  }
}

function importedLeague(over: Record<string, unknown> = {}) {
  return {
    id: 'league-1',
    userId: 'owner',
    name: 'Bla bla bla',
    platform: 'sleeper',
    platformLeagueId: 'SL1',
    sport: 'nfl',
    season: 2026,
    leagueSize: 12,
    playoffTeams: 6,
    isDynasty: false,
    leagueType: 'redraft',
    leagueVariant: null,
    scoring: 'PPR',
    status: 'in_season',
    importWins: 1,
    importLosses: 0,
    importTies: 0,
    importMadePlayoffs: false,
    importWonChampionship: false,
    importPointsFor: 120,
    updatedAt: new Date('2026-09-08T00:00:00Z'),
    lastSyncedAt: null,
    ...over,
  }
}

beforeEach(() => {
  state.imported = []
  state.links = []
  state.legacy = []
  state.teams = []
  state.seasons = []
  state.failTeams = false
  state.failSeasons = false
  h.teamWhere.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('loadCareerLedger — claimed-team source', () => {
  it('(1) a joiner who owns no League row gets a ledger row from their claimed team', async () => {
    state.teams = [team()]

    const rows = await loadCareerLedger(['joiner'])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      userId: 'joiner',
      source: 'team',
      key: 'sleeper:SL1:2026',
      platform: 'sleeper',
      sport: 'NFL',
      season: 2026,
      refId: 'league-1',
      wins: 3,
      losses: 1,
      gamesPlayed: 4,
      pointsFor: 480.5,
      leagueSize: 12,
      playoffTeams: 6,
      scoring: 'ppr',
      completed: false,
    })
  })

  it('a team with no games played carries no points', async () => {
    state.teams = [team({ wins: 0, losses: 0, pointsFor: 0 })]
    const [row] = await loadCareerLedger(['joiner'])
    expect(row.pointsFor).toBeNull()
    expect(row.gamesPlayed).toBe(0)
  })

  it('(2) a claimed team in a NATIVE league is excluded — native seasons come only from franchise_seasons', async () => {
    state.teams = [team({ league: { platform: 'allfantasy', platformLeagueId: 'AF1' } })]

    const rows = await loadCareerLedger(['joiner'])

    expect(rows).toEqual([])
    expect(h.teamWhere[0]).toMatchObject({ league: { platform: { notIn: NATIVE_PLATFORMS } } })
  })

  it('(2b) a mixed-case native tag the case-sensitive query lets through is still dropped', async () => {
    state.teams = [team({ league: { platform: 'AllFantasy', platformLeagueId: 'AF1' } })]
    expect(await loadCareerLedger(['joiner'])).toEqual([])
  })

  it('an ARCHIVED team is excluded through the canonical lifecycle predicate', async () => {
    state.teams = [team({ lifecycleState: 'ARCHIVED' })]

    expect(await loadCareerLedger(['joiner'])).toEqual([])
    expect(h.teamWhere[0]).toMatchObject({ lifecycleState: { not: 'ARCHIVED' } })
  })

  it('(3a) the import_* row wins on the same key when the team has not played more games', async () => {
    state.imported = [importedLeague({ importWins: 3, importLosses: 1, importPointsFor: 400 })]
    state.teams = [team({ claimedByUserId: 'owner', wins: 2, losses: 2, pointsFor: 999 })]

    const rows = await loadCareerLedger(['owner'])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'import', wins: 3, losses: 1, pointsFor: 400, gamesPlayed: 4 })
  })

  it('(3b) the team record replaces a frozen import_* snapshot when it has played MORE games', async () => {
    state.imported = [importedLeague({ importWins: 1, importLosses: 0, importPointsFor: 120 })]
    state.teams = [team({ claimedByUserId: 'owner', wins: 3, losses: 2, ties: 1, pointsFor: 700 })]

    const rows = await loadCareerLedger(['owner'])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      source: 'import',
      wins: 3,
      losses: 2,
      ties: 1,
      pointsFor: 700,
      gamesPlayed: 6,
      updatedAt: T0.toISOString(),
    })
  })

  it.each([
    { legacyWins: 1, legacyLosses: 3, teamWins: 3, teamLosses: 1, expectedWins: 1, expectedLosses: 3 },
    { legacyWins: 0, legacyLosses: 0, teamWins: 1, teamLosses: 1, expectedWins: 1, expectedLosses: 1 },
    { legacyWins: 0, legacyLosses: 1, teamWins: 0, teamLosses: 2, expectedWins: 0, expectedLosses: 2 },
    { legacyWins: 3, legacyLosses: 1, teamWins: 0, teamLosses: 0, expectedWins: 3, expectedLosses: 1 },
  ])('(4) legacy metadata survives while a longer synced record replaces its frozen result ($legacyWins-$legacyLosses, $teamWins-$teamLosses)', async ({ legacyWins, legacyLosses, teamWins, teamLosses, expectedWins, expectedLosses }) => {
    state.links = [{ id: 'joiner', legacyUserId: 'legacy-joiner' }]
    state.legacy = [
      {
        id: 'LL1',
        userId: 'legacy-joiner',
        name: 'Bla bla bla',
        sleeperLeagueId: 'SL1',
        season: 2026,
        sport: 'nfl',
        leagueType: 'Redraft',
        scoringType: 'PPR',
        specialtyFormat: 'standard',
        isSF: false,
        isTEP: false,
        teamCount: 12,
        playoffTeams: 6,
        status: 'in_season',
        winnerRosterId: null,
        updatedAt: T0,
        rosters: [
          { wins: legacyWins, losses: legacyLosses, ties: 0, pointsFor: 300, isChampion: false, finalStanding: null, playoffSeed: null, updatedAt: T0 },
        ],
      },
    ]
    state.teams = [team({ wins: teamWins, losses: teamLosses, pointsFor: 400 })]

    const rows = await loadCareerLedger(['joiner'])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'legacy', refId: 'LL1', wins: expectedWins, losses: expectedLosses, gamesPlayed: expectedWins + expectedLosses })
    if (teamWins + teamLosses > legacyWins + legacyLosses) expect(rows[0].pointsFor).toBe(400)
  })

  it('(5) a mid-season seed inside the cut is NOT a playoff berth', async () => {
    state.teams = [team({ currentRank: 1, league: { status: 'in_season' } })]
    const [row] = await loadCareerLedger(['joiner'])
    expect(row.completed).toBe(false)
    expect(row.madePlayoffs).toBe(false)
  })

  it('(5b) a completed season with a final rank inside the cut IS a berth; outside it is not', async () => {
    state.teams = [
      team({ id: 'in', currentRank: 6, league: { id: 'L-in', platformLeagueId: 'A', status: 'COMPLETE' } }),
      team({ id: 'out', currentRank: 7, league: { id: 'L-out', platformLeagueId: 'B', status: 'complete' } }),
    ]
    const rows = await loadCareerLedger(['joiner'])
    const byRef = Object.fromEntries(rows.map((r) => [r.refId, r]))
    expect(byRef['L-in']).toMatchObject({ completed: true, madePlayoffs: true })
    expect(byRef['L-out']).toMatchObject({ completed: true, madePlayoffs: false })
  })

  it('(6) a championship comes from LeagueSeason.championTeamId for that league+season', async () => {
    state.teams = [
      team({ id: 'champ', currentRank: 9, league: { id: 'L-won', platformLeagueId: 'A' } }),
      team({ id: 'loser', league: { id: 'L-lost', platformLeagueId: 'B' } }),
      team({ id: 'other-year', league: { id: 'L-2025', platformLeagueId: 'C', season: 2025 } }),
    ]
    state.seasons = [
      { leagueId: 'L-won', season: 2026, championTeamId: 'champ' },
      { leagueId: 'L-lost', season: 2026, championTeamId: 'somebody-else' },
      // A title in a DIFFERENT season of the league does not make 2025 a title.
      { leagueId: 'L-2025', season: 2024, championTeamId: 'other-year' },
    ]

    const rows = await loadCareerLedger(['joiner'])
    const byRef = Object.fromEntries(rows.map((r) => [r.refId, r]))

    // The champion is decided and credited a berth even though its final rank is outside the cut.
    expect(byRef['L-won']).toMatchObject({ wonChampionship: true, completed: true, madePlayoffs: true })
    expect(byRef['L-lost']).toMatchObject({ wonChampionship: false, completed: true })
    expect(byRef['L-2025']).toMatchObject({ wonChampionship: false, completed: false })
  })

  it('(7) a failing team read degrades to no team rows — it does not throw', async () => {
    state.imported = [importedLeague()]
    state.teams = [team()]
    state.failTeams = true

    const rows = await loadCareerLedger(['owner', 'joiner'])

    expect(rows.map((r) => r.source)).toEqual(['import'])
    expect(console.error).toHaveBeenCalled()
  })

  it('(7b) a failing champion read drops the whole team source rather than rows without their titles', async () => {
    state.teams = [team()]
    state.failSeasons = true
    await expect(loadCareerLedger(['joiner'])).resolves.toEqual([])
  })

  it('reads only the requested managers', async () => {
    state.teams = [team(), team({ id: 'team-2', claimedByUserId: 'stranger' })]
    const rows = await loadCareerLedger(['joiner'])
    expect(rows.map((r) => r.userId)).toEqual(['joiner'])
  })
})
