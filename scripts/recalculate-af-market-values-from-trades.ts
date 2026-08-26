/**
 * AllFantasy market values from COMPLETED trades. DRY-RUN BY DEFAULT.
 *
 *   npx tsx scripts/recalculate-af-market-values-from-trades.ts            # dry-run
 *   npx tsx scripts/recalculate-af-market-values-from-trades.ts --write    # persist
 *
 * Writes ONLY `AllFantasyMarketPlayerValue` + its audit table. Never touches provider,
 * projection, ADP or snapshot data, and calls no external API.
 *
 * ⚠ THE CENTRING CHECK GATES THE WRITE. Trades are zero-sum, so the population of adjustments
 * must sit near 0. If it does not, the estimator is biased and the output is an artefact rather
 * than a market — this refuses to persist instead of publishing 205 players as "falling" because
 * of the shape of a ratio distribution. See `probe-af-market-values.ts` for the diagnosis.
 */
import { PrismaClient } from '@prisma/client'

import { recalculateFromCompletedTrades } from '../lib/trade-market/completedTradeObservations'

const prisma = new PrismaClient()

/** How far the population median may sit from zero before we refuse to write. */
const CENTRING_TOLERANCE = 1.5

async function main() {
  const write = process.argv.includes('--write')
  const sinceArg = Number(process.argv[process.argv.indexOf('--since') + 1])
  const sinceSeason = Number.isFinite(sinceArg) && sinceArg > 2000 ? sinceArg : undefined

  // Always evaluate dry first, so the gate is checked against the same numbers we would write.
  const dry = await recalculateFromCompletedTrades(prisma, { sinceSeason, dryRun: true })
  console.log(JSON.stringify({ mode: 'DRY-RUN', ...dry }, null, 2))

  const median = dry.medianAdjustment
  const centred = median != null && Math.abs(median) <= CENTRING_TOLERANCE
  console.log(
    `\nZERO-SUM CHECK: ${centred ? 'PASS' : 'FAIL'} — median adjustment ${median?.toFixed(1) ?? 'n/a'}%`,
  )

  if (!write) {
    console.log('\nDry-run only — no rows written. Re-run with --write to persist.')
    return
  }
  if (!centred) {
    console.error('\nREFUSING TO WRITE: the adjustment population is not centred on zero.')
    process.exitCode = 1
    return
  }

  const res = await recalculateFromCompletedTrades(prisma, { sinceSeason, dryRun: false })
  console.log(`\n${JSON.stringify({ mode: 'WRITE', ...res }, null, 2)}`)
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
