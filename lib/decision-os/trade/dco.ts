/**
 * Decision OS — Decision Context Object for `manager.trade.evaluate` (Slice 3).
 *
 * READ-ONLY assembly. The DCO is the ONLY thing the Trade Intelligence decision may consume — no
 * decision engine resolves league/settings/snapshot directly. The authoritative deterministic verdict
 * (the snapshot memo) is provided to the decision via an injected `evaluate` dep; this DCO carries the
 * MULTI-TEAM participant context + World. No prisma, no writes.
 *
 * MULTI-TEAM: the DCO models `participants[]` derived from the asset graph (every roster that sends or
 * receives an asset). A two-team trade is simply `participants.length === 2`. The canonical evaluator
 * (`buildTradeValueSnapshot`) ONLY supports two teams, so `evaluatorSupported` is true iff there are
 * exactly two participants; 3+ team trades are flagged `unsupported_by_legacy_evaluator` and reported
 * honestly without inventing a new evaluator. Additive — the core Decision Object contract is unchanged.
 */
import type { DecisionProvenance } from '@/lib/decision-os/core/decision'
import type { TradeWorld } from './world'

/** A trade asset summary the DCO carries (read-only; no value computation here). */
export interface TradeAssetSummary {
  fromRosterId: string
  toRosterId: string
  assetType: string
  playerId: string | null
  playerName: string | null
  faabAmount: number | null
}

/** One participating roster's side of the trade (multi-team capable). */
export interface TradeParticipant {
  rosterId: string
  /** Assets this roster sends out. */
  sends: TradeAssetSummary[]
  /** Assets this roster receives. */
  receives: TradeAssetSummary[]
}

export interface TradeProposalContext {
  proposalId: string
  proposerRosterId: string
  receiverRosterId: string
  status: string | null
  vetoMode: string | null
}

export type TradeEvaluatorSupport = 'supported' | 'unsupported_by_legacy_evaluator'

export interface TradeDCO {
  decision_type: 'manager.trade.evaluate'
  world: TradeWorld
  user: { userId: string }
  league: { leagueId: string; sport: string }
  proposal: TradeProposalContext
  /** Every participating roster (>=2). Two-team = length 2. */
  participants: TradeParticipant[]
  participantCount: number
  /** True iff the legacy two-team evaluator can grade this trade (exactly two participants). */
  evaluatorSupported: boolean
  unsupportedReason: TradeEvaluatorSupport | null
  /** Flat list of all assets (read-only) — used by per-participant legality rules. */
  assets: TradeAssetSummary[]
  confidence_inputs: { snapshotConfidenceScore: number | null }
  provenance: DecisionProvenance
  /** 0–100. */
  data_completeness: number
  uncertainty: string[]
  /** False for two-team (placeholder) AND for 3+ team (genuinely unsupported by the evaluator). */
  simulation_available: boolean
}

export interface TradeDCOInput {
  world: TradeWorld
  userId: string
  leagueId: string
  sport: string
  proposal: TradeProposalContext
  assets: TradeAssetSummary[]
  /** Confidence score from the persisted snapshot (already loaded at the seam). */
  snapshotConfidenceScore: number | null
}

/** Derive the participant graph from the assets (every roster that sends or receives). Deterministic. */
export function deriveParticipants(assets: TradeAssetSummary[]): TradeParticipant[] {
  const ids: string[] = []
  for (const a of assets) {
    if (a.fromRosterId && !ids.includes(a.fromRosterId)) ids.push(a.fromRosterId)
    if (a.toRosterId && !ids.includes(a.toRosterId)) ids.push(a.toRosterId)
  }
  return ids.map((rosterId) => ({
    rosterId,
    sends: assets.filter((a) => a.fromRosterId === rosterId),
    receives: assets.filter((a) => a.toRosterId === rosterId),
  }))
}

/** Pure, read-only DCO assembly with honest provenance + completeness + multi-team support flag. */
export function buildTradeDCO(input: TradeDCOInput): TradeDCO {
  const participants = deriveParticipants(input.assets)
  const participantCount = participants.length
  const evaluatorSupported = participantCount === 2
  const unsupportedReason: TradeEvaluatorSupport | null = evaluatorSupported ? null : 'unsupported_by_legacy_evaluator'

  const uncertainty: string[] = []
  if (input.world.deadline.uncertainty) uncertainty.push(input.world.deadline.uncertainty)
  if (!input.world.snapshotAvailable) uncertainty.push('Deterministic value snapshot was not available.')
  if (!evaluatorSupported) {
    uncertainty.push(`Multi-team trade (${participantCount} teams) — the deterministic evaluator supports two-team trades only.`)
  }
  if (input.snapshotConfidenceScore != null && input.snapshotConfidenceScore < 100 && evaluatorSupported) {
    uncertainty.push(`Snapshot input completeness ${input.snapshotConfidenceScore}/100.`)
  }
  if (participants.some((p) => p.sends.length === 0 || p.receives.length === 0)) {
    uncertainty.push('A participant has no assets on one side.')
  }

  // Weakest required input drives completeness/provenance (honesty contract).
  const weakest: DecisionProvenance = !evaluatorSupported
    ? { weakest_source: 'evaluator', weakest_trust: 'unverified' }
    : !input.world.snapshotAvailable
      ? { weakest_source: 'snapshot', weakest_trust: 'low' }
      : (input.snapshotConfidenceScore ?? 100) < 60
        ? { weakest_source: 'snapshot', weakest_trust: 'medium' }
        : { weakest_source: 'derived', weakest_trust: 'high' }
  const data_completeness = !evaluatorSupported
    ? 20
    : input.world.snapshotAvailable
      ? Math.min(100, input.snapshotConfidenceScore ?? 100)
      : 40

  return {
    decision_type: 'manager.trade.evaluate',
    world: input.world,
    user: { userId: input.userId },
    league: { leagueId: input.leagueId, sport: input.sport },
    proposal: input.proposal,
    participants,
    participantCount,
    evaluatorSupported,
    unsupportedReason,
    assets: input.assets,
    confidence_inputs: { snapshotConfidenceScore: input.snapshotConfidenceScore },
    provenance: weakest,
    data_completeness,
    uncertainty,
    // Two-team is a placeholder false; 3+ team is genuinely unsupported by the legacy evaluator.
    simulation_available: false,
  }
}
