import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { EVENT, type EventType } from '@/lib/events/catalog'
import { getPlatformEvents } from '@/lib/events/producers'
import { evaluateCanonicalTrade } from './canonicalEvaluator'
import type { TradeAssetSummary } from './dco'

const STATUS_EVENT: Record<string, EventType> = {
  pending: EVENT.TRADE_PROPOSED,
  countered: EVENT.TRADE_COUNTERED,
  awaiting_commissioner: EVENT.TRADE_ACCEPTED,
  awaiting_votes: EVENT.TRADE_ACCEPTED,
  scheduled: EVENT.TRADE_ACCEPTED,
  accepted: EVENT.TRADE_ACCEPTED,
  rejected: EVENT.TRADE_DECLINED,
  declined: EVENT.TRADE_DECLINED,
  cancelled: EVENT.TRADE_CANCELED,
  canceled: EVENT.TRADE_CANCELED,
  vetoed: EVENT.TRADE_VETOED,
  processed: EVENT.TRADE_PROCESSED,
  expired: EVENT.TRADE_EXPIRED,
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function summary(item: {
  itemType: string
  itemReference: string | null
  fromRosterId: string
  toRosterId: string
  faabAmount: number | null
  metadata: Prisma.JsonValue
}): TradeAssetSummary {
  const metadata = record(item.metadata)
  const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
  const str = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
  return {
    assetType: item.itemType,
    itemReference: item.itemReference,
    fromRosterId: item.fromRosterId,
    toRosterId: item.toRosterId,
    playerId: ['player', 'keeper', 'devy'].includes(item.itemType.toLowerCase()) ? item.itemReference : str(metadata.playerId),
    playerName: str(metadata.playerName ?? metadata.name),
    position: str(metadata.position),
    team: str(metadata.team),
    pickSeason: num(metadata.pickSeason ?? metadata.season),
    pickRound: num(metadata.pickRound ?? metadata.round),
    pickNumber: num(metadata.pickNumber),
    pickOriginalRosterId: str(metadata.originalRosterId),
    pickLabel: str(metadata.pickLabel) ?? (item.itemType.toLowerCase().includes('pick') ? item.itemReference : null),
    faabAmount: item.faabAmount ?? num(metadata.faabAmount),
  }
}

/** Best-effort capture. A telemetry failure can never block the trade action. */
export async function captureNativeTradeLifecycleSnapshot(input: {
  tradeId: string
  lifecycleStatus: string
  eventRevision: string
  actorUserId?: string | null
  occurredAt?: Date
}): Promise<void> {
  try {
    const trade = await prisma.afLeagueTrade.findUnique({
      where: { id: input.tradeId },
      include: {
        items: true,
        league: { select: { id: true, sport: true, leagueType: true, season: true } },
      },
    })
    if (!trade) return
    const type = STATUS_EVENT[input.lifecycleStatus.toLowerCase()]
    if (!type) return
    const assets = trade.items.map(summary)
    const evaluation = await evaluateCanonicalTrade({
      leagueId: trade.leagueId,
      proposalId: trade.id,
      proposerRosterId: trade.proposerRosterId,
      receiverRosterId: trade.receiverRosterId,
      viewerRosterId: trade.proposerRosterId,
      assets,
      currentSeason: trade.league.season,
      evaluatedAt: (input.occurredAt ?? new Date()).toISOString(),
    })
    const payload = type === EVENT.TRADE_PROPOSED
      ? { tradeId: trade.id, proposerRosterId: trade.proposerRosterId, receiverRosterId: trade.receiverRosterId }
      : type === EVENT.TRADE_VETOED
        ? { tradeId: trade.id, ...(input.actorUserId ? { byUserId: input.actorUserId } : {}) }
        : { tradeId: trade.id }
    await getPlatformEvents().emit(type, {
      payload: payload as never,
      leagueId: trade.leagueId,
      seasonId: String(trade.league.season),
      sport: trade.league.sport,
      leagueConcept: trade.league.leagueType,
      actor: { type: input.actorUserId ? 'user' : 'system', id: input.actorUserId ?? null },
      occurredAt: input.occurredAt,
      source: 'native_trade_engine',
      correlationId: trade.rootTradeId ?? trade.id,
      idempotencyKey: `trade-lifecycle:${trade.id}:${input.eventRevision}`,
      metadata: {
        lifecycleStatus: input.lifecycleStatus,
        modelVersion: evaluation.memo.snapshot.version,
        assets,
        decision: {
          action: evaluation.action,
          recommendation: evaluation.recommendation,
          valueGiven: evaluation.valueGiven,
          valueReceived: evaluation.valueReceived,
          valueDelta: evaluation.valueDelta,
          grade: evaluation.grade,
          fairnessScore: evaluation.fairnessScore,
          confidenceScore: evaluation.confidenceScore,
          coverageStatus: evaluation.coverageStatus,
          coveragePct: evaluation.coveragePct,
        },
        snapshot: evaluation.memo.snapshot,
        uncertainty: evaluation.memo.uncertainty,
        provenance: evaluation.memo.provenance,
      },
      subjects: [
        { kind: 'trade', id: trade.id },
        { kind: 'roster', id: trade.proposerRosterId },
        { kind: 'roster', id: trade.receiverRosterId },
      ],
    })
  } catch (error) {
    console.warn('[trade-lifecycle] snapshot capture failed', error instanceof Error ? error.message : error)
  }
}
