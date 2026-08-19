/**
 * Remove seed/e2e fixture data from a real database.
 *
 * ⚠ THE DRY RUN IS A REAL DELETE THAT GETS ROLLED BACK.
 * Deleting one `app_users` row cascades into 85 child tables (measured: 100 FKs reference
 * app_users — 85 CASCADE, 15 SET NULL, 0 blocking; `leagues` has 143, of which only
 * `LeagueManagerClaim` blocks). Predicting that blast radius by reading the schema is exactly the
 * kind of guess that goes wrong, so this script performs the deletes inside a transaction,
 * measures every affected table, and then ROLLS BACK unless `--apply` was passed. The numbers you
 * see in a dry run are therefore what will actually happen, not an estimate.
 *
 * ⚠ SELECTION IS BY EMAIL DOMAIN, NOT BY PASSWORD OR ID PREFIX.
 * A test domain is the one unambiguous signal: no real user has an `@example.com` address.
 * Selecting on "weak password" would catch the one real user who has one, and selecting on id
 * prefix already proved unreliable — it undercounted the exposed-account sweep eightfold.
 *
 * WHAT THIS FIXES BEYOND TIDINESS
 * Fixtures are not inert for metrics. Before this ran, production held 205 fixture accounts out
 * of 256 users, and 5 of the 7 rows in `user_subscriptions` — so "users" was ~80% fake and any
 * subscription number was ~71% fixtures. Reporting off that table means reporting fiction.
 *
 * 🛑 TAKE A DATABASE-LEVEL SNAPSHOT BEFORE `--apply`. THE JSON SNAPSHOT IS NOT ENOUGH.
 * It captures the `app_users`, `leagues` and `Player` rows this script deletes directly — but the
 * cascade removes rows in ~65 OTHER tables (560 `external_entity_mappings`, 159 `rosters`,
 * 144 `user_profiles`, and so on), and none of those are in the file. Restoring from it would
 * bring back the parents and none of their history. On Neon, create a branch or note a
 * point-in-time-restore timestamp first; that is the only real undo for this operation.
 *
 * Usage:
 *   npx tsx scripts/cleanup-fixture-data.ts            # deletes, measures, ROLLS BACK
 *   npx tsx scripts/cleanup-fixture-data.ts --apply    # snapshots parents, deletes, commits
 *
 * NOTE ON PATHS: these examples assume cwd is the checkout that CONTAINS this file. This
 * branch is usually checked out as a git worktree while the primary tree sits on another
 * branch, in which case run it from the primary tree with the worktree path, e.g.
 *   npx tsx .claude/worktrees/admiring-bassi-bff03b/scripts/cleanup-fixture-data.ts
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../lib/prisma'

const APPLY = process.argv.includes('--apply')
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

/** No real user has one of these. This is the whole selection rule. */
const TEST_DOMAINS = ['@example.com', '@example.org', '@example.net', '@allfantasy.local']

/** Fixture league/roster ids created by the seed families. */
const FIXTURE_ID_LIKES = [
  'rwr-%', 'bbwr-%', 'dwr-%', 'kwr-%', 'gwr-%', '%-runtime-%',
  'survivor-phase%', 'dev-fixture-%', 'sp2-%', 'sp3-%',
]

/** `Player` rows a runtime seed created, identified by the provider key it stamped. */
const SEED_PROVIDER_KEY_LIKE = '%runtime%'

const domainClause = (col: string) =>
  '(' + TEST_DOMAINS.map((d) => `${col} ILIKE '%${d}'`).join(' OR ') + ')'

/**
 * ⚠ THE CARVE-OUT THAT MAKES THIS SAFE, AND IT WAS NOT OBVIOUS.
 *
 * `leagues.userId` references `app_users` with ON DELETE CASCADE, so deleting a fixture account
 * silently deletes every league it created — including leagues that real people later joined. The
 * first dry run selected 10 fixture leagues and would have removed 26, and one of the extra 16
 * ("12-Team NFL Redraft League") held rosters for two real users. Nothing in the selection
 * criteria hinted at that; only measuring the cascade surfaced it.
 *
 * So any league containing a roster owned by a non-test user is PROTECTED, and so is the fixture
 * account that owns it. Those accounts have already had their passwords rotated, so keeping a
 * couple of them costs nothing, whereas deleting a real user's league is unrecoverable from their
 * point of view even with a snapshot.
 */
