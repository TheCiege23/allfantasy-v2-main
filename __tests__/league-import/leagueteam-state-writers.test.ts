// @vitest-environment node
/**
 * THE LIFECYCLE AND MANAGER AXES, PROVEN BY RUNNING THE REAL WRITERS.
 *
 * 🛑 WHAT THIS EXISTS TO CATCH. `LeagueTeam.isOrphan` carried SEVEN different meanings across
 * 13 mutation sites, and two of them are set by the SAME Sleeper import pipeline with OPPOSITE
 * lifecycles:
 *
 *   `bootstrapLeagueFromNormalizedImport`  isOrphan = !source_manager_id
 *                                          → the provider LISTS this seat with no manager.
 *                                            A live franchise with an empty chair. CURRENT.
 *   `applySleeperScopeToLeague` (removals)  isOrphan = absent from a complete roster response.
 *                                          → the team is GONE. ARCHIVED.
 *
 * One boolean, one provider, one pipeline, two opposite meanings, and no reader could separate
 * them. `lifecycleState` and `managerKind` are what separate them, and this file proves the
 * writers actually populate them rather than proving a fixture was typed correctly.
 *
 * ⚠ THE FIRST BLOCK CALLS PRODUCTION CODE, NOT A FIXTURE IMITATION OF IT. An earlier test in
 * this batch was correctly criticised for asserting the shape of rows it had written itself,
 * which proves nothing about the writer. Here `applySleeperScopeToLeague` is invoked exactly as
 * the sync path invokes it, and the assertions read back what IT wrote. The three syncs are
 * sequential on purpose: arrival → disappearance → reappearance is one story, and the
 * reappearance step is the only thing that can catch a row left reading CURRENT while still
 * carrying its own `archivedAt`.
 *
 * ⚠ `// @vitest-environment node` is load-bearing: `lib/prisma.ts` exports `null` under a DOM
 * runtime, and this repo's default vitest environment defines `window`.
 *
 * ⚠ REQUIRES THE MIGRATION `20260910140000_leagueteam_lifecycle_manager_axes` AND A REGENERATED
 * PRISMA CLIENT. Without the columns Prisma raises P2022; without the client regeneration it
 * rejects `lifecycleState` as an unknown argument. Both are ordinary post-pull steps.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TARGET =
  process.env.DATABASE_URL ?? process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL ?? ''
const HAS_DB = process.env.VITEST_NO_DATABASE !== '1' && Boolean(TARGET)
const describeDb = HAS_DB ? describe : describe.skip

const STAMP = Date.now()
const OWNED = {
  leagueId: `a3-state-${STAMP}`,
  userId: `a3-state-user-${STAMP}`,
  season: 2026,
}

/** The three franchises. `vacant` deliberately has NO manager id — that is the VACANT signal. */
const TEAM = {
  human: 'a3-team-human',
  vacant: 'a3-team-vacant',
  departing: 'a3-team-departing',
}

/**
 * @param fetchStatus IMP-04 status. MUST be `fetched` / `fetched_empty` for removal
 *   reconciliation to be permitted — see `isAuthoritativeStatus`. Writing an invented value like
 *   `'ok'` here silently disables the archive path and turns the disappearance test into a check
 *   that cannot fail; that happened on the first run of this file and is why the parameter is
 *   explicit rather than hard-coded.
 */
function roster(sourceTeamId: string, managerId: string, name: string, fetchStatus = 'fetched') {
  return {
    source_team_id: sourceTeamId,
    source_manager_id: managerId,
    owner_name: name,
    team_name: `${name} FC`,
    avatar_url: null,
    is_commissioner: false,
    is_co_commissioner: false,
    wins: 1,
    losses: 1,
    ties: 0,
    points_for: 100,
    points_against: 90,
    player_ids: [] as string[],
    starter_ids: [] as string[],
    reserve_ids: [] as string[],
    taxi_ids: [] as string[],
    /* IMP-04: an authoritative observation, so removal reconciliation is allowed to run. */
    fetch_status: fetchStatus,
  }
}

const FULL = { state: 'full' as const }
const NONE = { state: 'none' as const }

