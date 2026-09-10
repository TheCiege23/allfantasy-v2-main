/**
 * `getLeagueHomeData` authorization contract.
 *
 * 🛑 THE LOAD-BEARING ASSERTION IS `not.toHaveBeenCalled()`, NOT THE RETURN VALUE.
 * A gate that refuses and reads the league anyway passes any test that only
 * inspects `status`. The defect this replaces did exactly that in reverse — it
 * read everything and then merely *displayed* less — so every refusal case here
 * also asserts that not one downstream league read was reached.
 *
 * WHAT WAS WRONG, measured on a running server (2026-09-10). The function was
 * `findUnique({ where: { id: leagueId } })` with no `userId` clause; `userId` was
 * used only AFTER the league loaded, to find the viewer's own team. An account
 * registered seconds earlier — no `League.userId`, no `RedraftLeagueMember`, no
 * `Roster`, no claimed `LeagueTeam` — fetched `/core?league=<someone else's id>`
 * and received HTTP 200, the league home root, and the league's real name in the
 * `<h1>`, while `leagueNameForTitle` in the same route scoped correctly and
 * withheld that name from the `<title>`.
 *
 * ⚠ THE REAL RESOLVER RUNS HERE. `resolveLeagueMembership` is deliberately NOT
 * mocked — only prisma underneath it is — so these tests exercise the actual
 * four membership paths rather than a restatement of them. Mocking the predicate
 * would make every case below pass against a gate that does not work.
 *
 * ⚠ AND `unavailable` IS A PASS FOR THE ADMIT CASES, NOT A FAILURE. The loader is
 * left unmocked and fails on the stub prisma, so an admitted viewer comes back
 * `unavailable`. That is fine and is asserted precisely: the security question is
 * whether the gate ADMITTED them and execution continued past it, which is
 * checked by the loader's own `league.findUnique` having been reached. Full data
 * for an entitled viewer is proved in the browser proof, not here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  redraftFindUnique: vi.fn(),
  rosterCount: vi.fn(),
  leagueTeamFindFirst: vi.fn(),
  // Downstream league reads. None may run for a refused viewer.
  getLeagueActivity: vi.fn(),
  getLeagueScoreboard: vi.fn(),
  getRecentTrades: vi.fn(),
  getDraftHqAll: vi.fn(),
  getLeagueManagerHealth: vi.fn(),
  resolveImportCoverageSummary: vi.fn(),
  getAllPlayBoard: vi.fn(),
  getMatchupData: vi.fn(),
  getRivalRecords: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    redraftLeagueMember: { findUnique: mocks.redraftFindUnique },
    roster: { count: mocks.rosterCount, findFirst: vi.fn(), findMany: vi.fn() },
    leagueTeam: { findFirst: mocks.leagueTeamFindFirst, findMany: vi.fn() },
  },
}))

vi.mock('@/lib/core-app/leagueActivity', () => ({ getLeagueActivity: mocks.getLeagueActivity }))
vi.mock('@/lib/core-app/leagueScoreboard', () => ({ getLeagueScoreboard: mocks.getLeagueScoreboard }))
vi.mock('@/lib/core-app/recentTrades', () => ({ getRecentTrades: mocks.getRecentTrades }))
vi.mock('@/lib/core-app/draftHqAll', () => ({ getDraftHqAll: mocks.getDraftHqAll }))
vi.mock('@/lib/core-app/allPlay', () => ({ getAllPlayBoard: mocks.getAllPlayBoard }))
vi.mock('@/lib/core-app/matchup', () => ({ getMatchupData: mocks.getMatchupData }))
vi.mock('@/lib/core-app/dash3aPanels', () => ({ getRivalRecords: mocks.getRivalRecords }))
vi.mock('@/lib/commissioner-hub/managerHealth', () => ({
  getLeagueManagerHealth: mocks.getLeagueManagerHealth,
}))
vi.mock('@/lib/league-import/importCoverageSummary', () => ({
  resolveImportCoverageSummary: mocks.resolveImportCoverageSummary,
  UNKNOWN_IMPORT_COVERAGE: { sentence: null },
}))

import { getLeagueHomeData } from '@/lib/core-app/leagueHome'

const LEAGUE_ID = 'league-under-test'
const VIEWER = 'app-user-uuid-viewer'
const OWNER = 'app-user-uuid-owner'

/** The membership probe's own league read — `select: { id, sport, userId }`. */
const MEMBERSHIP_LEAGUE = { id: LEAGUE_ID, sport: 'NFL', userId: OWNER }

