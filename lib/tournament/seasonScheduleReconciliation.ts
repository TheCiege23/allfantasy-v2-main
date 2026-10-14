import type { SeasonScheduleChange } from './seasonScheduleDrift'

export type SeasonReconciliationPreview = {
  gameId: string
  case: 'period_change' | 'time_change' | 'cancellation' | 'identity_change' | 'feed_conflict'
  requiresActualStartEvidence: true
  requiresReceiptReview: true
  canApplyAutomatically: false
  steps: string[]
}

/** A decision checklist, never an actual-start attestation or permission to alter score receipts. */
export function previewSeasonScheduleReconciliation(change: SeasonScheduleChange): SeasonReconciliationPreview {
  const common = ['Verify actual game start from an authoritative event source; scheduled tipoff alone is insufficient.', 'Audit locked lineups, ingested scores, and finalized weeks before any correction. Preserve original receipts.']
  if (change.kind === 'postponed' || change.kind === 'rescheduled') {
    const changedPeriod = change.currentScheduledPeriod !== change.publishedPeriod
    return { gameId: change.gameId, case: changedPeriod ? 'period_change' : 'time_change', requiresActualStartEvidence: true, requiresReceiptReview: true, canApplyAutomatically: false,
      steps: [...common, changedPeriod ? 'Hold scoring across both periods. Review lineup-lock eligibility and the published rules before any period transfer.' : 'Check whether the new time changes the lineup lock; keep scoring held until the lock decision is reviewed.'] }
  }
  if (change.kind === 'canceled') return { gameId: change.gameId, case: 'cancellation', requiresActualStartEvidence: true, requiresReceiptReview: true, canApplyAutomatically: false,
    steps: [...common, 'Review any scored lines and finalization before excluding this game; do not silently erase points.'] }
  if (change.kind === 'replaced' || change.kind === 'new_game') return { gameId: change.gameId, case: 'identity_change', requiresActualStartEvidence: true, requiresReceiptReview: true, canApplyAutomatically: false,
    steps: [...common, 'Verify the replacement or new provider game identity before attaching players or scores.'] }
  return { gameId: change.gameId, case: 'feed_conflict', requiresActualStartEvidence: true, requiresReceiptReview: true, canApplyAutomatically: false,
    steps: [...common, 'Resolve missing, conflicting, or unclassified provider schedule rows before scoring.'] }
}