/** A NormalizedImportResult carrying only what the teams_rosters scope reads. */
function normalizedWith(rosters: ReturnType<typeof roster>[]) {
  return {
    source: { provider: 'sleeper', source_league_id: `sleeper-${OWNED.leagueId}`, fetched_at: new Date().toISOString() },
    league: {
      name: 'A3 state fixture',
      season: String(OWNED.season),
      sport: 'NFL',
      team_count: rosters.length,
      is_dynasty: true,
    },
    rosters,
    scoring: null,
    schedule: [],
    draft_picks: [],
    transactions: [],
    standings: [],
    player_map: {},
    coverage: {
      leagueSettings: FULL,
      /* 🛑 The removal path refuses to run unless this says `full` AND every roster is an
       * observation. Both gates are deliberately satisfied here — that is the scenario under
       * test — and the second block below proves the archive does NOT happen without them. */
      currentRosters: FULL,
      historicalRosterSnapshots: NONE,
      scoringSettings: NONE,
      playoffSettings: NONE,
      currentStandings: NONE,
      currentSchedule: NONE,
      draftHistory: NONE,
      tradeHistory: NONE,
      previousSeasons: NONE,
      playerIdentityMap: NONE,
    },
  } as never
}

async function sync(rosters: ReturnType<typeof roster>[]) {
  const { applySleeperScopeToLeague } = await import('@/lib/import-os/collector/applySleeperLeagueSync')
  return applySleeperScopeToLeague({
    leagueId: OWNED.leagueId,
    scope: 'teams_rosters' as never,
    normalized: normalizedWith(rosters),
  })
}

async function stateOf(externalId: string) {
  const { prisma } = await import('@/lib/prisma')
  return prisma.leagueTeam.findFirst({
    where: { leagueId: OWNED.leagueId, externalId },
    select: {
      externalId: true,
      isOrphan: true,
      lifecycleState: true,
      managerKind: true,
      archivedAt: true,
      archiveReason: true,
      eliminatedAt: true,
    },
  })
}

