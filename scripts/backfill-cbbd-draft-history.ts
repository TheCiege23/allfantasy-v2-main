/**
 * Backfill the NBA draft history from CollegeBasketballData into `cbbd:draft-history:v1:<year>`
 * (contracts/cbbd/GAPS.md B-03). Ingestion, run by hand: one call per draft year not already stored.
 *
 * ⚠ THE QUOTA IS CFBD FOOTBALL'S. Same key, same month. The run stops at the shared background reserve
 * (CFBD_BACKGROUND_RESERVE, default 15,000 calls left) and paces its calls. Default range 2010 through the
 * newest draft whose window has closed — 16 calls on 2026-11-28; a re-run makes none.
 *
 * ⚠ IT WRITES TO WHATEVER DATABASE `DATABASE_URL` NAMES. Run it under `railway run` against the intended
 * service, or with a `.env` you have checked. `--dry-run` reads the stored rows and makes no CBBD call.
 *
 * The key is read by lib/cfbd-env.ts (CFBD_API_KEY / CFBD_KEY / COLLEGE_FOOTBALL_DATA_API_KEY), sent only as a
 * header, and never printed: this script prints counts and failure kinds, never a URL with a key or the key.
 *
 * Usage:
 *   node --require ./scripts/_audit-preload.cjs --import tsx scripts/backfill-cbbd-draft-history.ts [--from=2010] [--to=2025] [--delay-ms=2000] [--dry-run]
 */
import { hasCfbdApiKey } from '../lib/cfbd-env'
import {
  backfillCbbdDraftHistory,
  DEFAULT_BACKFILL_DELAY_MS,
  DEFAULT_BACKFILL_FROM,
  lastFinalDraftYear,
} from '../lib/devy/cbbdDraftHistoryIngest'

function intArg(name: string): number | undefined {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
  if (raw == null) return undefined
  const n = Number(raw)
  if (!Number.isInteger(n)) throw new Error(`--${name} must be a whole number`)
  return n
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const now = new Date()
  const from = intArg('from') ?? DEFAULT_BACKFILL_FROM
  const to = intArg('to') ?? lastFinalDraftYear(now)
  const delayMs = intArg('delay-ms') ?? DEFAULT_BACKFILL_DELAY_MS
  if (!dryRun && !hasCfbdApiKey()) throw new Error('No CFBD/CBBD key in CFBD_API_KEY, CFBD_KEY or COLLEGE_FOOTBALL_DATA_API_KEY.')

  console.log(`NBA draft history ${from}-${to}${dryRun ? ' (dry run: no CBBD calls)' : `, ${delayMs} ms between calls`}`)
  const result = await backfillCbbdDraftHistory({ from, to, now, delayMs, dryRun })
  for (const y of result.years) {
    if (y.status === 'stored') console.log(`  ${y.year}  stored   ${y.picks} picks, ${y.college} college, ${y.collegeWithAthleteId} with a CBBD athlete id`)
    else console.log(`  ${y.year}  ${y.status.padEnd(8)} ${y.reason}`)
  }
  console.log(`CBBD calls made: ${result.calls}`)
  if (result.stoppedEarly) {
    console.log(`STOPPED EARLY: ${result.stoppedEarly}. Rows already written stand; re-run to continue.`)
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error(`draft history backfill failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
  .finally(async () => {
    const { prisma } = await import('../lib/prisma')
    await prisma.$disconnect().catch(() => undefined)
  })
