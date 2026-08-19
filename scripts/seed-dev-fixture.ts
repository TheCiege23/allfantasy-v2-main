/**
 * Deterministic local-dev fixture: gives the Local Dev User BOTH dashboard contexts to observe.
 *
 *   League A — "Dev Commissioner League"  : Local Dev User OWNS it  -> Commissioner Focus
 *   League B — "Dev Managed League"       : Local Dev User is MEMBER -> Team Focus
 *
 * Composed from the patterns already proven by scripts/seed-managed-only-dev-league.ts and
 * scripts/seed-redraft-war-room-runtime.ts rather than inventing a parallel fixture shape.
 *
 * PROPERTIES (all required by the verification-first brief):
 *  - SAFE      : refuses any target not positively identified as safe, via `assertSafeSeedTarget`
 *                (scripts/db-target-identity.cjs). Fails closed — production, an unrecognised
 *                endpoint, and an absent/unparseable DATABASE_URL all abort. The host-marker lists
 *                this used to carry were inverted; see the note where they were removed.
 *  - IDEMPOTENT: deterministic ids + upserts; re-running converges to the same state. Rosters/members
 *                for the two fixture leagues are replaced wholesale (scoped strictly to these two
 *                league ids — never a global delete).
 *  - CANONICAL : writes real `League` / `Roster` / `RedraftLeagueMember` rows via Prisma Client, not
 *                mocked UI-only objects.
 *
 * RUN:
 *   node --env-file=.env --require ./scripts/_audit-preload.cjs --import tsx scripts/seed-dev-fixture.ts
 * or:
 *   npm run seed:dev
 *
 * RESET (removes ONLY this fixture's two leagues and their children):
 *   npm run seed:dev -- --reset
 */

/*
 * The host allow/deny lists that used to live here were INVERTED, and the seed advertised itself
 * as safe while carrying them:
 *
 *   PROD_HOST_MARKERS  = ['ep-spring-tooth', 'prod', 'production']
 *   DEV_HOST_ALLOWLIST = ['ep-curly-block', 'localhost', '127.0.0.1']
 *
 * `ep-curly-block` IS production and sat on the DEV allowlist; `ep-spring-tooth` is the safe dev
 * fork and was named as production. So this guard permitted the dangerous target, refused the safe
 * one, and printed "target OK (non-production)" while pointed at the real database. That is the
 * precise bug `scripts/db-target-identity.cjs` exists to end: identity is the (endpoint, database)
 * PAIR, because production and the dev shadow share a Neon compute and differ only by db name.
 *
 * Target checking now delegates to that single source of truth via `assertSafeSeedTarget`.
 */

const LOCAL_DEV_USER = {
  id: 'local-dev-user',
  email: 'local-dev@allfantasy.local',
  username: 'local_dev_user',
  displayName: 'Local Dev User',
}

// Deterministic — re-running the seed converges instead of duplicating.
const FIXTURE = {
  commissionerLeagueId: 'dev-fixture-commissioner-league',
  managedLeagueId: 'dev-fixture-managed-league',
  syntheticCommissionerId: 'dev-fixture-synthetic-commissioner',
  season: 2026,
} as const

const MANAGER_NAMES = [
  'Gridiron Gang',
  'Dynasty Dragons',
  'Sunday Scaries',
  'Waiver Wire Wolves',
  'Play Action Panthers',
  'Red Zone Raiders',
  'Hail Mary Hawks',
  'Blitz Brigade',
  'Pylon Pirates',
]

