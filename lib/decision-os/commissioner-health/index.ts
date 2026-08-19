/**
 * Decision OS — `commissioner.league.health` orchestrator + barrel (Slice 4).
 *
 * Pure end-to-end thread: World Resolution (read-only) → DCO (read-only) → Decision (DCO-only) →
 * optional Parity (shadow, wrap-fidelity). No prisma here — the server-authoritative assembler
 * provides the built snapshot. ASSESSMENT ONLY — the Decision OS never executes a commissioner action.
 */
import type { Decision } from '@/lib/decision-os/core/decision'
import { emitShadowParity } from '@/lib/decision-os/core/parity'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import { resolveCommissionerHealthWorld, type CommissionerHealthWorld } from './world'
import { buildCommissionerHealthDCO } from './dco'
import { decideCommissionerHealth, type CommissionerHealthAssessment, type CommissionerHealthDecisionDeps } from './decision'
import { compareCommissionerHealthParity, type CommissionerHealthParityResult } from './parity'

export * from './world'
export * from './dco'
export * from './rules'
export * from './decision'
export * from './parity'
export * from './healthCardAdapter'
export * from './outcome'

export interface RunCommissionerHealthInput {
  snapshot: CommissionerLeagueHealthSnapshot
  userId: string
}

export interface RunCommissionerHealthDeps {
  decision: CommissionerHealthDecisionDeps
  /** When present, run the Parity Gate against the built deterministic snapshot (shadow mode). */
  shadow?: { snapshot: CommissionerLeagueHealthSnapshot }
}

export interface RunCommissionerHealthResult {
  world: CommissionerHealthWorld
  decision: Decision<CommissionerHealthAssessment>
  parity?: CommissionerHealthParityResult
}

export async function runCommissionerHealthDecision(
  input: RunCommissionerHealthInput,
  deps: RunCommissionerHealthDeps,
): Promise<RunCommissionerHealthResult> {
  const world = resolveCommissionerHealthWorld({ snapshot: input.snapshot })
  const dco = buildCommissionerHealthDCO({ world, userId: input.userId })
  const decision = await decideCommissionerHealth(dco, deps.decision)

  let parity: CommissionerHealthParityResult | undefined
  if (deps.shadow) {
    parity = compareCommissionerHealthParity(decision, deps.shadow.snapshot)
    emitShadowParity(
      'commissioner.league.health',
      {
        legacy_shadow_compared: true,
        wrap_fidelity: true,
        decider_scope: 'commissioner',
        parity_passed: parity.passed,
        parity_failed: !parity.passed,
        diffs: parity.diffs.length,
        userId: input.userId,
        leagueId: input.snapshot.leagueId,
      },
      decision.decision_id,
    )
  }

  return { world, decision, parity }
}
