import type { ReportCategory, ReportFormat, ReportFrequency, ReportStatus } from '@/lib/commissioner-ui/reports/decision-os-client'
import { reportsCopy } from '@/lib/commissioner-os/i18n/analyticsCopy'

/*
 * The English words now live beside their Spanish in lib/commissioner-os/i18n/analyticsCopy.ts, so the
 * two cannot drift. These names are kept for any importer that wants the English constants.
 */
const EN = reportsCopy('en')

/** Workflow-neutral — status is never severity-colored, the same rule every other module's status vocabulary follows. */
export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = EN.status

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = EN.category

export const REPORT_FREQUENCY_LABELS: Record<ReportFrequency, string> = EN.frequency

export const REPORT_FORMAT_LABELS: Record<ReportFormat, string> = {
  pdf: 'PDF',
  csv: 'CSV',
}
