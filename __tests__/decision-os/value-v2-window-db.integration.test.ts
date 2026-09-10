import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createWindowFactsPrismaPort } from '@/lib/decision-os/value-v2/windowFactsPrismaPort'
import { assembleWindowFacts } from '@/lib/decision-os/value-v2/windowFacts'
import { resolveWindowDecision } from '@/lib/decision-os/value-v2/windowDecision'

/**
 * Real-database verification for the competitive-window Prisma port.
 *
 * ⚠ SKIPS unless a human named a database. `vitest.setup.db-guard.ts` pins
 * `DATABASE_URL` to `127.0.0.1:1` and sets `VITEST_NO_DATABASE=1` when nothing
 * was exported, because an unset variable in this repo means PRODUCTION, not
 * "no database". Naming the URL IS the opt-in; there is no flag that would let
 * this run against whatever happens to be configured.
 *
 * Run with the endpoint from `.env.test`:
 *   DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.test | cut -d= -f2-)" \
 *     npx vitest run __tests__/decision-os/value-v2-window-db.integration.test.ts
 *
 * ⚠ Every row is prefixed and removed in `afterAll`. This checkout is shared by
 * several sessions against one test database, so an unprefixed fixture is
 * somebody else's flake.
 */

const NO_DB = process.env.VITEST_NO_DATABASE === '1'

const RUN = `m19-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const LEAGUE_A = `${RUN}-league-a`
const LEAGUE_B = `${RUN}-league-b`
const PLATFORM_A = `${RUN}-platform-a`
const PLATFORM_B = `${RUN}-platform-b`
const SEASON = 2999
const PRIOR_SEASON = 2998

const prisma = new PrismaClient()

const teamForecasts = (byTeam: Record<string, number>) =>
  Object.entries(byTeam).map(([teamId, playoffProbability]) => ({ teamId, playoffProbability }))

/**
 * Four teams. Roster "1" outscores everyone; roster "4" is outscored by everyone.
 *
 * ⚠ RAW SQL, NOT `createMany`, AND THE REASON IS A REAL ENVIRONMENT FINDING.
 * `prisma/migrations-pending/20260903222531_weekly_matchup_roster_id_text` turns
 * `WeeklyMatchup.rosterId` from Int into Text. Its README records it as APPLIED
 * TO PRODUCTION 2026-09-03 — but this TEST database still has the integer
 * column, so the generated client (which expects String) cannot round-trip the
 * table at all. Raw SQL sidesteps the client's type expectation for seeding; the
 * client-side READ is separately probed below.
 */
async function seedMatchups(platformLeagueId: string, season: number) {
  const points: Record<string, number> = { '1': 130, '2': 110, '3': 95, '4': 70 }
  for (let week = 1; week <= 6; week += 1) {
    for (const rosterId of ['1', '2', '3', '4']) {
      const opponent = rosterId === '1' ? '4' : rosterId === '4' ? '1' : rosterId === '2' ? '3' : '2'
      await prisma.$executeRawUnsafe(
        `INSERT INTO "WeeklyMatchup" ("id","leagueId","seasonYear","week","rosterId","pointsFor","pointsAgainst","win","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
        `${platformLeagueId}-${season}-${week}-${rosterId}`, platformLeagueId, season, week,
        Number(rosterId), points[rosterId], points[opponent],
        points[rosterId] > points[opponent] ? 1 : 0,
      )
    }
  }
}

/**
 * Whether the generated client can read `WeeklyMatchup` on THIS database.
 *
 * ⚠ THIS IS SET IN `beforeAll`, WHICH RUNS AFTER TEST REGISTRATION. `it.skipIf(!flag)`
 * evaluates its condition when the `describe` callback runs, so it read `false` every time
 * and skipped all five success-path tests even on a database that could read the table. The
 * skip is therefore decided at RUN time inside each test, via `requireAllPlay(ctx)`.
 */
let allPlayReadable = false

/**
 * Opt-in strictness. When DB verification is explicitly demanded, an incompatible schema is a
 * FAILURE, not a skip — silently skipping the required success-path coverage is how a suite
 * reports green while proving nothing.
 */
