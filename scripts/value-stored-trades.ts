/**
 * Backfill valuations onto stored trades.
 *
 *   npx tsx scripts/value-stored-trades.ts [--limit 500]
 *
 * The daily cron (`/api/cron/adp-refresh`) drains a bounded batch, which is right for
 * keeping up but slow for clearing a backlog. Run this once to work through history.
 *
 * ⚠ EXPECT A LARGE UNPRICEABLE COUNT, AND READ IT AS DATA. Trades are valued at the
 * date they happened, and the dated value series in `data/historical-values/` stops at
 * 2026-02-05. Anything after that has no price to look up until the daily
 * `PlayerValueSnapshot` capture has been running long enough to cover it. Unpriceable
 * rows are left untouched rather than marked analyzed with zeros — a zero would enter
 * manager tendencies as a real observation of an even trade.
 */
import { valueStoredTrades } from '../lib/trade-valuation/valueStoredTrades'
import { prisma } from '../lib/prisma'

async function main() {
  const arg = process.argv.indexOf('--limit')
  const limit = arg >= 0 ? Number(process.argv[arg + 1]) : 500

  const before = await prisma.leagueTrade.count({ where: { analyzed: true } })
  const result = await valueStoredTrades({ limit })
  const after = await prisma.leagueTrade.count({ where: { analyzed: true } })

  console.log(`considered:  ${result.considered}`)
  console.log(`valued:      ${result.valued}`)
  console.log(`unpriceable: ${result.unpriceable}`)
  console.log(`skipped:     ${result.skipped}`)
  console.log(`failed:      ${result.failed}`)
  if (Object.keys(result.reasons).length) {
    console.log('\nreasons:')
    for (const [r, n] of Object.entries(result.reasons).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}  ${r}`)
    }
  }
  console.log(`\nanalyzed total: ${before} -> ${after}`)

  const remaining = await prisma.leagueTrade.count({ where: { analyzed: false, valueGiven: null } })
  console.log(`still unvalued: ${remaining}`)
  process.exit(0)
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
