/**
 * Player values from FantasyCalc + DynastyProcess. Both free, both legal.
 *
 *   npx tsx scripts/ingest-player-values.ts
 *
 * ⚠ NO KEEPTRADECUT, NO REDDIT. KTC's terms forbid scraping and any use that
 * "competes with the Service"; taking their values from a Reddit repost changes
 * the retrieval path, not the rights. Reddit's own free tier is non-commercial
 * only. Both are excluded by decision, not by oversight.
 *
 * ⚠ SNAPSHOT, NEVER OVERWRITE. Each run appends a dated row so trend, volatility
 * and buy-low detection become derivable later. Values move slowly — one pull per
 * day per setting-combo is plenty, and hammering a free endpoint is how free
 * endpoints stop being free.
 *
 * The work now lives in `lib/player-values/ingestPlayerValues.ts` so the daily cron
 * can run the same code. Running this by hand on a day the cron already covered is a
 * no-op: captures are filed under the UTC day, and `skipDuplicates` does the rest.
 */
import { ingestPlayerValues } from '../lib/player-values/ingestPlayerValues'
import { prisma } from '../lib/prisma'

async function main() {
  const result = await ingestPlayerValues()

  for (const c of result.combos) {
    if (c.skipped) {
      console.log(`  ${c.format}/${c.qbFormat} -> ${c.skipped}, skipped`)
    } else {
      console.log(`  ${c.format}/${c.qbFormat}: ${c.fetched} rows, ${c.picksFiltered} picks filtered, ${c.stored} stored`)
    }
  }

  const stored = await prisma.playerValueSnapshot.count()
  const distinct = await prisma.playerValueSnapshot.findMany({
    distinct: ['sleeperId'],
    select: { sleeperId: true },
  })
  console.log(`\ncaptured as: ${result.capturedAt}`)
  console.log(`this run: ${result.stored} | table total: ${stored} | distinct players: ${distinct.length}`)

  // A partial run is reported as a failure so a wrapper cannot mistake it for success.
  process.exit(result.partial ? 1 : 0)
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