/** Every downstream league read, by the category the contract names. */
const DOWNSTREAM = {
  scoreboard: mocks.getLeagueScoreboard,
  'transactions / waivers': mocks.getLeagueActivity,
  trades: mocks.getRecentTrades,
  draft: mocks.getDraftHqAll,
  'commissioner hub': mocks.getLeagueManagerHealth,
  'import coverage': mocks.resolveImportCoverageSummary,
  standings: mocks.getAllPlayBoard,
  matchup: mocks.getMatchupData,
}

function expectNoLeagueReads() {
  for (const [label, spy] of Object.entries(DOWNSTREAM)) {
    expect(spy, `${label} read ran for a refused viewer`).not.toHaveBeenCalled()
  }
  /*
   * The membership probe reads the league once by design. A SECOND call is the
   * loader's own `findUnique`, i.e. execution continued past the gate — which is
   * the failure this whole file exists to catch.
   */
  expect(mocks.leagueFindUnique, 'the loader read the league after a refusal').toHaveBeenCalledTimes(1)
}

/** The gate admitted the viewer: execution reached the loader's league read. */
function expectAdmitted(result: { status: string }) {
  expect(result.status, 'the gate refused a legitimate member').not.toBe('unauthorized')
  expect(mocks.leagueFindUnique.mock.calls.length).toBeGreaterThan(1)
}

/** Nobody is a member unless a test says so. */
function denyAll() {
  mocks.leagueFindUnique.mockResolvedValue(MEMBERSHIP_LEAGUE)
  mocks.redraftFindUnique.mockResolvedValue(null)
  mocks.rosterCount.mockResolvedValue(0)
  mocks.leagueTeamFindFirst.mockResolvedValue(null)
}

beforeEach(() => {
  vi.clearAllMocks()
  denyAll()
})

describe('admits every canonical membership path', () => {
  it('allows the league owner (League.userId)', async () => {
    expectAdmitted(await getLeagueHomeData(LEAGUE_ID, OWNER))
  })

  it('allows a RedraftLeagueMember', async () => {
    mocks.redraftFindUnique.mockResolvedValue({ role: 'MANAGER' })
    expectAdmitted(await getLeagueHomeData(LEAGUE_ID, VIEWER))
  })

  it('allows a roster-backed member (Roster.platformUserId)', async () => {
    mocks.rosterCount.mockResolvedValue(1)
    expectAdmitted(await getLeagueHomeData(LEAGUE_ID, VIEWER))
  })

  it('allows a claimed-team member (LeagueTeam.claimedByUserId)', async () => {
    mocks.leagueTeamFindFirst.mockResolvedValue({ isCommissioner: false, isCoCommissioner: false })
    expectAdmitted(await getLeagueHomeData(LEAGUE_ID, VIEWER))
  })

  it('allows a commissioner', async () => {
    mocks.leagueTeamFindFirst.mockResolvedValue({ isCommissioner: true, isCoCommissioner: false })
    expectAdmitted(await getLeagueHomeData(LEAGUE_ID, VIEWER))
  })

  it('allows a CO-commissioner', async () => {
    /*
     * Pinned separately from commissioner because they fail independently.
     * `lib/commissioner/permissions.ts` gates on `League.userId` alone, which
     * 403s every co-commissioner — leagueHome.ts's own comment records that.
     */
    mocks.leagueTeamFindFirst.mockResolvedValue({ isCommissioner: false, isCoCommissioner: true })
    expectAdmitted(await getLeagueHomeData(LEAGUE_ID, VIEWER))
  })

  it('allows a redraft COMMISSIONER', async () => {
    mocks.redraftFindUnique.mockResolvedValue({ role: 'COMMISSIONER' })
    expectAdmitted(await getLeagueHomeData(LEAGUE_ID, VIEWER))
  })
})

