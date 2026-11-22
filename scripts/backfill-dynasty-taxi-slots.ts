/**
 * Give existing dynasty leagues the taxi squad size their settings already show.
 *
 * WHY. The taxi squad size has two stores (lib/taxi/taxiSlotsSync.ts): `DynastyLeagueConfig.taxiSlots`,
 * which the dynasty settings show, and `League.taxiSlots`, which lineup validation, the rollover
 * housekeeping and the rookie taxi placement read. League creation wrote only the config, so a
 * dynasty league created on AllFantasy showed a taxi squad (4 by default) and held 0 on the column:
 * no lineup save could put a player on the squad. Creation now writes both
 * (lib/league-creation/canonical/createCanonicalLeagueInTransaction.ts). This script is for the
 * leagues created before that.
 *
 * WHAT IT CHANGES, AND ONLY THIS
 *   - `League.taxiSlots`, from 0 to the config's size, where the config's size is above 0. That is
 *     the signature the creation bug left.
 *   - native leagues only (`NATIVE_PLATFORM_VALUES`): an imported league's roster shape is its
 *     provider's.
 *   - plain dynasty only. Devy and C2C leagues size their taxi squad on their own config.
 *   - never an archived league.
 *   - each write is guarded on the column still being 0, so a commissioner who saved a size while
 *     this ran is not overwritten.
 *
 * 🛑 WHAT IT ONLY REPORTS. A league whose two stores disagree any OTHER way (both above 0 and
 * different, or the column above 0 and the config at 0) is listed and left alone. Before 2026-11-15
 * each settings screen wrote one store, so in those leagues either number could be the one the
 * commissioner meant; re-saving the taxi size in dynasty settings writes both.
 *
 * ⚠ ONE CASE THIS CANNOT TELL APART. A commissioner who deliberately set the squad to 0 in the old
 * settings window, before the two stores were synced, left the same 0-and-N pair as the creation
 * bug. Their league would get the squad back. The dry run lists every league it would change, so
 * read the list before applying.
 *
 * ⚠ DRY RUN BY DEFAULT. Pass --apply to write. Writing to production also needs ALLOW_PROD_BACKFILL=1.
 *
 *     railway run npx tsx scripts/backfill-dynasty-taxi-slots.ts
 *     railway run npx tsx scripts/backfill-dynasty-taxi-slots.ts --apply     (with ALLOW_PROD_BACKFILL=1 set)
 *
 * It moves no players. Rookies already drafted stay where they are; managers can now move them.
 *
 * RE-RUNNABLE. A second run finds nothing left to change.
 */
import { prisma } from '../lib/prisma'
import { NATIVE_PLATFORM_VALUES } from '../lib/dashboard/platform-label'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { describeTarget, identifyTarget } = require('./db-target-identity.cjs') as {
  describeTarget: (url: string) => string
  identifyTarget: (url: string) => { kind: string }
}

/** Devy and C2C size their taxi squad on their own config (lib/taxi/TaxiSettingsService.ts). */
const OWN_TAXI_CONFIG_VARIANTS = new Set(['devy_dynasty', 'merged_devy_c2c', 'devy', 'c2c'])

export type TaxiRow = {
  id: string
  name: string | null
  sport: string | null
  leagueVariant: string | null
  lifecycleState: string | null
  /** `League.taxiSlots` */
  column: number | null
  /** `DynastyLeagueConfig.taxiSlots` */
  config: number | null
}
export type TaxiPlan = {
  /** Column 0, config above 0: set the column to the config. */
  fix: Array<TaxiRow & { next: number }>
  /** The two stores disagree some other way: listed, never written. */
  review: TaxiRow[]
}

/** PURE: what to change and what only to report. */
export function planDynastyTaxiBackfill(rows: readonly TaxiRow[]): TaxiPlan {
  const plan: TaxiPlan = { fix: [], review: [] }
  for (const row of rows) {
    if (String(row.lifecycleState ?? '').toLowerCase() === 'archived') continue
    if (OWN_TAXI_CONFIG_VARIANTS.has(String(row.leagueVariant ?? '').toLowerCase())) continue
    if (row.config == null || !Number.isInteger(row.config) || row.config < 0) continue
    const column = row.column ?? 0
    if (column === row.config) continue
    if (column === 0 && row.config > 0) plan.fix.push({ ...row, next: row.config })
    else plan.review.push(row)
  }
  return plan
}

async function main() {
  const apply = process.argv.includes('--apply')
  const url = process.env.DATABASE_URL ?? ''
  if (!url) throw new Error('DATABASE_URL is not set. Name the database to run against.')
  // Never the URL itself: it carries a password.
  console.log(`Target: ${describeTarget(url)}`)
  if (apply && identifyTarget(url).kind === 'production' && process.env.ALLOW_PROD_BACKFILL !== '1') {
    throw new Error('Refusing to write to PRODUCTION without ALLOW_PROD_BACKFILL=1.')
  }

  const leagues = await prisma.league.findMany({
    where: {
      platform: { in: [...NATIVE_PLATFORM_VALUES], mode: 'insensitive' },
      NOT: { lifecycleState: 'archived' },
      dynastyConfig: { isNot: null },
    },
    select: {
      id: true, name: true, sport: true, leagueVariant: true, lifecycleState: true, taxiSlots: true,
      dynastyConfig: { select: { taxiSlots: true } },
    },
    orderBy: { id: 'asc' },
  })
  const plan = planDynastyTaxiBackfill(
    leagues.map((l) => ({
      id: l.id, name: l.name, sport: l.sport ? String(l.sport) : null, leagueVariant: l.leagueVariant,
      lifecycleState: String(l.lifecycleState), column: l.taxiSlots, config: l.dynastyConfig?.taxiSlots ?? null,
    })),
  )
  console.log(`Native dynasty leagues read: ${leagues.length}. To fix: ${plan.fix.length}. Mismatched another way (left alone): ${plan.review.length}.`)

  if (plan.fix.length) console.log('\nWould set the league column from 0 to the size its settings show:')
  for (const r of plan.fix) console.log(`  ${r.id}  ${r.sport ?? ''}  0 -> ${r.next}  ${r.name ?? ''}`)
  if (plan.review.length) console.log('\nLeft alone. Re-save the taxi size in dynasty settings to make these agree:')
  for (const r of plan.review) console.log(`  ${r.id}  ${r.sport ?? ''}  league column ${r.column ?? 0}, dynasty settings ${r.config}  ${r.name ?? ''}`)

  if (!apply) {
    console.log('\nDry run: nothing was written. Pass --apply to write.')
    return
  }

  let written = 0
  let skipped = 0
  for (const r of plan.fix) {
    const res = await prisma.league.updateMany({ where: { id: r.id, taxiSlots: 0 }, data: { taxiSlots: r.next } })
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
