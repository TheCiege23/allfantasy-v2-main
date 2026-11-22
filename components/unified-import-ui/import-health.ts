/**
 * Phase 4.2 — Import health / completeness derivation.
 *
 * Pure function → unit-testable. Derives a status pill for the post-import UI
 * from real inputs only: the import run's status/progress and the persisted
 * `ImportWarning` counts by severity. No fabricated metrics.
 *
 * Aligns with the Dashboard V2 color grammar (Recommend emerald · Monitor amber ·
 * critical red · neutral white).
 */

type ImportHealthStatus = 'healthy' | 'attention' | 'incomplete' | 'failed' | 'pending'

export interface ImportHealthInput {
  /** Latest run's status when known. */
  runStatus?: 'running' | 'completed' | 'failed' | null
  /** Latest run's reported progress (0..100). */
  progress?: number | null
  /** Count of persisted `ImportWarning` rows by severity. */
  warningCounts?: { error?: number; warn?: number; info?: number } | null
}

interface ImportHealthResult {
  status: ImportHealthStatus
  label: string
  tone: 'positive' | 'caution' | 'critical' | 'neutral'
  /** Short explanation the UI can render as helper text. */
  detail: string
}

/**
 * Derive a status pill for the post-import UI.
 *
 * Precedence: failed run > error warnings > incomplete run > warn warnings > healthy.
 */
export function deriveImportHealth(input: ImportHealthInput): ImportHealthResult {
  const wc = input.warningCounts ?? {}
  const errorCount = wc.error ?? 0
  const warnCount = wc.warn ?? 0

  if (input.runStatus === 'failed') {
    return {
      status: 'failed',
      label: 'Import failed',
      tone: 'critical',
      detail: 'The import did not complete. Try again or contact support.',
    }
  }

  if (input.runStatus === 'running') {
    return {
      status: 'pending',
      label: 'Still importing',
      tone: 'neutral',
      detail: `In progress — ${Math.round(Math.max(0, Math.min(100, input.progress ?? 0)))}%.`,
    }
  }

  if (errorCount > 0) {
    return {
      status: 'failed',
      label: 'Errors detected',
      tone: 'critical',
      detail: `${errorCount} import error${errorCount === 1 ? '' : 's'} recorded. Review before continuing.`,
    }
  }

  const isIncompleteProgress =
    typeof input.progress === 'number' && input.progress > 0 && input.progress < 100
  if (isIncompleteProgress) {
    return {
      status: 'incomplete',
      label: 'Partial import',
      tone: 'caution',
      detail: 'Some data is still syncing in the background — dashboard will refresh when ready.',
    }
  }

  if (warnCount > 0) {
    return {
      status: 'attention',
      label: 'Needs attention',
      tone: 'caution',
      detail: `${warnCount} warning${warnCount === 1 ? '' : 's'} recorded — data is usable but not perfectly clean.`,
    }
  }

  return {
    status: 'healthy',
    label: 'Import healthy',
    tone: 'positive',
    detail: 'All resources fetched cleanly. Your data is ready.',
  }
}