describeDb('LeagueTeam lifecycle + manager axes, written by the real writers', () => {
  beforeAll(async () => {
    expect(TARGET, 'refusing to create fixtures against a Neon endpoint').not.toMatch(/neon\.tech/i)
    expect(TARGET, 'refusing: the db-guard sentinel means no database was named').not.toMatch(
      /127\.0\.0\.1:1\b/,
    )

    const { prisma } = await import('@/lib/prisma')
    await prisma.tenant.upsert({
      where: { id: 'allfantasy' },
      update: {},
      create: { id: 'allfantasy', slug: 'allfantasy', name: 'AllFantasy' },
    })
    await prisma.appUser.create({
      data: { id: OWNED.userId, email: `${OWNED.userId}@a3.fixture.invalid`, username: OWNED.userId },
    })
    await prisma.league.create({
      data: {
        id: OWNED.leagueId,
        userId: OWNED.userId,
        name: 'A3 state fixture',
        platform: 'sleeper',
        platformLeagueId: `sleeper-${OWNED.leagueId}`,
        sport: 'NFL',
        season: OWNED.season,
        isDynasty: true,
      },
    })
  })

  afterAll(async () => {
    const { prisma } = await import('@/lib/prisma')
    await prisma.leagueTeam.deleteMany({ where: { leagueId: OWNED.leagueId } })
    await prisma.roster.deleteMany({ where: { leagueId: OWNED.leagueId } })
    await prisma.league.deleteMany({ where: { id: OWNED.leagueId } })
    await prisma.appUser.deleteMany({ where: { id: OWNED.userId } })

    /* Cleanup is asserted, never swallowed — after a failing run as well as a passing one. */
    expect(
      {
        teams: await prisma.leagueTeam.count({ where: { leagueId: OWNED.leagueId } }),
        leagues: await prisma.league.count({ where: { id: OWNED.leagueId } }),
        users: await prisma.appUser.count({ where: { id: OWNED.userId } }),
      },
      'fixture cleanup left rows behind',
    ).toEqual({ teams: 0, leagues: 0, users: 0 })
  })

  it('ARRIVAL: the importer marks every listed seat CURRENT, and splits HUMAN from VACANT', async () => {
    await sync([
      roster(TEAM.human, 'sleeper-mgr-1', 'Human One'),
      /* No manager id at all — this is the seat the provider lists with an empty chair. */
      roster(TEAM.vacant, '', 'Open Seat'),
      roster(TEAM.departing, 'sleeper-mgr-3', 'Soon Gone'),
    ])

    const human = await stateOf(TEAM.human)
    const vacant = await stateOf(TEAM.vacant)

    expect(human, 'the importer did not create the human-managed team').toBeTruthy()
    expect(vacant, 'the importer did not create the vacant team').toBeTruthy()

    /* 🛑 BOTH ARE CURRENT. The vacant seat is not archived, not hidden, not a lesser row. */
    expect(human!.lifecycleState).toBe('CURRENT')
    expect(vacant!.lifecycleState).toBe('CURRENT')

    expect(human!.managerKind).toBe('HUMAN')
    expect(vacant!.managerKind).toBe('VACANT')

    /* And the axes really are orthogonal: the vacant seat carries the legacy flag AND CURRENT. */
    expect(vacant!.isOrphan, 'the legacy flag must still be written for the backfill').toBe(true)
    expect(human!.isOrphan).toBe(false)

    /* Nothing has been archived, so no archival metadata may exist yet. */
    expect(vacant!.archivedAt).toBeNull()
    expect(vacant!.archiveReason).toBeNull()
  })

  it('DISAPPEARANCE: a team absent from a complete response is ARCHIVED, with the reason recorded', async () => {
    /* The same league, resynced without `departing`. Coverage is full and every roster is an
     * observation, so removal reconciliation is permitted to run. */
    await sync([roster(TEAM.human, 'sleeper-mgr-1', 'Human One'), roster(TEAM.vacant, '', 'Open Seat')])

    const gone = await stateOf(TEAM.departing)
    expect(gone!.lifecycleState).toBe('ARCHIVED')
    expect(gone!.archivedAt, 'an archive must be stamped, not merely flagged').not.toBeNull()
    expect(gone!.archiveReason).toBe('absent_from_authoritative_roster_response')

    /*
     * 🛑 AND THE SURVIVORS MUST NOT HAVE MOVED. This is the assertion that would have caught the
     * original bug: the vacant seat is ALSO `isOrphan: true`, and a reconciliation that keyed on
     * that flag rather than on presence in the response would have archived it too.
     */
    const vacant = await stateOf(TEAM.vacant)
    expect(vacant!.lifecycleState, 'a vacant seat is not a departed one').toBe('CURRENT')
    expect(vacant!.archivedAt).toBeNull()
    expect((await stateOf(TEAM.human))!.lifecycleState).toBe('CURRENT')
  })

  it('🛑 NEGATIVE CONTROL: an UNOBSERVED roster set must NOT archive anybody', async () => {
    /*
     * The mirror of the test above, and the reason that one is trustworthy. Same missing team,
     * same `coverage.currentRosters = full` — but one roster reports `failed`, so the response is
     * not an observation and `isAuthoritativeStatus` closes the gate.
     *
     * Without this, "the team was archived" could equally mean "the archive path runs on
     * everything", and a provider timeout would quietly retire live franchises. Restore the team
     * first so this asserts a NON-transition rather than inheriting the previous test's archive.
     */
    await sync([
      roster(TEAM.human, 'sleeper-mgr-1', 'Human One'),
      roster(TEAM.vacant, '', 'Open Seat'),
      roster(TEAM.departing, 'sleeper-mgr-3', 'Still Here'),
    ])
    expect((await stateOf(TEAM.departing))!.lifecycleState, 'precondition').toBe('CURRENT')

    await sync([
      roster(TEAM.human, 'sleeper-mgr-1', 'Human One'),
      /* One unreadable roster poisons the whole response's authority. */
      roster(TEAM.vacant, '', 'Open Seat', 'failed'),
    ])

    const survivor = await stateOf(TEAM.departing)
    expect(
      survivor!.lifecycleState,
      'a team missing from an UNOBSERVED response must not be archived',
    ).toBe('CURRENT')
    expect(survivor!.archivedAt).toBeNull()
  })

  it('REAPPEARANCE: a returning team is restored to CURRENT and its archive stamp is RETRACTED', async () => {
    /*
     * ⚠ THIS TEST ESTABLISHES ITS OWN PRECONDITION RATHER THAN INHERITING ONE. The negative
     * control above deliberately leaves `departing` CURRENT, so relying on test order would make
     * this assert `CURRENT -> CURRENT` and pass without ever exercising a retraction — a check
     * that cannot fail, arrived at by nothing more than adding a test in between.
     */
    await sync([roster(TEAM.human, 'sleeper-mgr-1', 'Human One'), roster(TEAM.vacant, '', 'Open Seat')])
    const archived = await stateOf(TEAM.departing)
    expect(archived!.lifecycleState, 'precondition: must be archived before we test the return').toBe(
      'ARCHIVED',
    )
    expect(archived!.archivedAt, 'precondition: a stamp must exist to be retracted').not.toBeNull()

    await sync([
      roster(TEAM.human, 'sleeper-mgr-1', 'Human One'),
      roster(TEAM.vacant, '', 'Open Seat'),
      roster(TEAM.departing, 'sleeper-mgr-3', 'Back Again'),
    ])

    const back = await stateOf(TEAM.departing)
    expect(back!.lifecycleState).toBe('CURRENT')
    expect(back!.managerKind).toBe('HUMAN')

    /*
     * 🛑 THE STAMP MUST BE CLEARED, NOT LEFT STANDING BESIDE ITS OWN REFUTATION. A row reading
     * CURRENT while still carrying `archivedAt` is unresolvable by any later audit — it says the
     * team both left and did not leave, and nothing records which fact is newer.
     */
    expect(back!.archivedAt, 'a restored team must not keep its archive timestamp').toBeNull()
    expect(back!.archiveReason).toBeNull()
  })
})

