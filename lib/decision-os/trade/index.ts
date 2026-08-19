/**
 * Decision OS — `manager.trade.evaluate` orchestrator + barrel (Slice 3).
 *
 * Pure end-to-end thread: World Resolution (read-only) → DCO (read-only) → Decision (DCO-only) →
 * optional Parity (shadow, wrap-fidelity). Prisma reads happen in an injected loader at the route
 * seam (loader.ts), never here. The Decision OS NEVER executes or mutates a trade.
 */
import type { Decision } from '@/lib/decision-os/core/decision'
import { emitShadowParity } from '@/lib/decision-os/core/parity'
import type { TradeValueSnapshot } from '@/lib/trade-value/types'
import { resolveTradeWorld, type TradeWorld, type TradeWorldInput } from './world'
import { buildTradeDCO, type TradeAssetSummary, type TradeProposalContext } from './dco'
import { decideTradeEvaluate, type TradeEvaluation, type TradeDecisionDeps } from './decision'
import { compareTradeParity, type TradeParityResult } from './parity'

export * from './world'
export * from './dco'
export * from './rules'
export * from './decision'
export * from './parity'
export * from './tradeCardAdapter'
export * from './outcome'
// Phase E.2 — the Canonical Trade Memo (rehosts the pure value engine onto CanonicalAsset inputs).
export * from './canonicalMemo'

export interface RunTradeEvaluateInput {
  worldInput: TradeWorldInput
  userId: string
  leagueId: string
  sport: string
  proposal: TradeProposalContext
  assets: TradeAssetSummary[]
  snapshotConfidenceScore: number | null
}

export interface RunTradeEvaluateDeps {
  decision: TradeDecisionDeps
  /** When present, run the Parity Gate against the persisted deterministic snapshot (shadow mode). */
  shadow?: { snapshot: TradeValueSnapshot }
}

export interface RunTradeEvaluateResult {
  world: TradeWorld
  decision: Decision<TradeEvaluation>
  parity?: TradeParityResult
}

export async function runTradeEvaluateDecision(input: RunTradeEvaluateInput, deps: RunTradeEvaluateDeps): Promise<RunTradeEvaluateResult> {
  const world = resolveTradeWorld(input.worldInput)
  const dco = buildTradeDCO({
    world,
    userId: input.userId,
    leagueId: input.leagueId,
    sport: input.sport,
    proposal: input.proposal,
    assets: input.assets,
    snapshotConfidenceScore: input.snapshotConfidenceScore,
  })
  const decision = await decideTradeEvaluate(dco, deps.decision)

  let parity: TradeParityResult | undefined
  if (deps.shadow) {
    parity = compareTradeParity(decision, deps.shadow.snapshot)
    emitShadowParity(
      'manager.trade.evaluate',
      parity.unsupported
        ? { legacy_shadow_compared: true, wrap_fidelity: true, evaluator_supported: false, unsupported: true, reason: 'unsupported_by_legacy_evaluator', participants: dco.participantCount }
        : { legacy_shadow_compared: true, wrap_fidelity: true, evaluator_supported: true, parity_passed: parity.passed, parity_failed: !parity.passed, diffs: parity.diffs.length, participants: parity.comparedParticipants },
      decision.decision_id,
    )
  }

  return { world, decision, parity }
}
