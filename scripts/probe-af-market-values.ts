/**
 * AllFantasy market values from completed trades. READ-ONLY.
 *
 *   npx tsx scripts/probe-af-market-values.ts --since 2024
 *   npx tsx scripts/probe-af-market-values.ts 2024        # bare year also accepted
 *
 * ⚠ THE CENTRING CHECK IS THE POINT, NOT THE PLAYER LIST. Trades are zero-sum: whatever one
 * side pays above chart, the other receives above chart. So the population of adjustments MUST
 * centre near zero. If the median comes out strongly positive, the estimator is biased and the
 * output is an artefact — the same failure the manager-tendency work hit when it averaged trade
 * ratios arithmetically and concluded 224 of 285 managers overpay.
 *
 * 🛑 THIS SCRIPT ONCE REPORTED PASS ON A POPULATION NOBODY ASKED FOR. It parsed
 * `Number(process.argv[2]) || 2024`, so `--since 2025` made `argv[2]` the string `"--since"`
 * and it silently measured 2024 instead — reporting `PASS median +0.2%` in the same minute the
 * writer reported `FAIL median +1.8%` for the season actually requested. The season window and
 * the tolerance now both come from `lib/trade-market/sinceSeasonArg`, shared with the writer,
 * so this tool cannot answer a different question from the one it exists to diagnose.
 */
import { PrismaClient } from '@prisma/client'

import {
  computeCompletedTradeValue,
  gatherCompletedTradeObservations,
  tierBaselines,
} from '../lib/trade-market/completedTradeObservations'
import { isCentred, parseSinceSeason } from '../lib/trade-market/sinceSeasonArg'

const prisma = new PrismaClient()

async function main() {
  const sinceSeason = parseSinceSeason(process.argv.slice(2), 2024)
  console.log(`since season:                ${sinceSeason ?? '(all)'}`)
  const gathered = await gatherCompletedTradeObservations({ prisma: prisma as never, sinceSeason })
  console.log(`trades considered (deduped): ${gathered.tradesConsidered}`)
  console.log(`trades used:                 ${gathered.tradesUsed}`)
  console.log(`skipped: ${JSON.stringify(gathered.skipped)}`)
  console.log(`players with observations:   ${gathered.byPlayer.size}`)

  const baselineFor = tierBaselines(gathered)
  const values = [...gathered.byPlayer.entries()].map(([playerId, e]) =>
    computeCompletedTradeValue({
      playerId,
      playerName: e.name,
      position: e.position,
      baseValue: e.baseValue,
      observations: e.observations,
      tierBaselineRatio: baselineFor(e.baseValue),
    }),
  )
  const published = values.filter((v) => v.published)
  console.log(`\npublished: ${published.length} of ${values.length}`)

  const adj = published.map((v) => v.adjustmentPercent).sort((a, b) => a - b)
  if (adj.length > 0) {
    const q = (f: number) => adj[Math.floor(f * (adj.length - 1))]!
    console.log(`adjustment %: median ${q(0.5).toFixed(1)}  IQR ${q(0.25).toFixed(1)}..${q(0.75).toFixed(1)}  range ${adj[0]!.toFixed(1)}..${adj[adj.length - 1]!.toFixed(1)}`)
    const dir = published.reduce<Record<string, number>>((a, v) => ((a[v.direction] = (a[v.direction] ?? 0) + 1), a), {})
    console.log(`direction: ${JSON.stringify(dir)}`)
    const centred = isCentred(q(0.5))
    console.log(`\nZERO-SUM CHECK: ${centred ? 'PASS' : 'FAIL'} — median ${q(0.5).toFixed(1)}% (must sit near 0)`)
  }

  const byMove = [...published].sort((a, b) => b.adjustmentPercent - a.adjustmentPercent)
  console.log('\nbiggest risers:')
  for (const v of byMove.slice(0, 5)) {
    console.log(`  ${String(v.playerName).padEnd(22)} ${String(v.position).padEnd(4)} ${v.baseValue} -> ${v.marketValue} (${v.adjustmentPercent > 0 ? '+' : ''}${v.adjustmentPercent}%, n=${v.sampleSize}, conf ${v.confidence})`)
  }
  console.log('biggest fallers:')
  for (const v of byMove.slice(-5).reverse()) {
    console.log(`  ${String(v.playerName).padEnd(22)} ${String(v.position).padEnd(4)} ${v.baseValue} -> ${v.marketValue} (${v.adjustmentPercent}%, n=${v.sampleSize}, conf ${v.confidence})`)
  }
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
