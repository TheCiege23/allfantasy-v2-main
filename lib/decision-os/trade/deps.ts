/**
 * Decision OS — production dependency wiring for `manager.trade.evaluate` (Slice 3).
 *
 * The ONLY place the production evaluation memo is bound. The decision layer never imports the
 * evaluator/persistence directly (architecture rule). In SHADOW the "evaluator" is the persisted
 * deterministic snapshot the route already captured (`snapshotRow.payload`) — fed wrap-fidelity, so
 * parity proves the wrapper introduces no drift (the evaluator is wrapped, not recomputed). The
 * Decision OS NEVER calls captureRedraftTradeValueSnapshot and NEVER mutates trade state.
 */
import type { TradeValueSnapshot } from '@/lib/trade-value/types'
import type { TradeDecisionDeps } from './decision'
import type { TradeRuleDeps } from './rules'

function newId(): string {
  return (
    (globalThis.crypto?.randomUUID?.() as string | undefined) ??
    `dec_${Date.now()}_${Math.random().toString(36).slice(2)}`
  )
}

/**
 * Production rule deps. The deterministic World rules (deadline/FAAB) always run; the injected
 * legality validator is left undefined here (the proposal already passed server validation at the
 * create route, and the Decision OS must never re-run mutating checks). The validateCanonical seam
 * (second validator for parity) is composed in a later step — never retired.
 */
export function buildProductionTradeRuleDeps(): TradeRuleDeps {
  return {}
}

/**
 * Production decision deps. The recommender is the persisted deterministic snapshot (`memo`) — fed
 * wrap-fidelity. For a non-shadow live run, the memo is still the authoritative captured snapshot.
 */
export function buildProductionTradeDecisionDeps(memo: TradeValueSnapshot): TradeDecisionDeps {
  return {
    evaluate: async () => memo, // wrap-fidelity: reuse the persisted deterministic snapshot, no recompute
    ruleDeps: buildProductionTradeRuleDeps(),
    newId,
  }
}
