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

  /*
   * ⚠ AN EMPTY RESULT IS NOT A FAILED CHECK, AND SAYING SO SENDS THE READER HUNTING. Run against
   * a database with no chart values, every trade is skipped, `medianAdjustment` is null and the
   * centring test is vacuously unsatisfied — reporting that as "the population is not centred"
   * blames the estimator for what is really a missing input. Found by running this against the
   * non-prod database, which holds 120 trades and zero `PlayerValueSnapshot` rows.
   */
  if (dry.published === 0) {
    const why =
      dry.tradesUsed === 0
        ? 'no trade could be priced — usually PlayerValueSnapshot is empty for the chosen format'
        : `${dry.tradesUsed} trades priced, but no player reached the sample threshold`
    console.log(`
NOTHING TO PUBLISH: ${why}.`)
    if (write) console.log('Nothing written — there is no value to write, which is not a failure.')
    return
  }

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
    console.error(
      `
REFUSING TO WRITE: ${dry.published} players would publish but their adjustments centre on ` +
        `${median?.toFixed(1)}%, not 0. Trades are zero-sum, so that is estimator bias, not a market.`,
    )
    process.exitCode = 1
    return
  }

  const res = await recalculateFromCompletedTrades(prisma, { sinceSeason, dryRun: false })
  console.log(`\n${JSON.stringify({ mode: 'WRITE', ...res }, null, 2)}`)
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