const PROTECTED_LEAGUES_SQL = `
  SELECT DISTINCT l.id
  FROM leagues l
  JOIN rosters r ON r."leagueId" = l.id
  JOIN app_users u ON u.id = r."platformUserId"
  WHERE NOT ${'(' + TEST_DOMAINS.map((d) => `u.email ILIKE '%${d}'`).join(' OR ') + ')'}
`

/** Fixture accounts that own a protected league — kept so the cascade cannot reach it. */
const PROTECTED_USERS_SQL = `
  SELECT DISTINCT l."userId" AS id
  FROM leagues l
  WHERE l."userId" IS NOT NULL AND l.id IN (${PROTECTED_LEAGUES_SQL})
`

async function main() {
  const target = await prisma.$queryRawUnsafe<Array<{ db: string }>>(
    `SELECT current_database() AS db`,
  )
  console.log(`target: ${target[0].db}`)
  console.log(APPLY ? 'MODE: APPLY (commits)' : 'MODE: dry run (deletes, measures, rolls back)')

  // ── What is protected, reported before anything else ──
  const protectedLeagues = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT l.id FROM "leagues" l WHERE l.id IN (${PROTECTED_LEAGUES_SQL}) ORDER BY 1`,
  )
  const protectedUsers = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "app_users" WHERE id IN (${PROTECTED_USERS_SQL}) AND ${domainClause('email')} ORDER BY 1`,
  )
  console.log(`\nPROTECTED: ${protectedLeagues.length} league(s) hold a real user's roster`)
  console.log(`PROTECTED: ${protectedUsers.length} fixture account(s) own one, so they are kept too`)

  // ── What we intend to remove ──
  const users = await prisma.$queryRawUnsafe<Array<{ id: string; email: string }>>(
    `SELECT id, email FROM "app_users"
     WHERE ${domainClause('email')} AND id NOT IN (${PROTECTED_USERS_SQL}) ORDER BY id`,
  )
  const leagues = await prisma.$queryRawUnsafe<Array<{ id: string; name: string | null }>>(
    `SELECT id, name FROM "leagues"
     WHERE id LIKE ANY($1::text[]) AND id NOT IN (${PROTECTED_LEAGUES_SQL}) ORDER BY id`,
    FIXTURE_ID_LIKES,
  )
  const players = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(
    `SELECT DISTINCT p.id, p.name FROM "Player" p, LATERAL jsonb_object_keys(p.provider_ids::jsonb) k
     WHERE p.provider_ids IS NOT NULL AND k LIKE $1 ORDER BY p.id`,
    SEED_PROVIDER_KEY_LIKE,
  )

  console.log(`\nfixture users   (test email domain): ${users.length}`)
  console.log(`fixture leagues (seed id prefix)   : ${leagues.length}`)
  console.log(`seed-created Player rows            : ${players.length}`)

  if (users.length + leagues.length + players.length === 0) {
    console.log('\nnothing to do.')
    await prisma.$disconnect()
    return
  }

  /*
   * ⚠ REFUSE IF A NON-TEST ADDRESS SOMEHOW MATCHED. Cheap assertion, catastrophic if wrong:
   * a user delete cascades into 85 tables, so one mis-selected real account takes its whole
   * history with it.
   */
  const bad = users.filter((u) => !TEST_DOMAINS.some((d) => (u.email ?? '').toLowerCase().endsWith(d)))
  if (bad.length) {
    console.error(`\nABORTED: ${bad.length} selected account(s) are not test addresses:`)
    bad.forEach((u) => console.error(`  ${u.email}`))
    await prisma.$disconnect()
    process.exit(1)
  }

  if (APPLY) {
    const fs = await import('node:fs')
    const takenAtIso = new Date().toISOString()
    const snapPath = path.join(SCRIPT_DIR, `.fixture-data-snapshot-${takenAtIso.replace(/[:.]/g, '-')}.json`)
    // Full rows, so the deletion is reconstructable rather than merely logged.
    const [fullUsers, fullLeagues, fullPlayers] = await Promise.all([
      prisma.$queryRawUnsafe<unknown[]>(
        `SELECT * FROM "app_users" WHERE ${domainClause('email')} AND id NOT IN (${PROTECTED_USERS_SQL})`),
      prisma.$queryRawUnsafe<unknown[]>(
        `SELECT * FROM "leagues" WHERE id LIKE ANY($1::text[]) AND id NOT IN (${PROTECTED_LEAGUES_SQL})`, FIXTURE_ID_LIKES),
      prisma.$queryRawUnsafe<unknown[]>(
        `SELECT DISTINCT p.* FROM "Player" p, LATERAL jsonb_object_keys(p.provider_ids::jsonb) k
         WHERE p.provider_ids IS NOT NULL AND k LIKE $1`, SEED_PROVIDER_KEY_LIKE,
      ),
    ])
    fs.writeFileSync(
      snapPath,
      JSON.stringify({ takenAtIso, database: target[0].db, users: fullUsers, leagues: fullLeagues, players: fullPlayers }, null, 2),
      'utf8',
    )
    if (!fs.statSync(snapPath).size) {
      console.error('\nABORTED: snapshot is empty. Nothing deleted.')
      await prisma.$disconnect()
      process.exit(1)
    }
    console.log(`\nsnapshot written: ${snapPath}`)
  }

  // Tables that could be touched by the cascade — measured before and after inside the txn.
  const watched = await prisma.$queryRawUnsafe<Array<{ t: string }>>(
    `SELECT DISTINCT cl.relname AS t
     FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid
     JOIN pg_class rf ON rf.oid = con.confrelid
     WHERE con.contype = 'f' AND rf.relname IN ('app_users','leagues','rosters','Player')
     ORDER BY 1`,
  )
  const tables = ['app_users', 'leagues', 'Player', ...watched.map((r) => r.t)]
  const uniqueTables = [...new Set(tables)]

  const countAll = async (tx: typeof prisma): Promise<Record<string, number>> => {
    const out: Record<string, number> = {}
    for (const t of uniqueTables) {
      try {
        const r = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*)::int AS n FROM "${t}"`)
        out[t] = Number((r[0] as { n: number }).n)
      } catch {
        /* table may be unreadable/renamed — skip rather than abort the measurement */
      }
    }
    return out
  }

  let before: Record<string, number> = {}
  let after: Record<string, number> = {}
  let deleted = { claims: 0, leagues: 0, rostersReparented: 0, users: 0, players: 0 }

  await prisma
    .$transaction(
      async (tx) => {
        before = await countAll(tx as unknown as typeof prisma)

        // `LeagueManagerClaim` is the only FK on leagues that does not cascade — clear it first,
        // scoped strictly to the fixture leagues.
        deleted.claims = await tx.$executeRawUnsafe(
          `DELETE FROM "LeagueManagerClaim" WHERE "leagueId" IN (
             SELECT id FROM "leagues" WHERE id LIKE ANY($1::text[]) AND id NOT IN (${PROTECTED_LEAGUES_SQL}))`,
          FIXTURE_ID_LIKES,
        )
        deleted.leagues = await tx.$executeRawUnsafe(
          `DELETE FROM "leagues" WHERE id LIKE ANY($1::text[]) AND id NOT IN (${PROTECTED_LEAGUES_SQL})`,
          FIXTURE_ID_LIKES,
        )
        /*
         * ⚠ RE-PREFIX BEFORE DELETING THE USERS, NOT AFTER.
         * `rosters` has NO foreign key on `platformUserId` — only on `leagueId` — so deleting a
         * user does NOT cascade to their rosters in leagues that survive. Those rosters are then
         * left pointing at an id that no longer resolves, and this repo's `orphan-` convention is
         * load-bearing: at least six services branch on `startsWith('orphan-')`, including
         * InviteEngine (seat counts) and DraftNotificationService (who to notify). Un-prefixed,
         * such a roster is treated as having a live owner — it holds a seat and gets notified.
         *
         * The first apply left exactly one of these behind, in a league two real users are in.
         * Scoped to the users being deleted, so the 677 numeric SLEEPER ids in this column (a
         * different namespace, from imported leagues) are untouched.
         */
        deleted.rostersReparented = await tx.$executeRawUnsafe(
          `UPDATE "rosters" SET "platformUserId" = 'orphan-' || "platformUserId"
           WHERE "platformUserId" NOT LIKE 'orphan-%'
             AND "platformUserId" IN (
               SELECT id FROM "app_users"
               WHERE ${domainClause('email')} AND id NOT IN (${PROTECTED_USERS_SQL}))`,
        )

        deleted.users = await tx.$executeRawUnsafe(
          `DELETE FROM "app_users" WHERE ${domainClause('email')} AND id NOT IN (${PROTECTED_USERS_SQL})`,
        )
        // Player images/identities cascade via the FKs added in the 2026-08-17 migrations.
        deleted.players = await tx.$executeRawUnsafe(
          `DELETE FROM "Player" WHERE id IN (
             SELECT DISTINCT p.id FROM "Player" p, LATERAL jsonb_object_keys(p.provider_ids::jsonb) k
             WHERE p.provider_ids IS NOT NULL AND k LIKE $1)`,
          SEED_PROVIDER_KEY_LIKE,
        )

        after = await countAll(tx as unknown as typeof prisma)

        if (!APPLY) {
          // Force a rollback so the measurement costs nothing.
          throw new Error('__DRY_RUN_ROLLBACK__')
        }
      },
      { timeout: 900_000 },
    )
    .catch((e) => {
      if (e instanceof Error && e.message.includes('__DRY_RUN_ROLLBACK__')) return
      throw e
    })

  console.log('\n── direct deletes ──')
  console.table(deleted)

  const changed = uniqueTables
    .filter((t) => before[t] !== undefined && after[t] !== undefined && before[t] !== after[t])
    .map((t) => ({ table: t, before: before[t], after: after[t], removed: before[t] - after[t] }))
    .sort((a, b) => b.removed - a.removed)

  console.log(`\n── cascade blast radius: ${changed.length} tables affected ──`)
  console.table(changed)

  if (!APPLY) {
    console.log('\nROLLED BACK — nothing was written. The numbers above are exact, not estimates.')
    console.log('Re-run with --apply to snapshot and commit.')
    await prisma.$disconnect()
    return
  }

  // ⚠ POST-CONDITION, NOT A HOPE.
  const remaining = await prisma.$queryRawUnsafe<Array<{ u: number; l: number; p: number }>>(
    `SELECT
       (SELECT COUNT(*)::int FROM "app_users"
          WHERE ${domainClause('email')} AND id NOT IN (${PROTECTED_USERS_SQL})) AS u,
       (SELECT COUNT(*)::int FROM "leagues"
          WHERE id LIKE ANY($1::text[]) AND id NOT IN (${PROTECTED_LEAGUES_SQL})) AS l,
       (SELECT COUNT(*)::int FROM "Player" p WHERE p.provider_ids IS NOT NULL
          AND EXISTS (SELECT 1 FROM jsonb_object_keys(p.provider_ids::jsonb) k WHERE k LIKE $2)) AS p`,
    FIXTURE_ID_LIKES, SEED_PROVIDER_KEY_LIKE,
  )
  const r = remaining[0]
  console.log(`\nremaining fixtures — users: ${r.u}  leagues: ${r.l}  players: ${r.p} (all must be 0)`)
  if (r.u !== 0 || r.l !== 0 || r.p !== 0) {
    console.error('POST-CONDITION FAILED — fixtures remain. Investigate before trusting this.')
    process.exitCode = 1
  }

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
