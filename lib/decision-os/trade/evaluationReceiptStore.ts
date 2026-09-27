import 'server-only'
import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { evaluationReceiptSchema, receiptHref, type TradeEvaluationReceipt, type SavedTradeEvaluation } from './evaluationReceipt'

const SNAPSHOT_TYPE = 'trade_value_receipt_v1'

/** This legacy column holds an account-scoped namespace, never a client-supplied Sleeper username. */
export function receiptOwnerKey(userId: string): string {
  return `user:${createHash('sha256').update(userId).digest('base64url')}`
}

function assetKey(asset: TradeEvaluationReceipt['input']['sideGive'][number]): string {
  if (asset.kind === 'pick') return `pick:${asset.year}:${asset.round}:${asset.tier ?? 'unknown'}`
  if (asset.kind === 'faab') return `faab:${asset.amount}`
  return JSON.stringify([asset.providerIdentity?.provider ?? null, asset.providerIdentity?.id ?? asset.playerId ?? null,
    asset.sportHint ?? null, asset.name?.trim().toLowerCase() ?? null])
}

/** Order-independent within each side; the sender and receiver are deliberately not interchangeable. */
export function receiptContextKey(receipt: TradeEvaluationReceipt): string {
  return createHash('sha256').update(JSON.stringify([
    receipt.input.sideGive.map(assetKey).sort(), receipt.input.sideGet.map(assetKey).sort(), receipt.input.opponentTeamExternalId ?? null,
  ])).digest('hex')
}

/** Append-only. A new evaluation creates another row; no update/upsert can replace an original. */
export async function saveTradeEvaluationReceipt(userId: string, input: TradeEvaluationReceipt): Promise<SavedTradeEvaluation> {
  if (!userId) throw new Error('An authenticated account is required')
  const receipt = evaluationReceiptSchema.parse(input)
  if (receipt.league.id !== receipt.input.leagueId) throw new Error('Receipt league mismatch')
  if (JSON.stringify(receipt).length > 128_000) throw new Error('Receipt is too large')
  const access = await assertLeagueMember(receipt.league.id, userId)
  if (!access.ok) throw new Error('League access is required')
  const row = await prisma.tradeAnalysisSnapshot.create({ data: {
    leagueId: receipt.league.id, sleeperUsername: receiptOwnerKey(userId), snapshotType: SNAPSHOT_TYPE,
    contextKey: receiptContextKey(receipt), payloadJson: receipt as unknown as Prisma.InputJsonValue,
    expiresAt: null,
  }, select: { id: true } })
  return { id: row.id, href: receiptHref(row.id, receipt.league.id), evaluatedAt: receipt.evaluatedAt }
}

export async function readTradeEvaluationReceipt(userId: string, id: string): Promise<TradeEvaluationReceipt | null> {
  if (!userId || !id || id.length > 128) return null
  const row = await prisma.tradeAnalysisSnapshot.findFirst({ where: {
    id, sleeperUsername: receiptOwnerKey(userId), snapshotType: SNAPSHOT_TYPE,
  }, select: { leagueId: true, payloadJson: true } })
  if (!row) return null
  const parsed = evaluationReceiptSchema.safeParse(row.payloadJson)
  if (!parsed.success || parsed.data.league.id !== row.leagueId || parsed.data.input.leagueId !== row.leagueId) return null
  const access = await assertLeagueMember(row.leagueId, userId)
  return access.ok ? parsed.data : null
}
