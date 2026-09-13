import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import { evaluateCanonicalTrade, type CanonicalTradeEvaluation } from '@/lib/decision-os/trade/canonicalEvaluator'
import type { TradeAssetSummary } from '@/lib/decision-os/trade/dco'
import { EVENT } from '@/lib/events/catalog'
import { getPlatformEvents } from '@/lib/events/producers'
import type { PendingProviderTrade, PendingTradeAsset } from './scanPendingSleeperTrades'

export type ProviderPendingEvaluation = Pick<
  CanonicalTradeEvaluation,
  'action' | 'recommendation' | 'valueGiven' | 'valueReceived' | 'valueDelta' | 'grade' |
  'fairnessScore' | 'confidenceScore' | 'coverageStatus' | 'coveragePct' | 'evaluatedAt'
>

function summary(
  asset: PendingTradeAsset,
  fromRosterId: string,
  toRosterId: string,
  rosterForExternal: (externalId: string | null | undefined) => string | null,
): TradeAssetSummary {
  const assetType = asset.isPick ? 'draft_pick' : asset.faabAmount != null ? 'faab' : 'player'
  return {
    assetType,
    itemReference: asset.playerId ?? asset.pickRound ?? null,
    fromRosterId,
    toRosterId,
    playerId: asset.playerId,
    playerName: asset.playerName,
    position: asset.position === '—' ? null : asset.position,
    team: asset.team === '—' ? null : asset.team,
    pickSeason: asset.pickYear ?? null,
    pickRound: asset.pickRoundNumber ?? null,
    pickLabel: asset.pickRound ?? null,
    pickOriginalRosterId: rosterForExternal(asset.pickOriginalRosterExternalId),
    faabAmount: asset.faabAmount ?? null,
  }
}

/** Evaluate provider offers through the same production Decision OS entry point and capture once. */
export async function evaluatePendingProviderTrades(args: {
  leagueId: string
  trades: PendingProviderTrade[]
}): Promise<Map<string, ProviderPendingEvaluation>> {
  const output = new Map<string, ProviderPendingEvaluation>()
  if (args.trades.length === 0) return output
  const world = await resolveCanonicalWorld(args.leagueId).catch(() => null)
  if (!world) return output

  const rosterForExternal = (externalId: string | null | undefined) => {
    if (!externalId) return null
    const team = world.teams.find((candidate) => candidate.source.sourceTeamId === externalId)
    return team ? world.rosters.find((roster) => roster.teamId === team.teamId)?.rosterId ?? null : null
  }

  await Promise.all(args.trades.map(async (trade) => {
    const viewerRosterId = rosterForExternal(trade.viewerRosterExternalId)
    const otherRosterId = rosterForExternal(trade.counterpartyRosterExternalId)
    if (!viewerRosterId || !otherRosterId) return
    const assets = [
      ...trade.assetsGiven.map((asset) => summary(asset, viewerRosterId, otherRosterId, rosterForExternal)),
      ...trade.assetsReceived.map((asset) => summary(asset, otherRosterId, viewerRosterId, rosterForExternal)),
    ]
    try {
      const evaluation = await evaluateCanonicalTrade({
        leagueId: args.leagueId,
        proposalId: `${trade.provider}:${trade.transactionId}`,
        proposerRosterId: viewerRosterId,
        receiverRosterId: otherRosterId,
        viewerRosterId,
        assets,
      }, { resolveWorld: async () => world })
      const view: ProviderPendingEvaluation = {
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
        evaluatedAt: evaluation.evaluatedAt,
      }
      output.set(trade.transactionId, view)

      const idempotencyKey = `provider-trade:${trade.provider}:${trade.transactionId}:proposed`
      const exists = await prisma.domainEvent.findUnique({ where: { idempotencyKey }, select: { eventId: true } }).catch(() => null)
      if (!exists) {
        await getPlatformEvents().emit(EVENT.TRADE_PROPOSED, {
          payload: { tradeId: `${trade.provider}:${trade.transactionId}`, proposerRosterId: viewerRosterId, receiverRosterId: otherRosterId },
          leagueId: args.leagueId,
          seasonId: world.league.season == null ? null : String(world.league.season),
          sport: world.league.sport,
          leagueConcept: world.league.leagueType,
          actor: { type: 'provider', id: trade.provider },
          occurredAt: trade.proposedAt ?? undefined,
          source: `ingestion:${trade.provider}`,
          correlationId: `${trade.provider}:${trade.transactionId}`,
          idempotencyKey,
          metadata: { providerTransactionId: trade.transactionId, assets, decision: view, snapshot: evaluation.memo.snapshot, uncertainty: evaluation.memo.uncertainty },
          subjects: [{ kind: 'trade', id: `${trade.provider}:${trade.transactionId}` }, { kind: 'roster', id: viewerRosterId }, { kind: 'roster', id: otherRosterId }],
        })
      }
    } catch (error) {
      console.warn('[provider-trade] canonical evaluation unavailable', trade.provider, trade.transactionId, error instanceof Error ? error.message : error)
    }
  }))
  return output
}
