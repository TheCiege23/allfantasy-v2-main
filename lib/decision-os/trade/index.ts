/**
 * Decision OS — `manager.trade.evaluate` orchestrator + barrel (Slice 3).
 *
 * Pure end-to-end thread: World Resolution (read-only) → DCO (read-only) → Decision (DCO-only) →
 * optional Parity (shadow, wrap-fidelity). Prisma reads happen in an injected loader at the route
 * seam (loader.ts), never here. The Decision OS NEVER executes or mutates a trade.
 */
import type { Decision } from '@/lib/decision-os/core/decision'
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
    // 🛑 THE PARITY RESULT IS RETURNED, NOT EMITTED — the emit moved to `runTradeShadowForProposal`.
    // This used to fire `emitShadowParity` with NO `ran` key and NO `surface`. `flipReadiness` counts
    // a comparison only when `flags.ran === true` and groups on `flags.surface` with a literal
    // 'default' fallback, so every event this wrote was filed as a skip in a bucket named after
    // nothing. `runTradeShadowForProposal` is the ONLY runtime caller that passes `deps.shadow`
    // (`grounding/decisionBridge` does not call this orchestrator at all), and it now emits with both
    // fields set.
    //
    // ⚠ THE `unsupported` BRANCH IS A REFUSAL AND MUST NOT BECOME A COMPARISON. A 3+ team trade is
    // one the legacy evaluator cannot evaluate, so no comparison happened; the wrapper emits it as
    // `ran: false` with its reason. Adding `ran: true` here for both branches would have been the
    // one-line version of this fix and would have inflated the denominator the flip gate divides by.
    parity = compareTradeParity(decision, deps.shadow.snapshot)
  }

  return { world, decision, parity }
}
