/**
 * Fill `SportsPlayer.yearsExp` from Sleeper's player feed. READ-ONLY unless
 * `--write` is passed.
 *
 *   npx tsx scripts/backfill-player-years-exp.ts           # dry run, prints what it would do
 *   npx tsx scripts/backfill-player-years-exp.ts --write   # persists
 *
 * WHY A BACKFILL AND NOT A RE-SEED. `lib/sleeper/SleeperPlayerSeedService.ts`
 * writes this column now, but it has **no caller anywhere in the repo** — no
 * route, no cron, no script — so nothing is going to run it. And its shape is
 * `deleteMany` then `createMany`: re-seeding to pick up one column would delete
 * and recreate every Sleeper-sourced player row in production, which is a large
 * blast radius for a small fix. This touches one column on rows that already
 * exist and nothing else.
 *
 * ⚠ IT ONLY EVER FILLS A NULL. A row that already carries a figure is left
 * alone: if the value on file disagrees with Sleeper's, that disagreement is
 * information and this script has no standing to resolve it. Pass
 * `--overwrite` to take Sleeper's answer deliberately.
 *
 * ⚠ NULL IS NOT ZERO, IN EITHER DIRECTION. A player Sleeper has no `years_exp`
 * for is skipped rather than written as 0 — 0 means "has not played an NFL
 * snap" and would label him a rookie. The column stays null, which reads as
 * unknown everywhere it is consumed.
 *
 * ⚠ THIS TALKS TO PRODUCTION. `.env.local` in this repo IS the production
 * database. Run the dry run first and read the counts.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')
const OVERWRITE = process.argv.includes('--overwrite')

/** Matches the seed service's own parse: a non-finite value becomes null. */
function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

type SleeperPlayer = { player_id?: string; years_exp?: number | string | null }

async function main() {
  console.log(`mode: ${WRITE ? 'WRITE' : 'dry run'}${OVERWRITE ? ' + overwrite' : ''}`)

  /*
   * Allowed by path, not by exception: the DB-first guard allowlists
   * `scripts/*backfill*` because a backfill's whole job is reading the provider
   * and writing what it says. A `db-first-exception:` marker here would be a
   * misuse of a marker reserved for temporary violations on real request paths.
   */
  const res = await fetch('https://api.sleeper.app/v1/players/nfl')
  if (!res.ok) {
    console.error(`Sleeper returned ${res.status}. Nothing written.`)
    process.exit(1)
  }
  const feed = (await res.json()) as Record<string, SleeperPlayer>

  const expBySleeperId = new Map<string, number>()
  for (const [id, p] of Object.entries(feed ?? {})) {
    const v = toFiniteNumber(p?.years_exp)
    if (v == null || v < 0) continue
    expBySleeperId.set(String(p.player_id ?? id), v)
  }
  console.log(`feed: ${Object.keys(feed ?? {}).length} players, ${expBySleeperId.size} with years_exp`)

  const rows = await prisma.sportsPlayer.findMany({
    where: {
      sport: 'NFL',
      sleeperId: { not: null },
      ...(OVERWRITE ? {} : { yearsExp: null }),
    },
    select: { id: true, sleeperId: true, yearsExp: true },
  })
  console.log(`rows in scope: ${rows.length}`)

  let matched = 0
  let unchanged = 0
  let noFeedValue = 0
  const updates: Array<{ id: string; yearsExp: number }> = []

  for (const r of rows) {
    const v = r.sleeperId ? expBySleeperId.get(r.sleeperId) : undefined
    if (v == null) {
      noFeedValue += 1
      continue
    }
    matched += 1
    if (r.yearsExp === v) {
      unchanged += 1
      continue
    }
    updates.push({ id: r.id, yearsExp: v })
  }

  const rookies = updates.filter((u) => u.yearsExp === 0).length
  console.log(
    `matched ${matched}, already correct ${unchanged}, no figure on the feed ${noFeedValue}, ` +
      `to write ${updates.length} (of which ${rookies} rookies)`,
  )

  if (!WRITE) {
    console.log('dry run — nothing written. Re-run with --write to persist.')
    return
  }

  /*
   * One statement per row rather than a grouped updateMany per value: the
   * values are unbounded (0..20+) and a per-value updateMany would need the id
   * lists anyway. Batched so a long run can be interrupted without leaving a
   * single enormous transaction open.
   */
  let written = 0
  for (let i = 0; i < updates.length; i += 200) {
    const batch = updates.slice(i, i + 200)
    await prisma.$transaction(
      batch.map((u) =>
        prisma.sportsPlayer.update({ where: { id: u.id }, data: { yearsExp: u.yearsExp } }),
      ),
    )
    written += batch.length
    if (written % 2000 === 0) console.log(`  ${written}/${updates.length}`)
  }
  console.log(`wrote ${written}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