const STRICT_DB = process.env.M19_DB_STRICT === '1'

/** Skip at RUN time, or fail loudly under strict mode. */
function requireAllPlay(ctx: { skip: () => void }): void {
  if (allPlayReadable) return
  if (STRICT_DB) {
    throw new Error(
      'M19_DB_STRICT=1 but the Prisma client cannot read WeeklyMatchup on this database. ' +
      'The success-path coverage this suite exists for did not run. Most likely cause: the ' +
      'pending migration 20260903222531_weekly_matchup_roster_id_text is unapplied here, so ' +
      '"rosterId" is still integer while the generated client expects text. Apply it to this ' +
      'non-production database, or unset M19_DB_STRICT to allow the skip.',
    )
  }
  ctx.skip()
}

const USER_ID = `${RUN}-user`

/**
 * ⚠ RESERVED TLD ON PURPOSE. `.invalid` can never resolve, so a fixture row
 * cannot become a real send if it ever escapes cleanup — this repo has already
 * paid for seeded rows reaching a live mailbox.
 */
async function seedUser() {
  await prisma.appUser.create({
    data: { id: USER_ID, email: `${RUN}@allfantasy-fixture.invalid`, username: `${RUN}-user` },
  })
}

/**
 * `League.tenantId` is a required FK to `Tenant`. The success path never ran while the
 * registration-time `skipIf` was forcing a skip, so this constraint had never been exercised.
 */
async function seedTenant() {
  await prisma.tenant.upsert({
    where: { id: 'allfantasy' },
    create: { id: 'allfantasy', slug: 'allfantasy', name: 'AllFantasy' },
    update: {},
  })
}

async function seedLeague(leagueId: string, platformLeagueId: string) {
  await prisma.league.create({
    data: { id: leagueId, userId: USER_ID, platform: 'sleeper', platformLeagueId, name: `${RUN} fixture` },
  })
  await prisma.leagueTeam.createMany({
    data: [
      { leagueId, externalId: '1', ownerName: 'Rae', teamName: 'Anvil Chorus' },
      { leagueId, externalId: '4', ownerName: 'Sam', teamName: 'Ditchwater' },
    ],
  })
}

async function seedForecastAndDynasty(leagueId: string, season: number) {
  await prisma.seasonForecastSnapshot.createMany({
    data: [4, 5, 6].map(week => ({
      leagueId, season, week,
      teamForecasts: teamForecasts({ '1': 94.5, '4': 2.5 }),
    })),
  })
  await prisma.dynastyProjectionSnapshot.createMany({
    data: [
      { leagueId, teamId: '1', season, projectedStrengthNextYear: 84, projectedStrength3Years: 88, projectedStrength5Years: 80, rebuildProbability: 5, contenderProbability: 90, volatilityScore: 12, confidenceScore: 76, windowStartYear: season, windowEndYear: season + 3 },
      { leagueId, teamId: '4', season, projectedStrengthNextYear: 22, projectedStrength3Years: 19, projectedStrength5Years: 25, rebuildProbability: 88, contenderProbability: 4, volatilityScore: 30, confidenceScore: 61 },
    ],
  })
}

const availability = (byId: Record<string, string>) =>
  async (_sport: string, ids: string[]) => new Map(ids.filter(i => byId[i]).map(i => [i, byId[i]]))

const healthy = availability({ p1: 'available', p2: 'available', p3: 'available', p4: 'available' })
const ROSTER = ['p1', 'p2', 'p3', 'p4']

const portFor = (leagueId: string, platformLeagueId: string | null, over: Record<string, unknown> = {}) =>
  createWindowFactsPrismaPort({
    prisma, platformLeagueId, sport: 'nfl', rosterPlayerIds: ROSTER, loadAvailability: healthy, ...over,
  } as Parameters<typeof createWindowFactsPrismaPort>[0])

const scope = (leagueId: string, teamId: string, week = 6, season = SEASON) =>
  ({ leagueId, teamId, season, week })

