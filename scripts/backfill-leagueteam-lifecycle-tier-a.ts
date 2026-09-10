/**
 * Classify `league_teams` on the lifecycle and manager axes — TIER A ONLY. DRY-RUN BY DEFAULT.
 *
 *   npx tsx scripts/backfill-leagueteam-lifecycle-tier-a.ts                        # dry run
 *   npx tsx scripts/backfill-leagueteam-lifecycle-tier-a.ts --apply --endpoint=<id>
 *
 * Companion to migration `20260910140000_leagueteam_lifecycle_manager_axes`, which adds the
 * columns with `@default(UNKNOWN)`. That default is deliberate and this script does NOT retire
 * it: it classifies only the rows whose state is provable from a writer signature, and leaves
 * everything else UNKNOWN.
 *
 * ── WHY ONLY TIER A ─────────────────────────────────────────────────────────────────────────
 *
 * A read-only production audit on 2026-09-10 (3,419 rows / 259 leagues) split the population by
 * the evidence available for each row. Four buckets map onto exactly one writer signature and
 * cannot mean anything else. One large bucket does not:
 *
 *   ⚠ NOT DONE HERE — 2,659 rows (77.8%) whose only evidence is `isOrphan = false` plus a
 *   present `platformUserId`. That rule infers occupancy from the ABSENCE of a flag, which is
 *   the exact reasoning that produced this whole correction. Worse, `isOrphan = false` is also
 *   the column DEFAULT, so a row no writer ever classified is indistinguishable from one a
 *   writer positively marked as managed. And it assumes no provider seat is bot-managed — true
 *   for Sleeper, unverified for ESPN, Fantrax and Fleaflicker, which hold part of that bucket.
 *   Those rows stay UNKNOWN until someone measures the manager axis directly.
 *
 * 🛑 AND `isOrphan` IS NOT READ AS EVIDENCE OF DEPARTURE ANYWHERE BELOW. The same audit found
 * that of the 147 rows carrying `isOrphan = true` in production, ZERO are departures: 80 are
 * canonical open slots, 66 are Sleeper seats the provider lists with no manager, and 1 is a
 * claimed seat with a stale flag. A blanket `isOrphan -> ARCHIVED` backfill would have archived
 * 147 live franchises and nothing else. Nothing here writes ARCHIVED at all.
 *
 * ── THE FOUR BUCKETS ────────────────────────────────────────────────────────────────────────
 *
 *   1  claimed on AllFantasy          CURRENT / HUMAN    354   a real user holds the seat
 *   2  canonical open slot            CURRENT / VACANT    80   `open-slot-` prefix, one writer
 *   3  provider lists no manager      CURRENT / VACANT    66   `role='orphan'` + null manager id
 *   4  commissioner seat              CURRENT / HUMAN    259   provider-asserted commissioner
 *
 * ⚠ BUCKET 4 IS THE WEAKEST OF THE FOUR AND IS DELIBERATELY ITS OWN STATEMENT so a reviewer who
 * disagrees can drop it without touching the rest. Its three concordant signals — the provider
 * marked the seat commissioner, a provider manager id is present, and the row is not flagged —
 * are stronger than the Tier B rule, because `role='commissioner'` is positively asserted by the
 * provider rather than inferred from an absence. A Sleeper commissioner is a person. If that
 * reasoning does not satisfy you, delete statement 4; the other three stand alone.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────────────────────
 *
 * 🛑 THE GUARD IS A POSITIVE ALLOWLIST, per `lib/db/databaseEndpoint`. `--apply` requires
 * `--endpoint=<id>` matching the live connection. Never a "not production" test — an inverted
 * host-substring guard points AT production, and this repo has shipped one.
 *
 * Every statement carries `WHERE "lifecycleState" = 'UNKNOWN'`, which does three jobs: it makes
 * the script idempotent, it guarantees a re-run touches nothing, and it means the script can
 * never overwrite a value a real writer has since set. The predicates are also mutually
 * exclusive by construction, so the result does not depend on statement order.
 *
 * Raw SQL on purpose: the generated Prisma client will not know these columns until
 * `prisma generate` is re-run after the migration, and a backfill that cannot run until the
 * client is regenerated is a backfill that gets run with a stale client.
 */
