/**
 * Decision OS — production dependency wiring for `commissioner.league.health` (Slice 4).
 *
 * The deterministic "evaluator" is the built snapshot (`memo`) the assembler already produced — fed
 * wrap-fidelity, so parity proves the wrapper introduces no drift (health is wrapped, not recomputed).
 * The Decision OS NEVER recomputes health, calls the AI commissioner insights, or mutates league state.
 */
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import type { CommissionerHealthDecisionDeps } from './decision'

function newId(): string {
  return (
    (globalThis.crypto?.randomUUID?.() as string | undefined) ??
    `dec_${Date.now()}_${Math.random().toString(36).slice(2)}`
  )
}

/** Production decision deps. Recommender = the built deterministic snapshot (wrap-fidelity memo). */
export function buildProductionCommissionerHealthDecisionDeps(
  memo: CommissionerLeagueHealthSnapshot,
): CommissionerHealthDecisionDeps {
  return {
    evaluate: async () => memo, // wrap-fidelity: reuse the assembler's snapshot, no recompute
    newId,
  }
}
