/**
 * Decision OS — outcome/learning hooks for `manager.trade.evaluate` (Slice 3 PLACEHOLDERS).
 *
 * Minimal no-op hooks marking the Outcome → Learning seam. The real wiring reuses existing systems
 * later: RedraftTradeValueSnapshot + redraftTradeMarketEvents + recordAfLearningEvent. Nothing is
 * built now; these exist so the loop has explicit attachment points. NONE of these execute, accept,
 * settle, or mutate a trade.
 */
import type { Decision } from '@/lib/decision-os/core/decision'
import type { TradeEvaluation } from './decision'

export interface TradeOutcomeHooks {
  onTradeEvaluated?: (decisionId: string, evaluation: TradeEvaluation | null) => void
  onTradeProposed?: (decisionId: string, proposalId: string) => void
  onTradeAccepted?: (decisionId: string, proposalId: string) => void
  onTradeRejected?: (decisionId: string, proposalId: string) => void
  onTradeValueOutcome?: (decisionId: string, proposalId: string, realizedDelta: number | null) => void
}

/** No-op by default. A later slice reuses the snapshot + market-event ledger (read-only history). */
export function recordTradeDecisionOutcome(
  decision: Decision<TradeEvaluation>,
  hooks: TradeOutcomeHooks = {},
): void {
  hooks.onTradeEvaluated?.(decision.decision_id, decision.recommended_actions[0] ?? null)
}
