import 'server-only'

import { randomUUID } from 'node:crypto'

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import type { StoredTradeReview } from '@/lib/decision-os/trade/tradeReviewContext'
import type { TradeRef } from '@/lib/decision-os/trade/tradeRecord'

import type { AuditBasis, AuditRow } from './tradeAudit'

/**
 * The only module that touches `trade_value_audits` — every completed trade's value as priced when it
 * happened (see the model's comment in prisma/schema.prisma).
 *
 * WRITE-ONCE: `INSERT … ON CONFLICT DO NOTHING`. The first price recorded for a trade is the one every
 * later read gets; a re-scan never re-prices it on a later day's values.
 *
 * ⚠ SHIPS BEFORE ITS MIGRATION. Until `20261107130000_trade_value_audits` is applied the table is
 * absent: `tradeValueAuditsReady()` answers false, reads return `[]` and writes do nothing. Raw SQL on
 * purpose — the shared node_modules' generated client is whichever session last ran `prisma generate`
 * (lib/projections/futureWeekProjectionStore.ts says why).
 */

const RECHECK_MS = 10 * 60_000
let readyCache: { ready: boolean; at: number } | null = null

export async function tradeValueAuditsReady(now: number = Date.now()): Promise<boolean> {
  if (readyCache?.ready) return true
  if (readyCache && now - readyCache.at < RECHECK_MS) return false
  let ready = false
  try {
    const rows = await prisma.$queryRaw<Array<{ n: number | bigint }>>`
      SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'trade_value_audits'`
    ready = Number(rows[0]?.n ?? 0) === 1
  } catch {
    ready = false
  }
  readyCache = { ready, at: now }
  return ready
}

/** Test seam. */
export function resetTradeValueAuditsReadyCache(): void {
  readyCache = null
}

export function tradeKeyOf(ref: TradeRef): string {
  if (ref.kind === 'af') return `af:${ref.tradeId}`
  if (ref.kind === 'redraft') return `redraft:${ref.proposalId}`
  return `sleeper:${String(ref.providerTradeId).split(':').pop()!.trim()}`
}

/** A trade graded within this long of settling was priced at the time of the trade. */
export const AT_COMPLETION_WINDOW_MS = 48 * 60 * 60 * 1000

/**
 * PURE. The audit row a completed trade's review becomes, or null when it cannot be one: the trade is
 * not complete, or the grade was withheld (an asset with no value yet — the gap is unknown, and an
 * unknown gap is never recorded as a number).
 */
export function auditRowFromReview(r: StoredTradeReview, ref: TradeRef, now: Date): (AuditRow & { source: string; pricedAt: string }) | null {
  if (!r.ok) return null
  const { trade, receipt, sides, sideNames } = r
  if (trade.status !== 'completed' && trade.status !== 'accepted') return null
  const g = receipt.grade
  if (!g.graded) return null
  const completed = trade.completedAt ? Date.parse(trade.completedAt) : NaN
  const basis: AuditBasis = Number.isFinite(completed) && now.getTime() - completed <= AT_COMPLETION_WINDOW_MS ? 'at_completion' : 'first_audited'
  const names = (side: 'give' | 'get') => receipt.assets.filter((l) => l.side === side).map((l) => l.name)
  return {
    tradeKey: tradeKeyOf(ref),
    source: trade.origin.source,
    // Side A gives what the receipt calls `give` (collusionEvidence reads the receipt the same way).
    sideATeamId: sides[0].rosterId ?? sides[0].teamId,
    sideBTeamId: sides[1].rosterId ?? sides[1].teamId,
    sideAName: sideNames[0],
    sideBName: sideNames[1],
    sideAGave: names('give'),
    sideBGave: names('get'),
    sideAValue: g.giveValue,
    sideBValue: g.getValue,
    gapPct: g.percentDiff,
    basis,
    completedAt: trade.completedAt,
    pricedAt: now.toISOString(),
  }
}

