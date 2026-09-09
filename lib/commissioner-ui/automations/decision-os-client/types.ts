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

/*
 * `reporting` was added when `reports.generateScheduled` — a real job with a handler, a schedule
 * and 121 ledger runs — turned out to have no category that described it. The alternatives were
 * both wrong in a way a commissioner would notice: `communications` implies the report was sent to
 * someone, and it is filed rather than sent; `scheduling` describes when a thing runs, not what it
 * does. The union is the honest place to fix that, and `AUTOMATION_CATEGORY_LABELS` is a `Record`,
 * so the compiler requires a label for every member and this cannot drift into an unlabelled state.
 */
export type AutomationCategory =
  | 'waiver_management'
  | 'communications'
  | 'compliance_reminders'
  | 'scheduling'
  | 'reporting'

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
  /**
   * The outcome breakdown behind `successRatePercent`, so a chart can show the shape of a job's
   * history rather than one derived percentage.
   *
   * ⚠ `skipped` IS NOT A FAILURE AND IS NOT IN `successRatePercent`'S DENOMINATOR. A skip is the
   * idempotency guard doing its job — the same window's work already done. `waivers.processLeague`
   * on production is 2 completed, 0 failed, 249 skipped: a chart that stacked skips as failures
   * would paint a job that has never failed once as catastrophic, and a chart that hid them would
   * lose the fact that it has barely attempted anything. Both belong, distinguished.
   */
  runOutcomes: { succeeded: number; failed: number; skipped: number }
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
