/**
 * READ-ONLY report: how often the design's 60/40 letter disagrees with the one grade, over saved
 * trade evaluation receipts (`trade_decision_snapshots.evaluationReceipt -> designShadow`).
 *
 * 🛑 THIS REPO'S `.env` POINTS AT PRODUCTION. The script refuses to connect unless you name the host
 * you mean with `--db-host=<host or unique part of it>` and it matches `DATABASE_URL`'s host. Test it
 * on the Neon branch first, as the migration is.
 *
 * Usage:
 *   DATABASE_URL=<neon branch url> npx tsx scripts/report-trade-grade-shadow.ts --db-host=<branch host> [--days=30] [--json]
 *
 * It needs the `20260927000000_trade_decision_snapshot_evaluation_receipts` migration applied; without
 * it the column does not exist and the script says so.
 */
import { PrismaClient } from '@prisma/client'

import { tallyShadow, type ShadowRow } from '../lib/decision-os/trade/shadowReport'

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null
  } catch {
    return null
  }
}

async function main() {
  const wanted = arg('db-host')
  const host = hostOf(process.env.DATABASE_URL)
  if (!wanted || !host || !host.includes(wanted)) {
    console.error(
      `Refusing to connect: pass --db-host=<host> naming the database you mean (DATABASE_URL host is ${host ?? 'unset'}).`,
    )
    process.exit(2)
  }
  const days = Math.max(1, Number(arg('days') ?? 30) || 30)
  const prisma = new PrismaClient()
  try {
    const rows = await prisma.$queryRaw<Array<{ shadow: ShadowRow | null }>>`
      SELECT "evaluationReceipt"->'designShadow' AS shadow
      FROM "trade_decision_snapshots"
      WHERE "evaluationReceipt" IS NOT NULL
        AND "capturedAt" >= now() - (${days} || ' days')::interval`
    const tally = tallyShadow(rows.map((r) => r.shadow))
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ host, days, ...tally }, null, 2))
      return
    }
    console.log(`Trade grade shadow — ${host}, last ${days} days`)
    console.log(`  receipts:        ${tally.receipts}`)
    console.log(`  compared:        ${tally.compared}  (no comparison: ${tally.noComparison})`)
    console.log(`  agree / differ:  ${tally.agree} / ${tally.disagree}  → ${tally.agreementPct ?? '—'}% agreement`)
    console.log(`  two+ grades apart: ${tally.farApart}`)
    console.log('  current → design:')
    for (const [cur, row] of Object.entries(tally.matrix)) console.log(`    ${cur}: ${JSON.stringify(row)}`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (/evaluationReceipt/.test(msg)) console.error('The receipt column does not exist on this database — apply the receipt migration first.')
    else console.error('Report failed.')
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

void main()