describe('refuses everyone else, and reads nothing on the way out', () => {
  it('refuses an anonymous viewer', async () => {
    const result = await getLeagueHomeData(LEAGUE_ID, '')
    expect(result.status).toBe('unauthorized')
    /*
     * Anonymous short-circuits before even the membership league read, so this
     * is the one refusal where the count is zero rather than one.
     */
    for (const [label, spy] of Object.entries(DOWNSTREAM)) {
      expect(spy, `${label} read ran for an anonymous viewer`).not.toHaveBeenCalled()
    }
    expect(mocks.leagueFindUnique).not.toHaveBeenCalled()
  })

  it('refuses a signed-in non-member', async () => {
    const result = await getLeagueHomeData(LEAGUE_ID, VIEWER)
    expect(result.status).toBe('unauthorized')
    expectNoLeagueReads()
  })

  it('refuses a missing league', async () => {
    mocks.leagueFindUnique.mockResolvedValue(null)
    const result = await getLeagueHomeData('no-such-league', VIEWER)
    expect(result.status).toBe('unauthorized')
    expectNoLeagueReads()
  })

  it('refuses a platform admin who is not a member', async () => {
    /*
     * 🛑 NO ADMIN BYPASS, BY CONTRACT. `resolveLeagueMembership` has no
     * staff escape hatch and this must not add one: an admin is a non-member
     * here like anyone else. Nothing in the mocked world marks this viewer as
     * an admin precisely BECAUSE nothing in the code path may consult that —
     * so the assertion is that admin-ness is never even asked for.
     */
    const result = await getLeagueHomeData(LEAGUE_ID, 'platform-admin-uuid')
    expect(result.status).toBe('unauthorized')
    expectNoLeagueReads()
  })

  it('is externally indistinguishable between a missing and an unauthorized league', async () => {
    /*
     * 🛑 THE ENUMERATION DEFENCE. A viewer who can tell "no such league" from
     * "not your league" can discover which league ids exist by watching which
     * answer comes back. The two must be byte-identical results, not merely
     * rendered alike — which is why the type has ONE variant for both.
     */
    const nonMember = await getLeagueHomeData(LEAGUE_ID, VIEWER)

    vi.clearAllMocks()
    denyAll()
    mocks.leagueFindUnique.mockResolvedValue(null)
    const missing = await getLeagueHomeData('no-such-league', VIEWER)

    expect(missing).toEqual(nonMember)
    expect(JSON.stringify(missing)).toBe(JSON.stringify(nonMember))
    expect(Object.keys(missing)).toEqual(['status'])
  })
})

describe('Roster.platformUserId holds two different kinds of id', () => {
  /*
   * ⚠ THIS FIELD IS NOT ALWAYS AN APP USER ID, AND THAT IS BY DESIGN.
   * `lib/league-import/placeholderClaim.ts` states it: imports create Roster
   * rows whose `platformUserId` is "either a raw source manager id (e.g.
   * Sleeper's numeric user id) or a sentinel ('import:...')", and "neither maps
   * to an AF AppUser.id" — they are placeholders awaiting a claim. On claim the
   * row is rewritten to `candidate.appUserId`.
   *
   * So the resolver comparing an APP uuid against this column is correct in both
   * directions, and the two shapes are pinned here so a future identity change
   * cannot quietly turn an unclaimed placeholder into a membership grant.
   */
  it('admits a row already resolved to the AllFantasy user id', async () => {
    mocks.rosterCount.mockImplementation(async ({ where }: { where: { platformUserId: string } }) =>
      where.platformUserId === VIEWER ? 1 : 0,
    )
    expectAdmitted(await getLeagueHomeData(LEAGUE_ID, VIEWER))
  })

  it('does NOT admit on an unclaimed row still holding a raw platform id', async () => {
    // The league's only roster belongs to Sleeper manager "864...", not to this app user.
    mocks.rosterCount.mockImplementation(async ({ where }: { where: { platformUserId: string } }) =>
      where.platformUserId === '864123456789012345' ? 1 : 0,
    )
    const result = await getLeagueHomeData(LEAGUE_ID, VIEWER)
    expect(result.status).toBe('unauthorized')
    expectNoLeagueReads()
  })

  it('does NOT admit on an "import:" sentinel row', async () => {
    mocks.rosterCount.mockImplementation(async ({ where }: { where: { platformUserId: string } }) =>
      where.platformUserId === 'import:placeholder-3' ? 1 : 0,
    )
    const result = await getLeagueHomeData(LEAGUE_ID, VIEWER)
    expect(result.status).toBe('unauthorized')
    expectNoLeagueReads()
  })

  it('queries the roster column with the app user id, unmodified', async () => {
    /*
     * Guards the identity rule itself: no normalising, lower-casing or
     * prefix-stripping may creep in between the session and the query.
     */
    await getLeagueHomeData(LEAGUE_ID, VIEWER)
    expect(mocks.rosterCount).toHaveBeenCalledWith({
      where: { leagueId: LEAGUE_ID, platformUserId: VIEWER },
    })
  })
})
