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
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const COMBOS = [
  { format: 'DYNASTY', qbFormat: 'SUPERFLEX', url: 'isDynasty=true&numQbs=2&numTeams=12&ppr=1' },
  { format: 'DYNASTY', qbFormat: 'ONE_QB', url: 'isDynasty=true&numQbs=1&numTeams=12&ppr=1' },
  { format: 'REDRAFT', qbFormat: 'SUPERFLEX', url: 'isDynasty=false&numQbs=2&numTeams=12&ppr=1' },
  { format: 'REDRAFT', qbFormat: 'ONE_QB', url: 'isDynasty=false&numQbs=1&numTeams=12&ppr=1' },
]

type FcRow = {
  player: { name: string; sleeperId?: string | null; position?: string | null }
  value: number
  overallRank?: number
  positionRank?: number
  trend30Day?: number
  maybeTradeFrequency?: number | null
  maybeMovingStandardDeviation?: number | null
}

async function main() {
  const capturedAt = new Date()
  let total = 0

  for (const combo of COMBOS) {
    const res = await fetch(`https://api.fantasycalc.com/values/current?${combo.url}`, {
      // Identify ourselves: if we ever cause a problem, they should be able to
      // email us rather than block us.
      headers: { 'User-Agent': 'AllFantasy/1.0 (allfantasysportsapp@gmail.com)' },
    })
    if (!res.ok) { console.log(`  ${combo.format}/${combo.qbFormat} -> HTTP ${res.status}, skipped`); continue }
    const rows = (await res.json()) as FcRow[]

    /*
     * ⚠ FILTER PICKS BEFORE ANY PLAYER JOIN. Draft picks come back as rows with
     * position "PICK" and non-numeric id tokens (DP_0_0, FP_2027_early_0). Joining
     * them against a player table produces silent garbage rather than an error.
     */
    const players = rows.filter((r) => r.player?.position !== 'PICK' && r.player?.sleeperId)

    const data = players.map((r) => ({
      // IDs are strings even when numeric-looking — cast explicitly.
      sleeperId: String(r.player.sleeperId),
      name: r.player.name,
      position: r.player.position ?? null,
      source: 'FANTASYCALC',
      format: combo.format,
      qbFormat: combo.qbFormat,
      value: Math.round(r.value),
      overallRank: r.overallRank ?? null,
      positionRank: r.positionRank ?? null,
      trend30d: r.trend30Day ?? null,
      // `maybe*` fields are nullable BY DESIGN — null means unknown, never zero.
      tradeFrequency: r.maybeTradeFrequency ?? null,
      marketStdDev: r.maybeMovingStandardDeviation ?? null,
      capturedAt,
    }))

    await prisma.playerValueSnapshot.createMany({ data, skipDuplicates: true })
    total += data.length
    console.log(`  ${combo.format}/${combo.qbFormat}: ${rows.length} rows, ${rows.length - players.length} picks filtered, ${data.length} stored`)
  }

  const stored = await prisma.playerValueSnapshot.count()
  const distinct = await prisma.playerValueSnapshot.findMany({ distinct: ['sleeperId'], select: { sleeperId: true } })
  console.log(`\nthis run: ${total} | table total: ${stored} | distinct players: ${distinct.length}`)
  process.exit(0)
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
