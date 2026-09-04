import type { CommissionerPlatformResponse, CommissionerRelatedLink } from '../../contracts'
import type { SeverityTier } from '../../tokens/colors'

/**
 * Workspace owns the task model and its lifecycle — no other module
 * constructs a CommissionerTask. Priority reuses the shared SeverityTier
 * vocabulary/coloring (Phase 0.1 tokens) rather than inventing a second
 * urgency color language; status is Workspace's own vocabulary and always
 * renders as a neutral badge, kept visually distinct from priority's
 * colored severity badge — the same status/severity split already
 * established by Recommendations Center.
 */
export type CommissionerTaskStatus =
  | 'open'
  | 'in_progress'
  | 'waiting_on_manager'
  | 'waiting_on_league_vote'
  | 'completed'
  | 'archived'

/**
 * A link back to the module whose evidence justified this task — Workspace
 * never duplicates that module's data, only points to it. Now a Platform
 * Contracts type (`CommissionerRelatedLink`, promoted once Automation
 * Center needed the identical shape) — kept as a named alias here so
 * nothing that already imports `CommissionerTaskRelatedLink` needs to
 * change.
 */
export type CommissionerTaskRelatedLink = CommissionerRelatedLink

export interface CommissionerTask {
  id: string
  title: string
  description: string
  status: CommissionerTaskStatus
  priority: SeverityTier
  createdAt: string
  updatedAt: string
  /** Absent for tasks with no operational deadline (e.g. a standing reminder). */
  dueAt?: string
  automationCandidate: boolean
  relatedLinks: CommissionerTaskRelatedLink[]
}

export interface WorkspaceClient {
  getTasks(): Promise<CommissionerPlatformResponse<CommissionerTask[]>>
}
