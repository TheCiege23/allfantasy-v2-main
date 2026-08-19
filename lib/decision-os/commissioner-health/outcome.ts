/**
 * Decision OS — outcome/learning hooks for `commissioner.league.health` (Slice 4 PLACEHOLDERS).
 *
 * Minimal no-op hooks marking the Outcome → Learning seam. The real wiring reuses existing systems
 * later: leagueAuditLog + aiCommissionerAlert + health snapshot history (read-only). Nothing is built
 * now; these exist so the loop has explicit attachment points. NONE of these execute a commissioner
 * action, send announcements, or mutate league state.
 */
import type { Decision } from '@/lib/decision-os/core/decision'
import type { CommissionerHealthAssessment } from './decision'

export interface CommissionerHealthOutcomeHooks {
  onHealthAssessed?: (decisionId: string, assessment: CommissionerHealthAssessment | null) => void
  onCommissionerOpenedAction?: (decisionId: string, actionKey: string) => void
  onCommissionerDismissedAction?: (decisionId: string, actionKey: string) => void
  onHealthImproved?: (decisionId: string, leagueId: string, delta: number) => void
  onHealthWorsened?: (decisionId: string, leagueId: string, delta: number) => void
}

/** No-op by default. A later slice reuses audit log + alert + snapshot history (read-only). */
export function recordCommissionerHealthOutcome(
  decision: Decision<CommissionerHealthAssessment>,
  hooks: CommissionerHealthOutcomeHooks = {},
): void {
  hooks.onHealthAssessed?.(decision.decision_id, decision.recommended_actions[0] ?? null)
}