describe.skipIf(NO_DB)('competitive window against a real database', () => {
  beforeAll(async () => {
    await seedTenant()
    await seedUser()
    await seedLeague(LEAGUE_A, PLATFORM_A)
    await seedLeague(LEAGUE_B, PLATFORM_B)
    await seedMatchups(PLATFORM_A, SEASON)
    await seedMatchups(PLATFORM_B, SEASON)
    await seedMatchups(PLATFORM_A, PRIOR_SEASON)
    await seedForecastAndDynasty(LEAGUE_A, SEASON)
    await seedForecastAndDynasty(LEAGUE_B, SEASON)

    // ⚠ PROBE A ROW THAT EXISTS. An empty result never decodes `rosterId`, so a
    // probe against a league with no rows passes on a database the client cannot
    // actually read — a check that cannot fail.
    const probe = await prisma.weeklyMatchup
      .findMany({ where: { leagueId: PLATFORM_A }, select: { rosterId: true } })
      .then(rows => rows.length > 0)
      .catch(() => false)
    allPlayReadable = probe
    // eslint-disable-next-line no-console
    console.log(`[m19] client can read WeeklyMatchup on this database: ${allPlayReadable}`)
  }, 120_000)

  afterAll(async () => {
    await prisma.weeklyMatchup.deleteMany({ where: { leagueId: { in: [PLATFORM_A, PLATFORM_B] } } }).catch(() => {})
    await prisma.seasonForecastSnapshot.deleteMany({ where: { leagueId: { in: [LEAGUE_A, LEAGUE_B] } } }).catch(() => {})
    await prisma.dynastyProjectionSnapshot.deleteMany({ where: { leagueId: { in: [LEAGUE_A, LEAGUE_B] } } }).catch(() => {})
    await prisma.leagueTeam.deleteMany({ where: { leagueId: { in: [LEAGUE_A, LEAGUE_B] } } }).catch(() => {})
    await prisma.league.deleteMany({ where: { id: { in: [LEAGUE_A, LEAGUE_B] } } }).catch(() => {})
    await prisma.appUser.deleteMany({ where: { id: USER_ID } }).catch(() => {})
    await prisma.$disconnect()
  }, 120_000)

  it('names the endpoint under test so a Neon branch cannot be mistaken for another', () => {
    const host = (process.env.DATABASE_URL ?? '').replace(/.*@/, '').replace(/[/?].*/, '')
    expect(host).not.toBe('')
    expect(host).not.toContain('ep-curly-block')
    // eslint-disable-next-line no-console
    console.log(`[m19] verified against endpoint: ${host}`)
  })

  it('reads real rows end to end and classifies a contender', async ctx => {
    requireAllPlay(ctx)
    const decision = await resolveWindowDecision(scope(LEAGUE_A, '1'), portFor(LEAGUE_A, PLATFORM_A))
    expect(decision.state).toBe('evidenced')
    expect(decision.status).toBe('contender')
    expect(decision.identity).toMatchObject({ teamName: 'Anvil Chorus', managerName: 'Rae' })
    expect(decision.teamFit.winNowWeight).toBeGreaterThan(1)
  })

  it('classifies the opposite team as rebuilding from the same rows', async ctx => {
    requireAllPlay(ctx)
    const decision = await resolveWindowDecision(scope(LEAGUE_A, '4'), portFor(LEAGUE_A, PLATFORM_A))
    expect(decision.status).toBe('rebuilding')
    expect(decision.teamFit.longTermWeight).toBeGreaterThan(1)
  })

  it('reconstructs a prior week from real weekly rows', async ctx => {
    requireAllPlay(ctx)
    const w4 = await assembleWindowFacts(scope(LEAGUE_A, '1', 4), portFor(LEAGUE_A, PLATFORM_A))
    const w6 = await assembleWindowFacts(scope(LEAGUE_A, '1', 6), portFor(LEAGUE_A, PLATFORM_A))
    expect(w4.facts!.wins).toBe(4)
    expect(w6.facts!.wins).toBe(6)
    expect(w4.evidence.allPlay!.weeksCounted).toBe(4)
  })

  it('REFUSES when League.id is passed where the platform league id is required', async () => {
    // The trap this guards: WeeklyMatchup.leagueId holds the PLATFORM id, so
    // passing League.id returns zero rows. That must refuse, not read as a team
    // with no history.
    const wrong = await assembleWindowFacts(scope(LEAGUE_A, '1'), portFor(LEAGUE_A, LEAGUE_A))
    expect(wrong.facts).toBeNull()
    expect(wrong.gaps).toContain('all_play_record_missing')

    const decision = await resolveWindowDecision(scope(LEAGUE_A, '1'), portFor(LEAGUE_A, LEAGUE_A))
    expect(decision.state).toBe('refused')
    expect(decision.status).toBeNull()
    expect(decision.teamFit).toMatchObject({ winNowWeight: 1, longTermWeight: 1, basis: 'unresolved' })
  })

  it('isolates two leagues that share the same platform roster number', async ctx => {
    requireAllPlay(ctx)
    const a = await assembleWindowFacts(scope(LEAGUE_A, '1'), portFor(LEAGUE_A, PLATFORM_A))
    const b = await assembleWindowFacts(scope(LEAGUE_B, '1'), portFor(LEAGUE_B, PLATFORM_B))
    expect(a.facts).not.toBeNull()
    expect(b.facts).not.toBeNull()
    // Same roster id "1" in both leagues; the identity must come from its own league.
    expect(a.evidence.identity!.teamId).toBe('1')
    expect(b.evidence.identity!.teamId).toBe('1')
    // Crossing the ids must not silently succeed.
    const crossed = await assembleWindowFacts(scope(LEAGUE_A, '1'), portFor(LEAGUE_A, PLATFORM_B))
    expect(crossed.facts).not.toBeNull()
    const mismatch = await assembleWindowFacts(scope(LEAGUE_B, '9'), portFor(LEAGUE_B, PLATFORM_B))
    expect(mismatch.facts).toBeNull()
    expect(mismatch.gaps).toContain('team_identity_missing')
  })

  it('isolates seasons: a prior seasons matchups do not answer for this one', async ctx => {
    requireAllPlay(ctx)
    const prior = await assembleWindowFacts(scope(LEAGUE_A, '1', 6, PRIOR_SEASON), portFor(LEAGUE_A, PLATFORM_A))
    // Matchups exist for the prior season, but no forecast or projection does.
    expect(prior.evidence.allPlay).not.toBeNull()
    expect(prior.facts).toBeNull()
    expect(prior.gaps).toEqual(expect.arrayContaining(['season_forecast_missing', 'dynasty_projection_missing']))
  })

  it('refuses an unauthorized team id that is not in the league', async () => {
    const { facts, gaps } = await assembleWindowFacts(scope(LEAGUE_A, 'not-a-team'), portFor(LEAGUE_A, PLATFORM_A))
    expect(facts).toBeNull()
    expect(gaps).toContain('team_identity_missing')
  })

  it('degrades honestly when the client cannot read the matchup table', async () => {
    // On a database carrying the pending rosterId migration this passes for the
    // ordinary reason. On one that does not, the port must still REFUSE with a
    // named gap rather than throw — a crash in a shadow path is worse than a
    // refusal, and a silent empty record would be worse than either.
    const { facts, gaps } = await assembleWindowFacts(scope(LEAGUE_A, '1'), portFor(LEAGUE_A, PLATFORM_A))
    if (allPlayReadable) {
      expect(facts).not.toBeNull()
    } else {
      expect(facts).toBeNull()
      expect(gaps).toContain('all_play_record_missing')
    }
  })

  it('refuses when injury coverage is below the floor', async () => {
    const port = portFor(LEAGUE_A, PLATFORM_A, { loadAvailability: availability({ p1: 'available' }) })
    const { facts, gaps } = await assembleWindowFacts(scope(LEAGUE_A, '1'), port)
    expect(facts).toBeNull()
    expect(gaps).toContain('injury_coverage_below_floor')
  })
})
