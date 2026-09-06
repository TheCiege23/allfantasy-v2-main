/**
 * Decision OS — `commissioner.league.health` orchestrator + barrel (Slice 4).
 *
 * Pure end-to-end thread: World Resolution (read-only) → DCO (read-only) → Decision (DCO-only) →
 * optional Parity (shadow, wrap-fidelity). No prisma here — the server-authoritative assembler
 * provides the built snapshot. ASSESSMENT ONLY — the Decision OS never executes a commissioner action.
 */
import type { Decision } from '@/lib/decision-os/core/decision'
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
    // 🛑 THE PARITY RESULT IS RETURNED, NOT EMITTED — the emit moved to `runCommissionerHealthShadow`.
    // This used to fire `emitShadowParity` with `{ legacy_shadow_compared: true, parity_passed }` and
    // NO `ran` key. `flipReadiness` counts a comparison only when `flags.ran === true`; everything
    // else falls to the skip branch under reason 'unknown'.
    //
    // That made this surface UNCOUNTABLE, not merely noisy. `runCommissionerHealthShadow` emitted
    // only on its two FAILURE paths, so the orchestrator's `ran`-less event was the sole record of a
    // successful comparison — and the gate discarded every one. Measured in production before the
    // move: 80 rows, every one agreeing, every one filed as a skip, readiness `no_signal`. No amount
    // of traffic could have changed that.
    //
    // ⚠ The emit belongs in the shadow wrapper because that is the layer that knows the run WAS a
    // shadow. An emit here cannot: `grounding/decisionBridge` calls this decider directly with no
    // `shadow` dep (see its header), and a future caller doing the same must not be reported as a
    // parity comparison. Same reasoning as the lineup slice.
    parity = compareCommissionerHealthParity(decision, deps.shadow.snapshot)
  }

  return { world, decision, parity }
}
