import type { CommissionerPlatformResponse, CommissionerRelatedLink } from '../../contracts'
import type { SeverityTier } from '../../tokens/colors'

/**
 * Automation Center owns the automation catalog, its enablement status,
 * schedules/triggers, execution history and details, and health
 * indicators. Mission Control never computes any of this — it consumes
 * only `getSummary()`'s small aggregate. Per the Commissioner OS Canon,
 * nothing here ever represents a trade approval, member removal, or rule
 * ratification — those consequential, judgment-based actions can never
 * be automated; every catalog entry is a repetitive, low-stakes task
 * (waiver housekeeping, reminders, digests, scheduling nudges).
 */
export type AutomationStatus = 'enabled' | 'disabled'

/** Health is a severity signal ("how well is this currently running"), always visually distinct from status ("is this turned on"). */
export type AutomationTriggerType = 'schedule' | 'event' | 'manual'

export type AutomationCategory = 'waiver_management' | 'communications' | 'compliance_reminders' | 'scheduling'

export type AutomationExecutionResult = 'success' | 'failure' | 'skipped'

export interface AutomationSchedule {
  triggerType: AutomationTriggerType
  /** Human-readable description of the trigger, e.g. "Every Tuesday at 9:00 AM" or "When a waiver claim is submitted." */
  description: string
  /** Only meaningful for `triggerType: 'schedule'`. */
  nextRunAt?: string
}

export interface AutomationCatalogEntry {
  id: string
  name: string
  description: string
  category: AutomationCategory
  status: AutomationStatus
  health: SeverityTier
  schedule: AutomationSchedule
  lastRunAt?: string
  lastRunResult?: AutomationExecutionResult
  totalRunsCount: number
  successRatePercent: number
  relatedLinks: CommissionerRelatedLink[]
}

export interface AutomationExecutionEntry {
  id: string
  automationId: string
  startedAt: string
  durationMs: number
  result: AutomationExecutionResult
  /** Compact, shown in the execution history list. */
  summary: string
  /** Fuller explanation, shown only in the execution detail view. */
  detail: string
}

/** The only shape Mission Control ever sees — an aggregate Automation Center computes over its own catalog, never Mission Control's own computation. */
export interface AutomationSummary {
  totalCount: number
  activeCount: number
  needsAttentionCount: number
  headline: string
}

export interface AutomationClient {
  getCatalog(): Promise<CommissionerPlatformResponse<AutomationCatalogEntry[]>>
  getExecutionHistory(automationId: string): Promise<CommissionerPlatformResponse<AutomationExecutionEntry[]>>
  getSummary(): Promise<CommissionerPlatformResponse<AutomationSummary>>
}
