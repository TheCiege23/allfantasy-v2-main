import { evaluateCanonicalTrade } from '@/lib/decision-os/trade/canonicalEvaluator'
import type { TradeAssetSummary } from '@/lib/decision-os/trade/dco'
import type { TradeAssetInput } from '@/lib/league-trade-engine/types'
import { projectedLetterFor } from '@/lib/trade-intel/gradeScale'

export type ServerTradeParticipantDecision = {
  rosterId: string
  grade: string | null
  action: string
  recommendation: string
  valueGiven: number | null
  valueReceived: number | null
  valueDelta: number | null
  fairnessScore: number | null
  confidenceScore: number
  coverageStatus: 'complete' | 'partial' | 'blocked'
  coveragePct: number
  lineupPointsBefore: number | null
  lineupPointsAfter: number | null
  lineupPointsDelta: number | null
}

export type ServerTradeDecisionResult = {
  modelVersion: string
  capturedAt: string
  scope: 'market'
  evaluatorSupported: boolean
  reason: string | null
  participants: ServerTradeParticipantDecision[]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function tradeAssetSummary(asset: TradeAssetInput): TradeAssetSummary {
  const metadata = record(asset.metadata)
  const stringValue = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
  const numberValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
  return {
    assetType: asset.itemType,
    itemReference: asset.itemReference ?? null,
    fromRosterId: asset.fromRosterId,
    toRosterId: asset.toRosterId,
    playerId: ['player', 'keeper', 'devy'].includes(asset.itemType.toLowerCase()) ? asset.itemReference ?? null : stringValue(metadata.playerId),
    playerName: stringValue(metadata.playerName ?? metadata.name),
    position: stringValue(metadata.position),
    team: stringValue(metadata.team),
    pickSeason: numberValue(metadata.pickSeason ?? metadata.season),
    pickRound: numberValue(metadata.pickRound ?? metadata.round),
    pickNumber: numberValue(metadata.pickNumber),
    pickOriginalRosterId: stringValue(metadata.originalRosterId),
    pickLabel: stringValue(metadata.pickLabel ?? metadata.label) ?? (asset.itemType.toLowerCase().includes('pick') ? asset.itemReference ?? null : null),
    faabAmount: asset.faabAmount ?? numberValue(metadata.faabAmount ?? metadata.amount),
  }
}

/**
 * Recompute a custom or suggested two-team package entirely on the server.
 * Multi-team market letters stay withheld until the canonical evaluator supports
 * more than two sides; their signed participant outcome evidence is still saved.
 */
export async function evaluateServerTradeDecision(input: {
  leagueId: string
  proposerRosterId: string
  receiverRosterId: string
  participantRosterIds: string[]
  assets: TradeAssetInput[]
  season: number | null
  capturedAt?: string
}): Promise<ServerTradeDecisionResult> {
  const capturedAt = input.capturedAt ?? new Date().toISOString()
  if (input.participantRosterIds.length !== 2) {
    return {
      modelVersion: 'canonical-trade-market-v1', capturedAt, scope: 'market', evaluatorSupported: false,
      reason: `Market letter withheld: the canonical evaluator does not yet support ${input.participantRosterIds.length}-team trades.`,
      participants: [],
    }
  }
  const assets = input.assets.map(tradeAssetSummary)
  try {
    const evaluations = await Promise.all(input.participantRosterIds.map((rosterId) => evaluateCanonicalTrade({
      leagueId: input.leagueId,
      proposalId: `proposal:${input.leagueId}:${capturedAt}`,
      proposerRosterId: input.proposerRosterId,
      receiverRosterId: input.receiverRosterId,
      viewerRosterId: rosterId,
      assets,
      currentSeason: input.season,
      evaluatedAt: capturedAt,
      includeRosterImpact: true,
    })))
    return {
      modelVersion: evaluations[0]?.memo.snapshot.version ?? 'canonical-trade-market-v1',
      capturedAt,
      scope: 'market',
      evaluatorSupported: true,
      reason: null,
      participants: evaluations.map((evaluation, index) => {
        const hasSignal = evaluation.coverageStatus === 'complete'
          && evaluation.valueGiven != null && evaluation.valueReceived != null
        const percentDiff = hasSignal && evaluation.valueGiven! > 0
          ? ((evaluation.valueReceived! - evaluation.valueGiven!) / evaluation.valueGiven!) * 100
          : null
        return {
          rosterId: input.participantRosterIds[index]!,
          grade: projectedLetterFor({ percentDiff, hasSignal }),
          action: evaluation.action,
          recommendation: evaluation.recommendation,
          valueGiven: evaluation.valueGiven,
          valueReceived: evaluation.valueReceived,
          valueDelta: evaluation.valueDelta,
          fairnessScore: evaluation.fairnessScore,
          confidenceScore: evaluation.confidenceScore,
          coverageStatus: evaluation.coverageStatus,
          coveragePct: evaluation.coveragePct,
          lineupPointsBefore: evaluation.rosterImpact?.startingPointsBefore ?? null,
          lineupPointsAfter: evaluation.rosterImpact?.startingPointsAfter ?? null,
          lineupPointsDelta: evaluation.rosterImpact?.startingPointsDelta ?? null,
        }
      }),
    }
  } catch (error) {
    return {
      modelVersion: 'canonical-trade-market-v1', capturedAt, scope: 'market', evaluatorSupported: true,
      reason: error instanceof Error ? error.message : 'Server trade evaluation unavailable.',
      participants: [],
    }
  }
}
