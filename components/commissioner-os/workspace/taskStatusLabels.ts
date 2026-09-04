import type { CommissionerTaskStatus } from '@/lib/commissioner-ui/workspace/decision-os-client'

/** Workflow-neutral labels — status is never severity-colored, the same rule Recommendations Center's STATUS_LABELS follows. */
export const TASK_STATUS_LABELS: Record<CommissionerTaskStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting_on_manager: 'Waiting on Manager',
  waiting_on_league_vote: 'Waiting on League Vote',
  completed: 'Completed',
  archived: 'Archived',
}

/**
 * Represented, not fully implemented — same precedent as
 * RecommendationCard's primaryActionLabel button: rendered so the
 * lifecycle is visible and the affordance is real, but not wired to a
 * backend mutation since none exists yet.
 */
export const TASK_NEXT_ACTION_LABEL: Record<CommissionerTaskStatus, string> = {
  open: 'Mark In Progress',
  in_progress: 'Mark Completed',
  waiting_on_manager: 'Follow Up',
  waiting_on_league_vote: 'Follow Up',
  completed: 'Reopen',
  archived: 'Reopen',
}
