/**
 * READ-ONLY report: how many real trade proposals each candidate tanking line would flag, from saved
 * trade evaluation receipts (`trade_decision_snapshots.evaluationReceipt`). See
 * `lib/decision-os/trade/tankingCalibration.ts` for what is measured and why.
 *
 * 🛑 THIS REPO'S `.env` POINTS AT PRODUCTION. The script refuses to connect unless you name the host
 * you mean with `--db-host=<host or unique part of it>` and it matches `DATABASE_URL`'s host. It runs
 * one SELECT and writes nothing.
 *
 * Usage:
 *   DATABASE_URL=<url> npx tsx scripts/report-tanking-calibration.ts --db-host=<host> [--days=30] [--json]
 *
 * It needs the `20260927000000_trade_decision_snapshot_evaluation_receipts` migration applied, and
 * receipts saved after 2026-09-27 (older ones carry no `canonical.moves`). Until both, it reports zero
 * sides — which means "no data yet", not "no trade would trip it".
 */
import { PrismaClient } from '@prisma/client'

import type { TradeEvaluationReceipt } from '../lib/decision-os/trade/evaluateTrade'
import { tallyTankingCalibration, tankingSidesFromReceipt } from '../lib/decision-os/trade/tankingCalibration'

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
    // Only receipts that measured a lineup: those taken while a trade was pending, with rosters.
    const rows = await prisma.$queryRaw<Array<{ receipt: Pick<TradeEvaluationReceipt, 'assets' | 'canonical'> | null }>>`
      SELECT jsonb_build_object('assets', "evaluationReceipt"->'assets', 'canonical', "evaluationReceipt"->'canonical') AS receipt
      FROM "trade_decision_snapshots"
      WHERE "evaluationReceipt" IS NOT NULL
        AND "evaluationReceipt"->'canonical'->'moves' IS NOT NULL
        AND "capturedAt" >= now() - (${days} || ' days')::interval`
    const receipts = rows.flatMap((r) => (r.receipt ? [r.receipt] : []))
    const tally = tallyTankingCalibration(receipts.flatMap(tankingSidesFromReceipt))
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ host, days, receipts: receipts.length, ...tally }, null, 2))
      return
    }
    console.log(`Tanking calibration — ${host}, last ${days} days`)
    console.log(`  receipts with moves: ${receipts.length}`)
    console.log(`  sides measured:      ${tally.sides}   (receiving mostly bench value: ${tally.benchHeavy})`)
    for (const f of tally.flaggedAt) {
      console.log(`  line ${Math.round(f.dropShare * 100)}%${f.current ? ' (current)' : ''}: ${f.flagged} flagged  (${f.pctOfSides ?? '—'}% of sides)`)
    }
    const p = tally.dropPercentiles
    console.log(
      p
        ? `  drop share among bench-heavy sides: p50 ${(p.p50 * 100).toFixed(1)}%, p75 ${(p.p75 * 100).toFixed(1)}%, p90 ${(p.p90 * 100).toFixed(1)}%, p95 ${(p.p95 * 100).toFixed(1)}%`
        : '  no bench-heavy side lost lineup — nothing to place the line against yet',
    )
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
