/**
 * Build and aggregate import error reports. Deterministic; no AI.
 */

import type { ImportErrorReport } from './types'

export function createEmptyReport(): ImportErrorReport {
  return { errors: [], warnings: [], canProceed: true }
}

export function addError(
  report: ImportErrorReport,
  code: string,
  message: string,
  field?: string
): void {
  report.errors.push({ code, message, field, severity: 'error' })
  report.canProceed = false
}

export function addWarning(
  report: ImportErrorReport,
  code: string,
  message: string,
  field?: string
): void {
  report.warnings.push({ code, message, field, severity: 'warning' })
}

export function mergeReports(target: ImportErrorReport, source: ImportErrorReport): void {
  target.errors.push(...source.errors)
  target.warnings.push(...source.warnings)
  if (!source.canProceed) target.canProceed = false
}