describeDb('UNKNOWN stays distinguishable, and the selectors honour it', () => {
  const L = `a3-sel-${STAMP}`
  const U = `a3-sel-user-${STAMP}`

  beforeAll(async () => {
    expect(TARGET).not.toMatch(/neon\.tech/i)
    expect(TARGET).not.toMatch(/127\.0\.0\.1:1\b/)
    const { prisma } = await import('@/lib/prisma')
    await prisma.tenant.upsert({
      where: { id: 'allfantasy' },
      update: {},
      create: { id: 'allfantasy', slug: 'allfantasy', name: 'AllFantasy' },
    })
    await prisma.appUser.create({
      data: { id: U, email: `${U}@a3.fixture.invalid`, username: U },
    })
    await prisma.league.create({
      data: {
        id: L,
        userId: U,
        name: 'A3 selector fixture',
        platform: 'manual',
        platformLeagueId: L,
        sport: 'NFL',
        season: 2026,
        isDynasty: true,
      },
    })

    /* A HISTORICAL row: written the way every pre-migration row exists — neither axis stated. */
    await prisma.leagueTeam.create({
      data: { leagueId: L, externalId: 'sel-legacy', teamName: 'Legacy', ownerName: 'Legacy' },
    })
    /* A genuinely vacant, classified seat. */
    await prisma.leagueTeam.create({
      data: {
        leagueId: L,
        externalId: 'sel-vacant',
        teamName: 'Vacant',
        ownerName: 'Vacant',
        isOrphan: true,
        lifecycleState: 'CURRENT',
        managerKind: 'VACANT',
      },
    })
    /* An ELIMINATED but still-current franchise — the guillotine's output shape. */
    await prisma.leagueTeam.create({
      data: {
        leagueId: L,
        externalId: 'sel-eliminated',
        teamName: 'Eliminated',
        ownerName: 'Eliminated',
        isOrphan: true,
        lifecycleState: 'CURRENT',
        managerKind: 'VACANT',
        eliminatedAt: new Date(),
      },
    })
  })

  afterAll(async () => {
    const { prisma } = await import('@/lib/prisma')
    await prisma.leagueTeam.deleteMany({ where: { leagueId: L } })
    await prisma.league.deleteMany({ where: { id: L } })
    await prisma.appUser.deleteMany({ where: { id: U } })
    expect(
      {
        teams: await prisma.leagueTeam.count({ where: { leagueId: L } }),
        leagues: await prisma.league.count({ where: { id: L } }),
        users: await prisma.appUser.count({ where: { id: U } }),
      },
      'selector fixture cleanup left rows behind',
    ).toEqual({ teams: 0, leagues: 0, users: 0 })
  })

  it('🛑 an unclassified row is UNKNOWN on BOTH axes — never silently CURRENT or HUMAN', async () => {
    const { prisma } = await import('@/lib/prisma')
    const legacy = await prisma.leagueTeam.findFirst({
      where: { leagueId: L, externalId: 'sel-legacy' },
      select: { lifecycleState: true, managerKind: true },
    })
    /*
     * This is the invariant the whole corrective batch turns on. A default of CURRENT would
     * convert an unmeasured population into a claim about it, and a default of HUMAN would
     * assert a person is running a seat nobody has looked at.
     */
    expect(legacy).toEqual({ lifecycleState: 'UNKNOWN', managerKind: 'UNKNOWN' })
  })

  it('current-franchise reads INCLUDE unknown and vacant seats; archived reads exclude them', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { CURRENT_FRANCHISES_INCLUDING_UNKNOWN, ARCHIVED_FRANCHISES, UNCLASSIFIED_FRANCHISES } =
      await import('@/lib/league-import/teamLifecycle')

    expect(
      await prisma.leagueTeam.count({ where: { leagueId: L, ...CURRENT_FRANCHISES_INCLUDING_UNKNOWN } }),
      'league size must count the vacant seat, the eliminated team and the unclassified row',
    ).toBe(3)
    expect(await prisma.leagueTeam.count({ where: { leagueId: L, ...ARCHIVED_FRANCHISES } })).toBe(0)
    expect(await prisma.leagueTeam.count({ where: { leagueId: L, ...UNCLASSIFIED_FRANCHISES } })).toBe(1)
  })

  it('🛑 CLAIMABLE excludes UNKNOWN — the asymmetry is deliberate and must not be "tidied up"', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { CLAIMABLE_FRANCHISES } = await import('@/lib/league-import/teamLifecycle')

    /*
     * Offering an unclassified row as claimable could hand someone a departed manager's
     * franchise. Omitting a genuinely vacant one only delays advertising a seat. The costs are
     * not symmetric, so the selector is not either: UNKNOWN is excluded, and that exclusion is
     * the point of the test.
     *
     * The eliminated seat IS claimable, and that is deliberate rather than an oversight —
     * elimination is a COMPETITION fact, not an occupancy one, so a knocked-out franchise with
     * nobody in the chair is still a seat a person can take over. Only the unclassified row is
     * withheld.
     */
    const claimable = await prisma.leagueTeam.findMany({
      where: { leagueId: L, ...CLAIMABLE_FRANCHISES },
      select: { externalId: true },
      orderBy: { externalId: 'asc' },
    })
    expect(claimable.map((c) => c.externalId)).toEqual(['sel-eliminated', 'sel-vacant'])
  })

  it('elimination is a THIRD axis: eliminated teams stay current but leave the eligible set', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { ELIGIBLE_FRANCHISES_INCLUDING_UNKNOWN } = await import('@/lib/league-import/teamLifecycle')

    const eliminated = await prisma.leagueTeam.findFirst({
      where: { leagueId: L, externalId: 'sel-eliminated' },
      select: { lifecycleState: true, eliminatedAt: true },
    })
    /* 🛑 NOT ARCHIVED. Archiving an eliminated team deletes a live franchise from its league. */
    expect(eliminated!.lifecycleState).toBe('CURRENT')
    expect(eliminated!.eliminatedAt).not.toBeNull()

    expect(
      await prisma.leagueTeam.count({ where: { leagueId: L, ...ELIGIBLE_FRANCHISES_INCLUDING_UNKNOWN } }),
      'the eliminated team must drop out of the competition set only',
    ).toBe(2)
  })
})