async function main() {
  const reset = process.argv.includes('--reset')
  // Fail closed before the first write. Logs the credential-free target itself.
  const { assertSafeSeedTarget } = await import('./_assert-safe-seed-target')
  assertSafeSeedTarget('seed-dev-fixture')

  const { prisma } = await import('../lib/prisma')
  const db = prisma as any

  const fixtureLeagueIds = [FIXTURE.commissionerLeagueId, FIXTURE.managedLeagueId]

  // Scoped teardown — ONLY this fixture's two leagues. Never a global delete.
  const clearFixtureChildren = async () => {
    await db.redraftLeagueMember.deleteMany({ where: { leagueId: { in: fixtureLeagueIds } } }).catch(() => {})
    await db.roster.deleteMany({ where: { leagueId: { in: fixtureLeagueIds } } }).catch(() => {})
  }

  if (reset) {
    await clearFixtureChildren()
    await db.league.deleteMany({ where: { id: { in: fixtureLeagueIds } } }).catch(() => {})
    console.log('[seed:dev] reset complete — fixture leagues removed. Nothing else was touched.')
    await prisma.$disconnect()
    return
  }

  // 1. Local Dev User — find-or-create so the seed works before the first bypass login.
  let devUser = await prisma.appUser.findFirst({
    where: {
      OR: [
        { id: LOCAL_DEV_USER.id },
        { email: { equals: LOCAL_DEV_USER.email, mode: 'insensitive' } },
        { username: LOCAL_DEV_USER.username },
      ],
    },
  })
  if (!devUser) {
    devUser = await prisma.appUser.create({
      data: { ...LOCAL_DEV_USER, emailVerified: new Date() },
    })
    console.log('[seed:dev] created Local Dev User')
  }

  // 2. Synthetic commissioner — owns League B so the dev user is a member there, not an owner.
  const syntheticCommissioner = await prisma.appUser.upsert({
    where: { id: FIXTURE.syntheticCommissionerId },
    update: {},
    create: {
      id: FIXTURE.syntheticCommissionerId,
      email: 'dev-fixture-commissioner@allfantasy.local',
      username: 'dev_fixture_commish',
      displayName: 'Fixture Commissioner',
      emailVerified: new Date(),
    },
  })

  await clearFixtureChildren()

  // 3. League A — Commissioner Focus.
  //    resolveIsCommissioner() (lib/dashboard/get-dashboard-league-list.ts) returns true when the
  //    viewer owns the row AND (isCommissioner flag OR platform is allfantasy/manual/af/native).
  const commissionerLeague = await db.league.upsert({
    where: { id: FIXTURE.commissionerLeagueId },
    update: { name: 'Dev Commissioner League' },
    create: {
      id: FIXTURE.commissionerLeagueId,
      userId: devUser.id,
      platform: 'allfantasy',
      platformLeagueId: 'dev-fixture-commissioner',
      name: 'Dev Commissioner League',
      sport: 'NFL',
      season: FIXTURE.season,
      leagueSize: MANAGER_NAMES.length + 1,
      isDynasty: false,
      leagueType: 'redraft',
      status: 'in_season',
      lifecycleState: 'in_season',
      isCommissioner: true,
    },
  })

  // 4. League B — Team Focus (dev user is a MEMBER; a different user owns it).
  const managedLeague = await db.league.upsert({
    where: { id: FIXTURE.managedLeagueId },
    update: { name: 'Dev Managed League' },
    create: {
      id: FIXTURE.managedLeagueId,
      userId: syntheticCommissioner.id,
      platform: 'allfantasy',
      platformLeagueId: 'dev-fixture-managed',
      name: 'Dev Managed League',
      sport: 'NFL',
      season: FIXTURE.season,
      leagueSize: 10,
      isDynasty: false,
      leagueType: 'redraft',
      status: 'in_season',
      lifecycleState: 'in_season',
      isCommissioner: false,
    },
  })

  // 5. Managers — the dev user plus synthetic opponents, so league size is realistic rather than 1.
  const managerUsers: { id: string; name: string }[] = []
  for (let i = 0; i < MANAGER_NAMES.length; i++) {
    const id = `dev-fixture-manager-${i + 1}`
    await prisma.appUser.upsert({
      where: { id },
      update: {},
      create: {
        id,
        email: `dev-fixture-manager-${i + 1}@allfantasy.local`,
        username: `dev_fixture_mgr_${i + 1}`,
        displayName: MANAGER_NAMES[i],
        emailVerified: new Date(),
      },
    })
    managerUsers.push({ id, name: MANAGER_NAMES[i] })
  }

  // 6. Rosters. The dev user gets one in BOTH leagues (a roster is what makes a league "yours").
  await db.roster.create({
    data: { leagueId: commissionerLeague.id, platformUserId: devUser.id, playerData: {} },
  })
  for (const m of managerUsers) {
    await db.roster.create({
      data: { leagueId: commissionerLeague.id, platformUserId: m.id, playerData: {} },
    })
  }

  await db.roster.create({
    data: { leagueId: managedLeague.id, platformUserId: syntheticCommissioner.id, playerData: {} },
  })
  await db.roster.create({
    data: { leagueId: managedLeague.id, platformUserId: devUser.id, playerData: {} },
  })

  // 7. Membership roles — MEMBER in League B is what keeps it out of Commissioner Focus.
  await db.redraftLeagueMember
    .create({ data: { leagueId: managedLeague.id, userId: devUser.id, role: 'MEMBER' } })
    .catch(() => {})

  const rosterCount = await db.roster.count({ where: { leagueId: { in: fixtureLeagueIds } } })

  console.log('[seed:dev] done.')
  console.log(`  Commissioner Focus -> "${commissionerLeague.name}" (${commissionerLeague.id}) owner=${devUser.id}`)
  console.log(`  Team Focus         -> "${managedLeague.name}" (${managedLeague.id}) owner=${syntheticCommissioner.id}, dev user = MEMBER`)
  console.log(`  managers seeded: ${managerUsers.length + 1} across 2 leagues, rosters: ${rosterCount}`)
  console.log('  Log in at /login -> "Continue as Local Dev User"')

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
  try {
    const { prisma } = await import('../lib/prisma')
    await prisma.$disconnect()
  } catch {}
})
