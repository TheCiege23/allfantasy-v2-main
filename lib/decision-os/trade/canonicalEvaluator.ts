import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import { detectQbFormat } from '@/lib/core-app/slotEligibility'
import type { TradeAssetSummary } from './dco'
import { buildMovements, playerIdsFromMovements } from './canonicalShadow'
import { resolveTradeEnrichment, type TradeEnrichmentResult } from './enrichmentPort'
import { resolveTradeWorld } from './tradeWorld'
import { buildTradeMemo, type CanonicalTradeMemo } from './canonicalMemo'

export type CanonicalTradeAction = 'accept' | 'counter' | 'decline' | 'review'

export interface CanonicalTradeEvaluation {
  decisionType: 'manager.trade.evaluate'
  proposalId: string
  evaluatedAt: string
  action: CanonicalTradeAction
  recommendation: string
  valueGiven: number | null
  valueReceived: number | null
  valueDelta: number | null
  grade: string | null
  fairnessScore: number | null
  confidenceScore: number
  coverageStatus: 'complete' | 'partial' | 'blocked'
  coveragePct: number
  memo: CanonicalTradeMemo
}

export interface EvaluateCanonicalTradeArgs {
  leagueId: string
  proposalId: string
  proposerRosterId: string
  receiverRosterId: string
  viewerRosterId?: string | null
  assets: TradeAssetSummary[]
  currentSeason?: number | null
  evaluatedAt?: string
}

export interface CanonicalTradeEvaluatorDeps {
  resolveWorld: (leagueId: string) => Promise<CanonicalWorld | null>
  resolveEnrichment: typeof resolveTradeEnrichment
}

function recommendationFor(valueGiven: number, valueReceived: number, complete: boolean): {
  action: CanonicalTradeAction
  recommendation: string
} {
  if (!complete) return { action: 'review', recommendation: 'Review manually because one or more assets could not be valued safely.' }
  const ratio = valueGiven > 0 ? valueReceived / valueGiven : valueReceived > 0 ? Number.POSITIVE_INFINITY : 1
  if (ratio >= 1.08) return { action: 'accept', recommendation: 'Accept: the value received clears the value sent by the configured decision margin.' }
  if (ratio >= 0.92) return { action: 'counter', recommendation: 'Counter or accept for roster fit: market value is within a normal negotiation range.' }
  return { action: 'decline', recommendation: 'Decline or counter: the supported value received is materially below the value sent.' }
}

/** Production Decision OS entry point for every two-team trade surface. */
export async function evaluateCanonicalTrade(
  args: EvaluateCanonicalTradeArgs,
  deps: Partial<CanonicalTradeEvaluatorDeps> = {},
): Promise<CanonicalTradeEvaluation> {
  const resolveWorld = deps.resolveWorld ?? resolveCanonicalWorld
  const resolveEnrichment = deps.resolveEnrichment ?? resolveTradeEnrichment
  const world = await resolveWorld(args.leagueId)
  if (!world) throw new Error('Canonical trade world unavailable')
  if (!world.rosters.some((r) => r.rosterId === args.proposerRosterId) || !world.rosters.some((r) => r.rosterId === args.receiverRosterId)) {
    throw new Error('Trade participants could not be mapped to canonical rosters')
  }
  const movements = buildMovements(args.assets, world.provenance.provider)
  if (movements.length === 0) throw new Error('Trade has no canonical assets')
  const playerIds = playerIdsFromMovements(movements)
  let enrichment: TradeEnrichmentResult
  try {
    enrichment = await resolveEnrichment({
      sport: world.league.sport,
      playerIds,
      season: world.league.season,
      week: world.league.currentWeek,
      scoringPresetId: world.league.scoringPresetId,
      idpLeague: {
        leagueId: world.league.leagueId,
        starterSlots: world.league.rosterSettings.starterSlots,
        numTeams: world.rosters.length,
        isDynasty: world.league.isDynasty,
      },
      valueFormat: {
        format: world.league.isDynasty ? 'DYNASTY' : 'REDRAFT',
        qbFormat: detectQbFormat(world.league.rosterSettings.starterSlots),
      },
    })
  } catch {
    enrichment = { enrichment: {}, valuationSource: null, adpResolved: 0, positionResolved: 0, projectionResolved: 0, idpValueResolved: 0, thinlyPricedIds: [], unresolvedIds: playerIds, warnings: ['enrichment_unavailable'] }
  }
  const evaluatedAt = args.evaluatedAt ?? new Date().toISOString()
  const memo = buildTradeMemo(resolveTradeWorld({
    world,
    movements,
    proposerRosterId: args.proposerRosterId,
    receiverRosterId: args.receiverRosterId,
    currentSeason: args.currentSeason,
    enrichment: enrichment.enrichment,
    context: { capturedAt: evaluatedAt },
  }))
  const viewer = args.viewerRosterId ?? args.proposerRosterId
  const given = memo.snapshot.sides.find((side) => side.rosterId === viewer)?.total ?? 0
  const received = memo.snapshot.sides.filter((side) => side.rosterId !== viewer).reduce((sum, side) => sum + side.total, 0)
  const coverage = memo.snapshot.coverage ?? { status: 'blocked' as const, coveragePct: 0 }
  const decision = recommendationFor(given, received, coverage.status === 'complete' && !memo.snapshot.grade.insufficientData)
  return {
    decisionType: 'manager.trade.evaluate',
    proposalId: args.proposalId,
    evaluatedAt,
    ...decision,
    valueGiven: coverage.status === 'complete' ? given : null,
    valueReceived: coverage.status === 'complete' ? received : null,
    valueDelta: coverage.status === 'complete' ? received - given : null,
    grade: memo.snapshot.grade.grade,
    fairnessScore: memo.snapshot.grade.fairnessScore,
    confidenceScore: memo.snapshot.grade.confidenceScore,
    coverageStatus: coverage.status,
    coveragePct: coverage.coveragePct,
    memo,
  }
}
