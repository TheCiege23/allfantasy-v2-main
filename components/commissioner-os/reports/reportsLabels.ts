import type { ReportCategory, ReportFormat, ReportFrequency, ReportStatus } from '@/lib/commissioner-ui/reports/decision-os-client'

/** Workflow-neutral — status is never severity-colored, the same rule every other module's status vocabulary follows. */
export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  queued: 'Queued',
  generating: 'Generating',
  ready: 'Ready',
  failed: 'Failed',
}

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  season_recap: 'Season Recap',
  engagement: 'Engagement',
  transactions: 'Transactions',
  commissioner_digest: 'Commissioner Digest',
}

export const REPORT_FREQUENCY_LABELS: Record<ReportFrequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  manual: 'Manual only',
}

export const REPORT_FORMAT_LABELS: Record<ReportFormat, string> = {
  pdf: 'PDF',
  csv: 'CSV',
}
