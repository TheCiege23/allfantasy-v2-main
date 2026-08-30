/**
 * The projected-matchup roster join.
 *
 * ⚠ THIS IS A REGRESSION TEST FOR A FAILURE THAT LOOKED LIKE MISSING DATA.
 * `getNextMatchup` joined `LeagueTeam.platformUserId` → `Roster.platformUserId`
 * and nothing else, while every other surface on the My Team screen goes
 * through `myRosterCandidates`, which tries three keys. On a league whose
 * roster row is keyed the other way the function read an EMPTY starting lineup
 * and returned `projected: null` — so the screen rendered "— v 161.7" directly
 * beneath a header tile reading 224.5, both built from the same starters.
 *
 * Nothing threw and nothing logged. The only tell was an em dash, which this
 * screen uses everywhere to mean "we do not hold this", so it read as a gap in
 * the projections feed rather than as a join that missed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  weeklyMatchupFindMany: vi.fn(),
  leagueTeamFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
  lookupProjections: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: { findMany: mocks.weeklyMatchupFindMany },
    leagueTeam: { findMany: mocks.leagueTeamFindMany },
    roster: { findMany: mocks.rosterFindMany },
  },
}))

vi.mock('@/lib/core-app/playerProjections', () => ({
  lookupProjections: mocks.lookupProjections,
}))

const LEAGUE_ID = 'league-1'
const PLATFORM_LEAGUE_ID = '992200000000000000'
const USER_ID = 'af-user-uuid-1'

/** My roster id is 3; the opponent's is 7. */
const MATCHUP_ROWS = [
  { rosterId: 3, matchupId: 1 },
  { rosterId: 7, matchupId: 1 },
]

const TEAMS = [
  {
    externalId: '3',
    teamName: 'TheCiege24',
    ownerName: 'TheCiege24',
    avatarUrl: null,
    platformUserId: 'sleeper-user-3',
  },
  {
    externalId: '7',
    teamName: 'Rookie Fever',
    ownerName: 'robertkks',
    avatarUrl: null,
    platformUserId: 'sleeper-user-7',
  },
]

/** Every starter is worth ten under the generic line; nobody is scored by rules. */
function projections(ids: string[]) {
  return new Map(ids.map((id) => [id, { projectedPoints: 10, componentStats: null }]))
}

async function run() {
  const { getNextMatchup } = await import('@/lib/core-app/nextMatchup')
  return getNextMatchup({
    leagueId: LEAGUE_ID,
    platformLeagueId: PLATFORM_LEAGUE_ID,
    myExternalId: '3',
    userId: USER_ID,
    seasonYear: 2026,
    week: 1,
    scoringSettings: null,
    projectionWeek: { season: '2026', week: 1 },
  })
}

describe('getNextMatchup roster join', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.weeklyMatchupFindMany.mockResolvedValue(MATCHUP_ROWS)
    mocks.leagueTeamFindMany.mockResolvedValue(TEAMS)
    mocks.lookupProjections.mockImplementation(async (ids: string[]) => projections(ids))
  })

  it('prices your side when your roster is keyed by the platform id', async () => {
    mocks.rosterFindMany.mockResolvedValue([
      { platformUserId: 'sleeper-user-3', playerData: { starters: ['a', 'b', 'c'] } },
      { platformUserId: 'sleeper-user-7', playerData: { starters: ['d', 'e'] } },
    ])

    const m = await run()
    expect(m?.you.projected).toBe(30)
    expect(m?.opponent?.projected).toBe(20)
  })

  /*
   * The known positive. Before the fix this returned `projected: null` with
   * `starterCount: 0` while the opponent priced normally — the exact asymmetry
   * seen on the real screen.
   */
  it('prices your side when your roster is keyed by OUR user id instead', async () => {
    mocks.rosterFindMany.mockResolvedValue([
      { platformUserId: USER_ID, playerData: { starters: ['a', 'b', 'c'] } },
      { platformUserId: 'sleeper-user-7', playerData: { starters: ['d', 'e'] } },
    ])

    const m = await run()
    expect(m?.you.projected).toBe(30)
    expect(m?.you.starterCount).toBe(3)
    expect(m?.opponent?.projected).toBe(20)
  })

  it("prices a side keyed by the team's externalId", async () => {
    mocks.rosterFindMany.mockResolvedValue([
      { platformUserId: '3', playerData: { starters: ['a', 'b', 'c'] } },
      { platformUserId: '7', playerData: { starters: ['d', 'e'] } },
    ])

    const m = await run()
    expect(m?.you.projected).toBe(30)
    expect(m?.opponent?.projected).toBe(20)
  })

  /*
   * ⚠ THE USER UUID IS OFFERED FOR THE CALLER'S TEAM ONLY. It is not a key any
   * opponent's roster could legitimately carry, and widening the query without
   * scoping the lookup would let one roster answer for two teams.
   */
  it('never lets our user id resolve the opponent', async () => {
    mocks.rosterFindMany.mockResolvedValue([
      { platformUserId: USER_ID, playerData: { starters: ['a', 'b', 'c'] } },
    ])

    const m = await run()
    expect(m?.you.projected).toBe(30)
    expect(m?.opponent?.projected).toBeNull()
    expect(m?.opponent?.starterCount).toBe(0)
  })

  it('queries only the keys the two teams can be reached by', async () => {
    mocks.rosterFindMany.mockResolvedValue([])
    await run()

    const where = mocks.rosterFindMany.mock.calls[0][0].where
    expect(where.leagueId).toBe(LEAGUE_ID)
    expect(new Set(where.platformUserId.in)).toEqual(
      new Set(['sleeper-user-3', '3', USER_ID, 'sleeper-user-7', '7']),
    )
  })

  /* An unfilled Sleeper slot is written as "0" and must not be priced. */
  it('drops empty starting slots before pricing', async () => {
    mocks.rosterFindMany.mockResolvedValue([
      { platformUserId: 'sleeper-user-3', playerData: { starters: ['a', '0', 'c'] } },
      { platformUserId: 'sleeper-user-7', playerData: { starters: ['d', 'e'] } },
    ])

    const m = await run()
    expect(m?.you.projected).toBe(20)
    expect(m?.you.starterCount).toBe(2)
  })
})
