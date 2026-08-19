/**
 * Decision OS — outcome/learning hooks for `manager.waiver.claim` (Slice 2 PLACEHOLDERS).
 *
 * Minimal no-op hooks marking the Outcome → Learning seam (Art. on the learning loop). The real
 * wiring reuses existing systems later: waiverTransaction (won/lost, FAAB spent) + recordAfLearningEvent.
 * Nothing is built now; these exist so the loop has explicit attachment points and the contract is
 * visible. None of these execute claims.
 */
import type { Decision } from '@/lib/decision-os/core/decision'
import type { WaiverClaimRecommendation } from './decision'

export interface WaiverOutcomeHooks {
  onClaimRecommended?: (decisionId: string, top: WaiverClaimRecommendation | null) => void
  onClaimSubmitted?: (decisionId: string, addPlayerId: string) => void
  onClaimResolved?: (decisionId: string, result: 'won' | 'lost' | 'failed') => void
  onFaabReconciled?: (decisionId: string, recommendedBid: number | null, actualBid: number | null) => void
}

/** No-op by default. A later slice reuses waiverTransaction + recordAfLearningEvent. */
export function recordWaiverDecisionOutcome(
  decision: Decision<WaiverClaimRecommendation>,
  hooks: WaiverOutcomeHooks = {},
): void {
  hooks.onClaimRecommended?.(decision.decision_id, decision.recommended_actions[0] ?? null)
}
