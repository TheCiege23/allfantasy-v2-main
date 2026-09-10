/**
 * The EFL integration seam: resolver decides, canonical engine applies.
 *
 * 🛑 THIS IS THE ONLY PLACE THE TWO HALVES MEET, AND IT DELIBERATELY CONTAINS NO RULES.
 * `resolveEflSeasonTransitions` owns competition policy (which playoff decides which place);
 * `runPromotionRelegation` owns the mutation. This function moves a settled plan from one to the
 * other and refuses to move an unsettled one. Nothing about tiers, playoffs or draft order lives
 * here, and nothing about them was added to `PromotionEngine`.
 *
 * 🛑 AN UNSETTLED PLAN IS NEVER APPLIED. `finalTransitions` is null while any playoff is pending or
 * any input contradicts another, and this refuses on exactly that. Applying half a ladder moves some
 * teams and strands others in a tier that no longer has room — and `leagueTeam.update` is
 * last-write-wins, so nothing downstream would notice.
 */

import { runPromotionRelegation, type RunPromotionResult } from '@/lib/promotion-relegation/PromotionEngine'
import {
  resolveEflSeasonTransitions,
  type ResolveEflSeasonTransitionsInput,
} from '@/lib/commissioner-os/efl/seasonTransitionResolver'
import type { EflSeasonTransitionPlan } from '@/lib/commissioner-os/efl/types'

export type ApplyEflSeasonTransitionsInput = ResolveEflSeasonTransitionsInput & {
  /** Plan only, mutate nothing. Passed straight through to the canonical engine. */
  dryRun?: boolean
}

export type ApplyEflSeasonTransitionsResult = {
  plan: EflSeasonTransitionPlan
  /** Null when the plan was not settled, so nothing was handed to the engine. */
  applied: RunPromotionResult | null
  refusedReason: string | null
}

export async function applyEflSeasonTransitions(
  input: ApplyEflSeasonTransitionsInput,
): Promise<ApplyEflSeasonTransitionsResult> {
  const plan = resolveEflSeasonTransitions(input)

  if (!plan.finalTransitions) {
    /*
     * ⚠ THE REASON NAMES WHAT IS OUTSTANDING RATHER THAN SAYING "not ready". A commissioner looking
     * at this in the final week needs to know it is the League 1 relegation playoff, not that
     * something unspecified is missing.
     */
    const reasons = [...plan.unresolvedReasons, ...plan.conflicts]
    return {
      plan,
      applied: null,
      refusedReason: reasons.length
        ? reasons.join(' ')
        : 'The season transition plan is not settled.',
    }
  }

  const applied = await runPromotionRelegation({
    leagueId: input.leagueId,
    dryRun: input.dryRun,
    /* The canonical engine validates this again — ids, direction, duplicates — before any write. */
    transitions: plan.finalTransitions,
  })

  return { plan, applied, refusedReason: null }
}
