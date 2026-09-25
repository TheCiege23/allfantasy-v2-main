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

// Only the feed read is doubled; the pricing helpers are the real ones under test.
vi.mock('@/lib/core-app/playerProjections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-app/playerProjections')>()),
  lookupProjections: mocks.lookupProjections,
}))

const LEAGUE_ID = 'league-1'
const PLATFORM_LEAGUE_ID = '992200000000000000'
const USER_ID = 'af-user-uuid-1'

/** My roster id is 3; the opponent's is 7. */
const MATCHUP_ROWS = [
  { rosterId: '3', matchupId: 1 },
  { rosterId: '7', matchupId: 1 },
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

/** Ten catches a week at a point each: worth ten under these rules. The generic figure is a decoy. */
const RULES = { rec: 1 }
type Projection = { projectedPoints: number; componentStats: Record<string, unknown> | null }
function projections(ids: string[]) {
  return new Map<string, Projection>(ids.map((id) => [id, { projectedPoints: 99, componentStats: { rec: 10 } }]))
}

async function run(scoringSettings: Record<string, unknown> | null = RULES) {
  const { getNextMatchup } = await import('@/lib/core-app/nextMatchup')
  return getNextMatchup({
    leagueId: LEAGUE_ID,
    platformLeagueId: PLATFORM_LEAGUE_ID,
    myExternalId: '3',
    userId: USER_ID,
    seasonYear: 2026,
    week: 1,
    scoringSettings,
    projectionWeek: { season: '2026', week: 1 },
  })
}

/*
 * 🛑 THIS DOUBLE HONOURS THE `where`, AND THAT IS THE POINT. With `mockResolvedValue` the rows come
 * back whatever the query asked for, so a test can prove the in-memory MATCH and still pass with a
 * query that could never have fetched the row. The orphan cases below use this instead.
 */
function setRosters(rows: Array<Record<string, unknown>>) {
  mocks.rosterFindMany.mockImplementation(async (args: { where?: { platformUserId?: { in?: string[] } } }) => {
    const keys = args?.where?.platformUserId?.in
    return keys ? rows.filter((r) => keys.includes(String(r.platformUserId))) : rows
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

  /*
   * 🛑 THE READ IS SCOPED TO THE LEAGUE AND NOT TO OWNER KEYS — THAT IS THE FIX, NOT A LOOSE QUERY.
   * It used to filter on the keys the two teams could be named by, which cannot express the key an
   * orphan team's roster is actually under (`orphan-<provider>-<teamId>`, since #1005). One league's
   * rosters is a dozen rows; the match happens in `resolveRostersForTeams`.
   */
  it('reads this league\'s rosters, and never another league\'s', async () => {
    mocks.rosterFindMany.mockResolvedValue([])
    await run()

    const where = mocks.rosterFindMany.mock.calls[0][0].where
    expect(where.leagueId).toBe(LEAGUE_ID)
    expect(where.platformUserId).toBeUndefined()
    expect(Object.keys(where)).toEqual(['leagueId'])
  })

  /*
   * 🛑 THE OPPONENT'S SIDE, WHICH IS WHERE THIS COMES BACK FROM.
   *
   * Since #1005 a managerless team's roster is keyed `orphan-<provider>-<teamId>` — no manager id
   * reaches it. Measured read-only on production 2026-09-17: 60 matchups of a claimed team, in 16
   * leagues, across all 18 weeks, are against such a team. The user saw their own total beside an em
   * dash and read it as a gap in the projections feed.
   */
  it('\u{1F6D1} prices an opponent whose roster is under the orphan key', async () => {
    setRosters([
      { id: 'r-mine', platformUserId: 'sleeper-user-3', playerData: { starters: ['a', 'b'] } },
      {
        id: 'r-opp',
        platformUserId: 'orphan-sleeper-7',
        playerData: { source_team_id: '7', starters: ['d', 'e'] },
      },
    ])

    const m = await run()
    expect(m?.you.projected).toBe(20)
    expect(m?.opponent?.projected).toBe(20)
    expect(m?.opponent?.starterCount).toBe(2)
  })

  /* The same break from the other direction: the team's manager changed, so its row keeps the old id. */
  it('prices a team whose stored owner key is nobody\'s current manager id', async () => {
    setRosters([
      { id: 'r-mine', platformUserId: 'sleeper-user-3', playerData: { starters: ['a', 'b'] } },
      {
        id: 'r-opp',
        platformUserId: 'sleeper-user-SOMEONE-ELSE',
        playerData: { source_team_id: '7', starters: ['d', 'e'] },
      },
    ])

    expect((await run())?.opponent?.projected).toBe(20)
  })

  /*
   * ⚠ THE TEAM ID MUST NOT OUTRANK ITSELF INTO THE WRONG ROW. A row carrying another team's id is
   * not this team's roster, however it is keyed.
   */
  it('never hands a team a row stamped with a different team id', async () => {
    setRosters([
      { id: 'r-mine', platformUserId: 'sleeper-user-3', playerData: { starters: ['a', 'b'] } },
      {
        id: 'r-other',
        platformUserId: 'sleeper-user-7',
        playerData: { source_team_id: '99', starters: ['d', 'e'] },
      },
    ])

    /* Rule 3 still finds it by the owner key — but only because that key names team 7. */
    expect((await run())?.opponent?.projected).toBe(20)

    setRosters([
      { id: 'r-mine', platformUserId: 'sleeper-user-3', playerData: { starters: ['a', 'b'] } },
      { id: 'r-other', platformUserId: 'orphan-sleeper-99', playerData: { source_team_id: '99', starters: ['d', 'e'] } },
    ])
    expect((await run())?.opponent?.projected).toBeNull()
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

/*
 * 🛑 LEAGUE SCORING OR NOTHING (scoring audit, 2026-09-16). This fell back to the generic
 * figure per starter, so a total could be part league-scored and part standard PPR, and the
 * Matchup tab refused the very league this screen priced.
 */
describe('getNextMatchup pricing', () => {
  const lineups = [
    { platformUserId: 'sleeper-user-3', playerData: { starters: ['a', 'b', 'c'] } },
    { platformUserId: 'sleeper-user-7', playerData: { starters: ['d', 'e'] } },
  ]

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.weeklyMatchupFindMany.mockResolvedValue(MATCHUP_ROWS)
    mocks.leagueTeamFindMany.mockResolvedValue(TEAMS)
    mocks.rosterFindMany.mockResolvedValue(lineups)
    mocks.lookupProjections.mockImplementation(async (ids: string[]) => projections(ids))
  })

  it('prices under the league rules, never at the generic figure', async () => {
    const m = await run()
    expect(m?.you.projected).toBe(30)
    expect(m?.unpricedReason).toBeNull()
  })

  it('🛑 a starter the rules cannot price is LEFT OUT, not counted at his generic 99', async () => {
    mocks.lookupProjections.mockImplementation(async (ids: string[]) => {
      const map = projections(ids)
      // A defender: generic 0 and no component line — unpriceable, not a priced zero.
      map.set('b', { projectedPoints: 0, componentStats: null })
      // A line the rules have no key for.
      map.set('c', { projectedPoints: 99, componentStats: { def_int: 1 } })
      return map
    })
    const m = await run()
    expect(m?.you.projected).toBe(10)
    expect(m?.you.projectedFrom).toBe(1)
    expect(m?.you.starterCount).toBe(3)
    expect(m?.unpricedReason).toBeNull()
  })

  it('🛑 no rules on file: no totals, the shared reason, and no feed read', async () => {
    const { NO_LEAGUE_SCORING_REASON } = await import('@/lib/projections/leagueScoring')
    const m = await run(null)
    expect(m?.you.projected).toBeNull()
    expect(m?.opponent?.projected).toBeNull()
    expect(m?.unpricedReason).toBe(NO_LEAGUE_SCORING_REASON)
    expect(mocks.lookupProjections).not.toHaveBeenCalled()
  })

  it('⚠ a label-only settings object is no rules either', async () => {
    const { NO_LEAGUE_SCORING_REASON } = await import('@/lib/projections/leagueScoring')
    const m = await run({ rules: {}, sport: 'NFL', preset: 'ppr', scoringFormat: 'PPR' })
    expect(m?.you.projected).toBeNull()
    expect(m?.unpricedReason).toBe(NO_LEAGUE_SCORING_REASON)
  })

  it('rules that match no projected stat say so, rather than blaming the league', async () => {
    const { NOTHING_LEAGUE_SCORED_REASON } = await import('@/lib/core-app/playerProjections')
    const m = await run({ sack_yds: 2 })
    expect(m?.you.projected).toBeNull()
    expect(m?.unpricedReason).toBe(NOTHING_LEAGUE_SCORED_REASON)
  })
})

/*
 * 🛑 THE CALLER'S LINEUP AND PRICER, WHEN IT HAS THEM (My Team, 2026-09-25). The card re-read the
 * stored roster and re-priced it without the OUT/bye rule, so it disagreed with the header above
 * it by ~27 points on a real league. The screen-level agreement is pinned in
 * `my-team-projection-agreement.test.ts`; these pin the seam.
 */
describe('getNextMatchup with a caller-supplied lineup and pricer', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.weeklyMatchupFindMany.mockResolvedValue(MATCHUP_ROWS)
    mocks.leagueTeamFindMany.mockResolvedValue(TEAMS)
    mocks.rosterFindMany.mockResolvedValue([
      { platformUserId: 'sleeper-user-3', playerData: { starters: ['stale-a', 'stale-b'] } },
      { platformUserId: 'sleeper-user-7', playerData: { starters: ['d', 'e'] } },
    ])
    mocks.lookupProjections.mockImplementation(async (ids: string[]) => projections(ids))
  })

  async function runWith(extra: Record<string, unknown>, scoringSettings: Record<string, unknown> | null = RULES) {
    const { getNextMatchup } = await import('@/lib/core-app/nextMatchup')
    return getNextMatchup({
      leagueId: LEAGUE_ID,
      platformLeagueId: PLATFORM_LEAGUE_ID,
      myExternalId: '3',
      userId: USER_ID,
      seasonYear: 2026,
      week: 1,
      scoringSettings,
      projectionWeek: { season: '2026', week: 1 },
      ...extra,
    })
  }

  it('prices YOUR side from the lineup you pass, not the stored roster, and never reads the feed itself', async () => {
    const seen: Array<[string, readonly string[]]> = []
    const priceLineups = vi.fn(async (lineups: ReadonlyMap<string, readonly string[]>) => {
      seen.push(...lineups)
      return new Map([...lineups].map(([rid, ids]) => [rid, { projected: ids.length * 7, projectedFrom: ids.length }]))
    })
    const m = await runWith({ myStarters: ['live-a', '0', 'live-b', 'live-c'], priceLineups })

    expect(seen).toEqual([
      ['3', ['live-a', 'live-b', 'live-c']],
      ['7', ['d', 'e']],
    ])
    expect(m?.you.projected).toBe(21)
    expect(m?.you.starterCount).toBe(3)
    expect(m?.opponent?.projected).toBe(14)
    expect(mocks.lookupProjections).not.toHaveBeenCalled()
  })

  it('a pricer that throws leaves both sides unpriced rather than taking the card down', async () => {
    const m = await runWith({ priceLineups: async () => { throw new Error('boom') } })
    expect(m?.you.projected).toBeNull()
    expect(m?.opponent?.projected).toBeNull()
  })

  it('no rules on file: the pricer is not asked', async () => {
    const priceLineups = vi.fn()
    const m = await runWith({ priceLineups }, null)
    expect(priceLineups).not.toHaveBeenCalled()
    expect(m?.you.projected).toBeNull()
  })
})
