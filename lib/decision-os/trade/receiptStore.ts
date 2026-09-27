import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import type { TradeEvaluationReceipt } from './evaluateTrade'

/**
 * Where `evaluateTrade()` receipts are kept: `trade_decision_snapshots`, the table that already held
 * every proposal's frozen grade. ONE receipt table (2026-09-26) — a proposal's receipt rides in its
 * own trade row (`evaluationReceipt`, written in the proposal's transaction), and an evaluation that
 * is not a trade gets a row with `tradeId` NULL. Every reader of the table selects by `tradeId`, so an
 * ad-hoc row can never appear on a trade screen.
 *
 * 🛑 THE CODE CAN SHIP BEFORE ITS MIGRATION, AND MUST NOT BREAK TRADES WHEN IT DOES. Until
 * `20260927000000_trade_decision_snapshot_evaluation_receipts` is applied, the new columns do not
 * exist and `tradeId` is NOT NULL. Writing them inside the proposal transaction would abort the trade
 * itself. So every writer asks `receiptColumnsReady()` first, and writes the old row shape when the
 * answer is no. The probe re-checks every 10 minutes, so applying the migration takes effect without
 * a deploy.
 */

const RECHECK_MS = 10 * 60_000
let readyCache: { ready: boolean; at: number } | null = null

type Probe = () => Promise<boolean>

const defaultProbe: Probe = async () => {
  const rows = await prisma.$queryRaw<Array<{ n: number | bigint }>>`
    SELECT COUNT(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'trade_decision_snapshots' AND column_name IN ('evaluationReceipt', 'surface', 'inputHash')`
  return Number(rows[0]?.n ?? 0) === 3
}

/** True once the migration's columns exist. Never throws: an unanswerable probe is "not ready". */
export async function receiptColumnsReady(opts: { probe?: Probe; now?: () => number } = {}): Promise<boolean> {
  const now = (opts.now ?? Date.now)()
  // Once ready, always ready — a column is not dropped under a running process.
  if (readyCache?.ready) return true
  if (readyCache && now - readyCache.at < RECHECK_MS) return false
  let ready = false
  try {
    ready = await (opts.probe ?? defaultProbe)()
  } catch {
    ready = false
  }
  readyCache = { ready, at: now }
  return ready
}

/** Test seam: forget the cached answer. */
export function resetReceiptColumnsCache(): void {
  readyCache = null
}

/** The new columns for a row, from a receipt. Shared by the proposal writer and the ad-hoc writer. */
export function receiptColumns(receipt: TradeEvaluationReceipt) {
  return {
    surface: receipt.surface.slice(0, 48),
    inputHash: receipt.inputHash,
    evaluationReceipt: JSON.parse(JSON.stringify(receipt)) as Prisma.InputJsonValue,
  }
}

/**
 * The row for an evaluation that is not a trade. The trade-shaped columns are filled with what the
 * evaluation actually had — and say so where it had nothing (no rosters) — rather than left looking
 * like a proposal that lost its data.
 */
export function adHocSnapshotData(receipt: TradeEvaluationReceipt) {
  const g = receipt.grade
  return {
    tradeId: null,
    leagueId: receipt.leagueId,
    proposedByUserId: receipt.userId,
    policyVersion: receipt.modelVersion,
    format: (g.leagueType?.type ?? 'unknown').slice(0, 32),
    leagueContext: { leagueId: receipt.leagueId, leagueType: g.leagueType ?? null, basis: g.basis ?? null },
    rosterContext: { captured: false, reason: 'An ad-hoc evaluation names assets, not rosters.' },
    assetContext: { assets: receipt.assets, unpriceable: receipt.unpriceable },
    managerContext: { userId: receipt.userId },
    evidence: { source: 'evaluateTrade', surface: receipt.surface, inputHash: receipt.inputHash },
    readiness: { graded: g.graded, withheldReason: g.graded ? null : g.reason },
    completeness: g.graded ? 'complete' : 'partial',
    capturedAt: new Date(receipt.evaluatedAt),
    ...receiptColumns(receipt),
  }
}

type SnapshotCreate = { create(args: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }> }

/** Save an ad-hoc evaluation's receipt. Throws when it cannot — `evaluateTrade` turns that into `persisted: false`. */
export async function saveAdHocReceipt(
  receipt: TradeEvaluationReceipt,
  opts: { ready?: () => Promise<boolean>; store?: () => SnapshotCreate | undefined } = {},
): Promise<{ id: string }> {
  if (!(await (opts.ready ?? receiptColumnsReady)())) throw new Error('trade_decision_snapshots is not migrated for receipts yet')
  const store = (opts.store ?? (() => (prisma as unknown as { tradeDecisionSnapshot?: SnapshotCreate }).tradeDecisionSnapshot))()
  if (!store || typeof store.create !== 'function') throw new Error('tradeDecisionSnapshot is not in the generated client')
  // `select: { id }` so the insert never RETURNs a column this database might not have.
  return store.create({ data: adHocSnapshotData(receipt), select: { id: true } })
}
