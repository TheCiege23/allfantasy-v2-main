/**
 * AllFantasy market values from COMPLETED trades. DRY-RUN BY DEFAULT.
 *
 *   npx tsx scripts/recalculate-af-market-values-from-trades.ts                          # dry-run
 *   npx tsx scripts/recalculate-af-market-values-from-trades.ts --since 2024 \
 *       --write --endpoint=<id>                                                          # persist
 *
 * The dry run prints the `<id>` your connection resolves to, so there is deliberately no real
 * endpoint written here — a usage line naming production is a copy-pasteable production write.
 *
 * Writes ONLY `AllFantasyMarketPlayerValue` + its audit table. Never touches provider,
 * projection, ADP or snapshot data, and calls no external API.
 *
 * 🛑 `--write` REQUIRES `--endpoint=<id>` NAMING THE DATABASE YOU MEAN. This is a POSITIVE
 * allowlist, not a "not production" test — an inverted host-substring guard points at prod, and
 * this repo has shipped one. It matters more here than it looks: `@prisma/client` populates
 * `DATABASE_URL` from `.env` on import, and `.env` points at production, so this script has
 * always written to prod by default with nothing naming it. It ran on 2026-09-06 for that reason
 * and was correct only because the operator had checked by hand.
 *
 * ⚠ THE CENTRING CHECK GATES THE WRITE. Trades are zero-sum, so the population of adjustments
 * must sit near 0. If it does not, the estimator is biased and the output is an artefact rather
 * than a market — this refuses to persist instead of publishing 205 players as "falling" because
 * of the shape of a ratio distribution. See `probe-af-market-values.ts` for the diagnosis.
 *
 * ⚠ AND THE GATE IS NOW EVALUATED INSIDE THE RUN THAT WRITES. It used to call
 * `recalculateFromCompletedTrades` TWICE — once dry to read the median, once live to persist —
 * which are two computations over a table the Sleeper sync appends to every ten minutes. A trade
 * landing between them was written having been gated on a population that no longer existed.
 * `requireCentred` makes it one gather, one median, and a write that is unreachable unless that
 * median passes.
 */
import { PrismaClient } from '@prisma/client'

import { endpointFromDatabaseUrl, endpointMatches } from '../lib/db/databaseEndpoint'
import { recalculateFromCompletedTrades } from '../lib/trade-market/completedTradeObservations'
import { isCentred, parseSinceSeason } from '../lib/trade-market/sinceSeasonArg'

const prisma = new PrismaClient()

async function main() {
  const write = process.argv.includes('--write')
  /*
   * ⚠ THE PARSER AND THE TOLERANCE ARE SHARED WITH `probe-af-market-values.ts` ON PURPOSE.
   * They used to be two copies, and the copies disagreed: the probe silently measured 2024
   * when handed `--since 2025`, so it reported PASS on a population this script would refuse.
   * A diagnosis tool that can answer a different question is worse than none.
   */
  const sinceSeason = parseSinceSeason(process.argv.slice(2))

  /*
   * Read the URL Prisma will ACTUALLY use, not a file we guess at. `@prisma/client` runs its
   * dotenv load at import time, so by the time main() executes `process.env.DATABASE_URL` holds
   * the value the client is configured with — including the case where a human exported one,
   * which dotenv does not overwrite. Deriving it from `.env.local` by hand would describe a file
   * rather than the connection, and those differ: Prisma reads `.env`, Next.js reads `.env.local`.
   */
  const url = process.env.DATABASE_URL
  const endpoint = endpointFromDatabaseUrl(url)
  const wantEndpoint = (process.argv.find((a) => a.startsWith('--endpoint=')) ?? '').split('=')[1] ?? ''

  console.log(`  endpoint: ${endpoint ?? '(unresolved)'}`)
  console.log(`  mode:     ${write ? 'WRITE' : 'DRY RUN (no writes)'}`)
  console.log(`  since:    ${sinceSeason ?? '(all seasons)'}`)

  if (write && !endpointMatches(url, wantEndpoint)) {
    console.error(
      `\nREFUSING — --write requires --endpoint=${endpoint ?? '<id>'} to confirm you mean this database.` +
        (wantEndpoint ? `\nYou named "${wantEndpoint}"; the connection resolves to "${endpoint ?? '(unresolved)'}".` : ''),
    )
    process.exitCode = 1
    return
  }

  /*
   * ONE call. `dryRun` decides whether it may write; `requireCentred` decides whether it will.
   * Both are answered against the same gather, so the gate and the payload cannot disagree.
   */
  const dry = await recalculateFromCompletedTrades(prisma, {
    sinceSeason,
    dryRun: !write,
    requireCentred: true,
  })
  console.log(JSON.stringify({ mode: write ? 'WRITE' : 'DRY-RUN', ...dry }, null, 2))

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
  /*
   * ⚠ REPORT THE VERDICT THE RUN ACTUALLY REACHED, NOT A SECOND OPINION ABOUT IT. On a write this
   * reads `refused`, which is the flag that decided whether rows were stored — re-deriving it
   * here with `isCentred(median)` would be a second implementation of the gate, printed beside
   * the first, free to disagree with it. That is the exact defect the probe had.
   */
  const centred = write ? dry.refused === null : isCentred(median)
  console.log(
    `\nZERO-SUM CHECK: ${centred ? 'PASS' : 'FAIL'} — median adjustment ${median?.toFixed(1) ?? 'n/a'}%`,
  )

  if (!write) {
    console.log('\nDry-run only — no rows written. Re-run with --write --endpoint=<id> to persist.')
    return
  }
  if (dry.refused === 'not_centred') {
    console.error(
      `
REFUSING TO WRITE: ${dry.published} players would publish but their adjustments centre on ` +
        `${median?.toFixed(1)}%, not 0. Trades are zero-sum, so that is estimator bias, not a market.`,
    )
    process.exitCode = 1
    return
  }
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