/** Records a completed trade's values once. Returns the stored row (the first one, if it existed). */
export async function recordTradeValueAudit(leagueId: string, row: AuditRow & { source: string; pricedAt: string }): Promise<void> {
  if (!(await tradeValueAuditsReady())) return
  await prisma.$executeRaw`
    INSERT INTO trade_value_audits (id, league_id, trade_key, source, side_a_team_id, side_b_team_id, side_a_name, side_b_name,
      side_a_gave, side_b_gave, side_a_value, side_b_value, gap_pct, basis, completed_at, priced_at, created_at)
    VALUES (${randomUUID()}, ${leagueId}, ${row.tradeKey}, ${row.source}, ${row.sideATeamId}, ${row.sideBTeamId}, ${row.sideAName}, ${row.sideBName},
      ${JSON.stringify(row.sideAGave)}::jsonb, ${JSON.stringify(row.sideBGave)}::jsonb, ${row.sideAValue}, ${row.sideBValue}, ${row.gapPct},
      ${row.basis}, ${row.completedAt ? new Date(row.completedAt) : null}, ${new Date(row.pricedAt)}, NOW())
    ON CONFLICT (league_id, trade_key) DO NOTHING`
}

type RawRow = {
  trade_key: string
  side_a_team_id: string
  side_b_team_id: string
  side_a_name: string
  side_b_name: string
  side_a_gave: unknown
  side_b_gave: unknown
  side_a_value: number
  side_b_value: number
  gap_pct: number
  basis: string
  completed_at: Date | null
}

const labels = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** A league's audited trades, newest first. `[]` while the table is absent. */
export async function readTradeValueAudits(leagueId: string, opts: { since?: Date; tradeKeys?: string[] } = {}): Promise<AuditRow[]> {
  if (!(await tradeValueAuditsReady())) return []
  const filters: Prisma.Sql[] = [Prisma.sql`league_id = ${leagueId}`]
  if (opts.since) filters.push(Prisma.sql`(completed_at IS NULL OR completed_at >= ${opts.since})`)
  if (opts.tradeKeys) {
    if (opts.tradeKeys.length === 0) return []
    filters.push(Prisma.sql`trade_key IN (${Prisma.join(opts.tradeKeys)})`)
  }
  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT trade_key, side_a_team_id, side_b_team_id, side_a_name, side_b_name, side_a_gave, side_b_gave,
           side_a_value, side_b_value, gap_pct, basis, completed_at
    FROM trade_value_audits WHERE ${Prisma.join(filters, ' AND ')}
    ORDER BY completed_at DESC NULLS LAST`
  return rows.map((r) => ({
    tradeKey: r.trade_key,
    sideATeamId: r.side_a_team_id,
    sideBTeamId: r.side_b_team_id,
    sideAName: r.side_a_name,
    sideBName: r.side_b_name,
    sideAGave: labels(r.side_a_gave),
    sideBGave: labels(r.side_b_gave),
    sideAValue: Number(r.side_a_value),
    sideBValue: Number(r.side_b_value),
    gapPct: Number(r.gap_pct),
    basis: r.basis,
    completedAt: r.completed_at ? r.completed_at.toISOString() : null,
  }))
}

/**
 * The stored gap for one trade, oriented to the review's side A. `null` when the trade has no audit
 * row — the caller then keeps today's grade. A row whose side A is the review's side B is mirrored.
 */
export async function auditedGapFor(leagueId: string, ref: TradeRef, sideATeamId: string): Promise<{ gapPct: number; basis: string } | null> {
  const [row] = await readTradeValueAudits(leagueId, { tradeKeys: [tradeKeyOf(ref)] }).catch(() => [] as AuditRow[])
  if (!row) return null
  if (row.sideATeamId === sideATeamId) return { gapPct: row.gapPct, basis: row.basis }
  if (row.sideBTeamId === sideATeamId) return { gapPct: -row.gapPct, basis: row.basis }
  return null
}