import { PrismaClient, Prisma } from '@prisma/client'

import { endpointFromDatabaseUrl, endpointMatches } from '../lib/db/databaseEndpoint'

const prisma = new PrismaClient()

interface Bucket {
  key: string
  what: string
  lifecycle: 'CURRENT'
  manager: 'HUMAN' | 'VACANT'
  /** Self-contained and mutually exclusive with every other bucket. */
  predicate: Prisma.Sql
  /** What the 2026-09-10 production audit measured, for a drift check. */
  auditCount: number
}

const BUCKETS: Bucket[] = [
  {
    key: 'claimed',
    what: 'claimed on AllFantasy — a real user holds the seat',
    lifecycle: 'CURRENT',
    manager: 'HUMAN',
    predicate: Prisma.sql`"claimedByUserId" IS NOT NULL`,
    auditCount: 354,
  },
  {
    key: 'open_slot',
    what: 'canonical open slot — createCanonicalLeagueInTransaction',
    lifecycle: 'CURRENT',
    manager: 'VACANT',
    predicate: Prisma.sql`"claimedByUserId" IS NULL AND "platformUserId" LIKE 'open-slot-%'`,
    auditCount: 80,
  },
  {
    key: 'provider_vacant',
    what: 'provider lists the seat with no manager — Sleeper importer',
    lifecycle: 'CURRENT',
    manager: 'VACANT',
    predicate: Prisma.sql`"claimedByUserId" IS NULL AND "role" = 'orphan' AND "platformUserId" IS NULL`,
    auditCount: 66,
  },
  {
    key: 'commissioner',
    what: 'commissioner seat asserted by the provider (weakest of the four — droppable)',
    lifecycle: 'CURRENT',
    manager: 'HUMAN',
    predicate: Prisma.sql`"claimedByUserId" IS NULL AND "role" IN ('commissioner','co_commissioner') AND NOT "isOrphan" AND "platformUserId" IS NOT NULL`,
    auditCount: 259,
  },
]

