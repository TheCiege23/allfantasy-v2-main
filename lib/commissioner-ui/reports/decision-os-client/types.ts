import type { CommissionerPlatformResponse, CommissionerRelatedLink } from '../../contracts'

/**
 * Reports owns scheduled reports, executive report generation, PDF/CSV
 * export, templates, history, status, sharing, and metadata. Per the
 * module's own placeholder description: "Scheduled, shareable,
 * printable packaging of intelligence already owned elsewhere — never a
 * second copy of the underlying data." A `GeneratedReport` therefore
 * carries a human-readable `summary` and `relatedLinks` back to its
 * source modules — never a duplicated copy of League Health's score
 * history, Analytics' snapshot, or any other module's raw data.
 */
export type ReportCategory = 'season_recap' | 'engagement' | 'transactions' | 'commissioner_digest'

export type ReportFrequency = 'weekly' | 'monthly' | 'manual'

export type ReportStatus = 'queued' | 'generating' | 'ready' | 'failed'

export type ReportFormat = 'pdf' | 'csv'

export type ReportShareStatus = 'private' | 'shared'

export interface ReportSchedule {
  frequency: ReportFrequency
  /** Only meaningful when `frequency !== 'manual'`. */
  nextRunAt?: string
}

export interface ReportTemplate {
  id: string
  name: string
  description: string
  category: ReportCategory
  /** Which modules' intelligence this template packages — never embedded, only referenced. */
  sourceModuleIds: string[]
  schedule: ReportSchedule
}

export interface GeneratedReport {
  id: string
  templateId: string
  templateName: string
  status: ReportStatus
  format: ReportFormat
  generatedAt: string
  generatedByLabel: string
  /** A human-readable description of what the report contains — not the underlying data itself. */
  summary: string
  sizeLabel: string
  shareStatus: ReportShareStatus
  shareLink?: string
  /** Links back to the modules whose intelligence this report packaged. */
  relatedLinks: CommissionerRelatedLink[]
  /** Only present when `status === 'failed'`. */
  failureReason?: string
}

/** The only shape Mission Control ever sees — computed by Reports over its own templates/history, never by Mission Control. */
export interface ReportsSummary {
  headline: string
  scheduledCount: number
  readyCount: number
}

export interface ReportsClient {
  getTemplates(): Promise<CommissionerPlatformResponse<ReportTemplate[]>>
  getHistory(): Promise<CommissionerPlatformResponse<GeneratedReport[]>>
  getSummary(): Promise<CommissionerPlatformResponse<ReportsSummary>>
}
