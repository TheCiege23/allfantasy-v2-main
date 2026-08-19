/**
 * Decision OS — `manager.waiver.claim` orchestrator + barrel (Slice 2).
 *
 * Pure end-to-end thread: World Resolution (read-only) → DCO (read-only) → Decision (DCO-only) →
 * optional Parity (shadow, wrap-fidelity). Prisma reads happen in an injected loader at the route
 * seam (loader.ts), never here — so the whole orchestrator unit-tests without a DB.
 */
import type { Decision } from '@/lib/decision-os/core/decision'
import { emitShadowParity } from '@/lib/decision-os/core/parity'
import type { WaiverAIServiceInput } from '@/lib/waiver-ai-engine'
import type { ScoredWaiverTarget } from '@/lib/waiver-engine/waiver-scoring'
import { resolveWaiverWorld, type WaiverWorld, type WaiverWorldInput } from './world'
import { buildWaiverDCO } from './dco'
import { decideWaiverClaim, type WaiverClaimRecommendation, type WaiverDecisionDeps } from './decision'
import { compareWaiverParity, type WaiverParityResult } from './parity'

export * from './world'
export * from './dco'
export * from './rules'
export * from './decision'
export * from './parity'
export * from './waiverCardAdapter'
export * from './outcome'

export interface RunWaiverClaimInput {
  worldInput: WaiverWorldInput
  userId: string
  leagueId: string
  sport: string
  rosterId: string | null
  engineInput: WaiverAIServiceInput
  poolIncomplete?: boolean
}

export interface RunWaiverClaimDeps {
  decision: WaiverDecisionDeps
  /** When present, run the Parity Gate against the legacy deterministic suggestions (shadow mode). */
  shadow?: { legacySuggestions: ScoredWaiverTarget[] }
}

export interface RunWaiverClaimResult {
  world: WaiverWorld
  decision: Decision<WaiverClaimRecommendation>
  parity?: WaiverParityResult
}

export async function runWaiverClaimDecision(input: RunWaiverClaimInput, deps: RunWaiverClaimDeps): Promise<RunWaiverClaimResult> {
  const world = resolveWaiverWorld(input.worldInput)
  const dco = buildWaiverDCO({
    world,
    userId: input.userId,
    leagueId: input.leagueId,
    sport: input.sport,
    rosterId: input.rosterId,
    engineInput: input.engineInput,
    poolIncomplete: input.poolIncomplete,
  })
  const decision = await decideWaiverClaim(dco, deps.decision)

  let parity: WaiverParityResult | undefined
  if (deps.shadow) {
    parity = compareWaiverParity(decision, deps.shadow.legacySuggestions)
    emitShadowParity(
      'manager.waiver.claim',
      {
        legacy_shadow_compared: true,
        wrap_fidelity: true,
        parity_passed: parity.passed,
        parity_failed: !parity.passed,
        diffs: parity.diffs.length,
        userId: input.userId,
        leagueId: input.leagueId,
        rosterId: input.rosterId,
      },
      decision.decision_id,
    )
  }

  return { world, decision, parity }
}
