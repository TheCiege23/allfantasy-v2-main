/**
 * Backfill `trade_value_audits` for completed trades that settled before the audit existed.
 *
 *   npx tsx scripts/backfill-trade-value-audits.ts --league=<id>          # dry run: prints what it would write
 *   npx tsx scripts/backfill-trade-value-audits.ts --league=<id> --write  # writes
 *   npx tsx scripts/backfill-trade-value-audits.ts --all --write --limit=50
 *
 * ⚠ AN OLD TRADE IS PRICED TODAY AND LABELLED SO. No trade-time value on one scale exists for most of
 * these trades, so each row is written with `basis: first_audited` (auditRowFromReview decides from the
 * trade's own completion date), and the review prints "priced when first audited" beside it. It is
 * never passed off as the value on the day of the trade.
 *
 * Write-once: a trade that already has an audit row is skipped by the insert itself.
 * Requires migration 20261107130000_trade_value_audits; refuses to run without it.
 */
import { prisma } from '@/lib/prisma'
import { reviewStoredTrade } from '@/lib/decision-os/trade/tradeReviewContext'
import type { TradeRef } from '@/lib/decision-os/trade/tradeRecord'
import { auditRowFromReview, recordTradeValueAudit, tradeValueAuditsReady } from '@/lib/integrity/tradeValueAudit'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const flag = (name: string) => process.argv.includes(`--${name}`)

async function tradesFor(leagueId: string): Promise<TradeRef[]> {
  const [native, redraft, imported] = await Promise.all([
    prisma.afLeagueTrade.findMany({ where: { leagueId, status: 'processed' }, select: { id: true } }),
    prisma.redraftTradeProposal.findMany({ where: { leagueId, status: 'accepted' }, select: { id: true } }),
    prisma.providerTradeOffer.findMany({ where: { leagueId, provider: 'sleeper', status: 'accepted' }, select: { providerTradeId: true } }),
  ])
  return [
    ...native.map((t) => ({ kind: 'af' as const, tradeId: t.id })),
    ...redraft.map((t) => ({ kind: 'redraft' as const, proposalId: t.id })),
    ...imported.map((t) => ({ kind: 'provider' as const, provider: 'sleeper' as const, providerTradeId: t.providerTradeId })),
  ]
}

async function main() {
  const write = flag('write')
  if (!(await tradeValueAuditsReady())) {
    console.error('trade_value_audits is absent — apply migration 20261107130000_trade_value_audits first.')
    process.exit(1)
  }
  const league = arg('league')
  if (!league && !flag('all')) {
    console.error('Pass --league=<id> or --all.')
    process.exit(1)
  }
  const limit = Number(arg('limit') ?? 25)
  const leagues = league
    ? [{ id: league }]
    : await prisma.leagueIntegritySettings.findMany({ select: { leagueId: true }, take: limit }).then((r) => r.map((x) => ({ id: x.leagueId })))

  let written = 0
  let skipped = 0
  for (const { id: leagueId } of leagues) {
    const owner = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } })
    if (!owner?.userId) continue
    for (const ref of await tradesFor(leagueId)) {
      const r = await reviewStoredTrade({ leagueId, ref, userId: owner.userId, surface: 'trade-audit-backfill' }).catch(() => null)
      const row = r ? auditRowFromReview(r, ref, new Date()) : null
      if (!row) {
        skipped += 1
        continue
      }
      console.log(`${write ? 'write' : 'would write'} ${leagueId} ${row.tradeKey} ${row.sideAName}↔${row.sideBName} gap ${row.gapPct.toFixed(1)}% (${row.basis})`)
      if (write) await recordTradeValueAudit(leagueId, row)
      written += 1
    }
  }
  console.log(`${write ? 'written' : 'would write'}: ${written}, skipped (ungradable or not complete): ${skipped}`)
  await prisma.$disconnect()
}

main().catch(async (error) => {
  console.error(error)
  await prisma.$disconnect()
  process.exit(1)
})