async function columnsExist(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM information_schema.columns
    WHERE table_name = 'league_teams'
      AND column_name IN ('lifecycleState','managerKind','archivedAt','archiveReason','eliminatedAt')`
  return Number(rows[0]?.n ?? 0) === 5
}

async function countMatching(p: Prisma.Sql): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>(
    Prisma.sql`SELECT count(*)::bigint AS n FROM league_teams WHERE "lifecycleState" = 'UNKNOWN' AND (${p})`,
  )
  return Number(rows[0]?.n ?? 0)
}

async function stateCounts() {
  const rows = await prisma.$queryRaw<Array<{ lifecycle: string; manager: string; n: bigint }>>`
    SELECT "lifecycleState"::text AS lifecycle, "managerKind"::text AS manager, count(*)::bigint AS n
    FROM league_teams GROUP BY 1,2 ORDER BY n DESC`
  return rows.map((r) => ({ lifecycle: r.lifecycle, manager: r.manager, rows: Number(r.n) }))
}

async function main() {
  const apply = process.argv.includes('--apply')
  const url = process.env.DATABASE_URL
  const endpoint = endpointFromDatabaseUrl(url)
  const want = (process.argv.find((a) => a.startsWith('--endpoint=')) ?? '').split('=')[1] ?? ''

  console.log(`  endpoint: ${endpoint ?? '(unresolved)'}`)
  console.log(`  mode:     ${apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)

  if (apply && !endpointMatches(url, want)) {
    console.error(
      `\n  REFUSING — --apply requires --endpoint=${endpoint ?? '<id>'} to confirm you mean this database`,
    )
    process.exitCode = 1
    return
  }

  if (!(await columnsExist())) {
    console.error(
      '\n  REFUSING — the lifecycle columns are absent. Apply migration' +
        ' 20260910140000_leagueteam_lifecycle_manager_axes first.',
    )
    process.exitCode = 1
    return
  }

  const total = Number(
    (await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM league_teams`)[0]?.n ?? 0,
  )
  console.log(`  rows:     ${total}\n`)

  let planned = 0
  const drift: string[] = []
  for (const b of BUCKETS) {
    const n = await countMatching(b.predicate)
    planned += n
    const flag = n === b.auditCount ? '' : `   <-- DRIFT (audit measured ${b.auditCount})`
    console.log(`  ${b.key.padEnd(16)} ${String(n).padStart(5)} -> ${b.lifecycle}/${b.manager}${flag}`)
    console.log(`    ${b.what}`)
    if (n !== b.auditCount) drift.push(`${b.key}: ${n} vs ${b.auditCount}`)
  }

  /*
   * 🛑 THE REMAINDER IS ARITHMETIC, NOT A FIFTH SQL PREDICATE, AND THAT IS LOAD-BEARING.
   *
   * The obvious "improvement" is one statement counting `NOT (b1 OR b2 OR b3 OR b4)`. It is
   * wrong, and wrong quietly. `"platformUserId" LIKE 'open-slot-%'` yields NULL — not false —
   * when the column is NULL, which is true of 67 production rows. `NOT (false OR NULL)` is NULL,
   * and `FILTER (WHERE NULL)` drops the row from the count, so the consolidated form reported
   * 2,659 where the four buckets plus the remainder say 2,660. It was caught only because those
   * two numbers disagreed by one.
   *
   * Counting each bucket separately is immune: a predicate that evaluates to NULL simply fails
   * to match, which is the correct outcome — an unclassifiable row is exactly what should not be
   * classified. Keep the subtraction.
   */
  const untouched = total - planned
  console.log(`\n  TOTAL to classify: ${planned}`)
  console.log(`  left UNKNOWN:      ${untouched}   (Tier B + unclassifiable — deliberate)`)

  /*
   * ⚠ DRIFT IS REPORTED, NOT ENFORCED. The population moves — leagues are created and claimed
   * every day — so a count differing from the audit is expected over time and is NOT a reason to
   * refuse. It IS a reason to look: a bucket that has moved by an order of magnitude means a
   * writer changed behaviour, and re-reading the audit is cheaper than reasoning about why.
   */
  if (drift.length > 0) {
    console.log(`\n  NOTE — counts differ from the 2026-09-10 audit: ${drift.join(', ')}`)
    console.log('  Expected as the population grows. Re-read the audit if a bucket moved sharply.')
  }

  if (!apply) {
    console.log('\n  DRY RUN — nothing written. Re-run with --apply --endpoint=<id> to classify.')
    return
  }

  let written = 0
  for (const b of BUCKETS) {
    const n = await prisma.$executeRaw(
      Prisma.sql`UPDATE league_teams
                 SET "lifecycleState" = ${b.lifecycle}::"LeagueTeamLifecycleState",
                     "managerKind"    = ${b.manager}::"LeagueTeamManagerKind"
                 WHERE "lifecycleState" = 'UNKNOWN' AND (${b.predicate})`,
    )
    written += n
    console.log(`  applied ${b.key.padEnd(16)} ${n}`)
  }

  console.log(`\n  WROTE ${written} rows.`)
  console.log('\n  resulting state distribution:')
  for (const r of await stateCounts()) {
    console.log(`    ${r.lifecycle.padEnd(9)} / ${r.manager.padEnd(7)} ${String(r.rows).padStart(5)}`)
  }

  /*
   * 🛑 NOTHING HERE MAY PRODUCE AN ARCHIVED ROW. The audit found zero departures in the whole
   * population, and no bucket above writes ARCHIVED — so if one exists afterwards, either a real
   * writer created it (fine) or this script did (a defect). Say so rather than assume.
   */
  const archived = Number(
    (
      await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM league_teams WHERE "lifecycleState" = 'ARCHIVED'`
    )[0]?.n ?? 0,
  )
  console.log(`\n  ARCHIVED rows: ${archived}   (this script writes none; any are a writer's doing)`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
