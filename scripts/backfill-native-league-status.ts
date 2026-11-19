/**
 * Bring `League.status` into step with the lifecycle for leagues that play on AllFantasy.
 *
 * WHY. A native league's `status` was written `setup` at creation and never moved, so readers that
 * ask `status ?? lifecycleState` saw a league in mid-season as pre-draft (lib/league/nativeLeagueStatus.ts).
 * New phase changes now write `status` with `lifecycleState`. This script is for the leagues that
 * were already past setup when that shipped: without it they keep the stale value until their next
 * phase change.
 *
 * 🛑 ONE DEFINITION OF THE MAPPING. The new value is `nativeLeagueStatusForLifecycle(lifecycleState)`,
 * the same function the live writes use, never a second copy in SQL.
 *
 * WHAT IT TOUCHES
 *   - native leagues only (`NATIVE_PLATFORM_VALUES`). An imported league's status is
 *     its provider's word and its sync owns it.
 *   - never an archived league: archiving does not touch `status`.
 *   - only `status`, only where it differs from what the lifecycle state carries.
 *   - never a league with NO status. 🛑 The first production run (2026-11-19) filled `in_season` into
 *     twelve of them: ten tournament division shells and two Survivor Exile Island shells, with no
 *     claimed team, no season and no real phase. Their `lifecycleState` read `in_season` only because
 *     that is the column's DEFAULT, so it described nothing. A league with no status already falls
 *     back to its lifecycle state in every reader that asks `status ?? lifecycleState`, so filling
 *     one in fixes nothing and can assert a phase that never happened. The stale value this script
 *     exists for is a status that was WRITTEN (`setup` at creation) and never moved.
 *   - each write is guarded on the status AND lifecycle state that were read, so a league that
 *     changed phase while this ran is skipped, not overwritten.
 *
 * ⚠ DRY RUN BY DEFAULT. It prints the target database, a count per (lifecycle, current → new) and
 * the first leagues of each group. Pass --apply to write.
 *
 *     npx tsx scripts/backfill-native-league-status.ts
 *     npx tsx scripts/backfill-native-league-status.ts --apply
 *
 * Against production it also needs ALLOW_PROD_BACKFILL=1, so a stray --apply in a shell that
 * happens to point at production does nothing:
 *
 *     railway run npx tsx scripts/backfill-native-league-status.ts
 *     railway run npx tsx scripts/backfill-native-league-status.ts --apply     (with ALLOW_PROD_BACKFILL=1 set)
 *
 * ⚠ ONE VISIBLE EFFECT. A league whose status becomes `in_season` starts getting automatic lineup
 * subs if it switched them on (lib/core-app/nativeAutoSubs.ts): that feature waited on this status.
 *
 * RE-RUNNABLE. A second run finds nothing left to change.
 */
import { prisma } from '../lib/prisma'
import { NATIVE_PLATFORM_VALUES } from '../lib/dashboard/platform-label'
import { nativeLeagueStatusForLifecycle } from '../lib/league/nativeLeagueStatus'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { describeTarget, identifyTarget } = require('./db-target-identity.cjs') as {
  describeTarget: (url: string) => string
  identifyTarget: (url: string) => { kind: string }
}

export type StatusRow = { id: string; name: string | null; status: string | null; lifecycleState: string | null }
export type StatusChange = StatusRow & { next: string }

/** PURE: the rows whose status differs from what their lifecycle state carries. */
export function planNativeStatusBackfill(rows: readonly StatusRow[]): StatusChange[] {
  const out: StatusChange[] = []
  for (const row of rows) {
    if (String(row.lifecycleState ?? '').toLowerCase() === 'archived') continue
    const next = nativeLeagueStatusForLifecycle(row.lifecycleState)
    if (!next || next === row.status) continue
    // No status on file: nothing stale to correct, and the lifecycle state may be the column default.
    if (row.status == null || row.status.trim() === '') continue
    out.push({ ...row, next })
  }
  return out
}

async function main() {
  const apply = process.argv.includes('--apply')
  const url = process.env.DATABASE_URL ?? ''
  if (!url) throw new Error('DATABASE_URL is not set. Name the database to run against.')
  // Never the URL itself: it carries a password.
  console.log(`Target: ${describeTarget(url)}`)
  const production = identifyTarget(url).kind === 'production'
  if (apply && production && process.env.ALLOW_PROD_BACKFILL !== '1') {
    throw new Error('Refusing to write to PRODUCTION without ALLOW_PROD_BACKFILL=1.')
  }

  const rows = await prisma.league.findMany({
    where: {
      platform: { in: [...NATIVE_PLATFORM_VALUES], mode: 'insensitive' },
      NOT: { lifecycleState: 'archived' },
    },
    select: { id: true, name: true, status: true, lifecycleState: true },
    orderBy: { id: 'asc' },
  })
  const changes = planNativeStatusBackfill(rows.map((r) => ({ ...r, lifecycleState: String(r.lifecycleState) })))
  console.log(`Native leagues read: ${rows.length}. Status to change: ${changes.length}.`)

  const groups = new Map<string, StatusChange[]>()
  for (const c of changes) {
    const key = `lifecycle ${c.lifecycleState}: status ${c.status ?? '(none)'} -> ${c.next}`
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  for (const [key, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${list.length}  ${key}`)
    for (const c of list.slice(0, 5)) console.log(`     ${c.id}  ${c.name ?? ''}`)
    if (list.length > 5) console.log(`     ... and ${list.length - 5} more`)
  }

  if (!apply) {
    console.log('\nDry run: nothing was written. Pass --apply to write.')
    return
  }

  let written = 0
  let skipped = 0
  for (const c of changes) {
    const res = await prisma.league.updateMany({
      where: { id: c.id, status: c.status, lifecycleState: c.lifecycleState as never },
      data: { status: c.next },
    })
    if (res.count === 1) written += 1
    else skipped += 1
  }
  console.log(`\nWritten: ${written}. Skipped because the league changed while this ran: ${skipped}.`)
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
