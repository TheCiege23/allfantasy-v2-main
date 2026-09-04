'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/commissioner-os/states'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import { ReportTemplateCard } from './ReportTemplateCard'
import { ReportDetailDialog } from './ReportDetailDialog'
import { REPORT_STATUS_LABELS, REPORT_FORMAT_LABELS } from './reportsLabels'
import type { CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'
import type { GeneratedReport, ReportTemplate } from '@/lib/commissioner-ui/reports/decision-os-client'

export interface ReportsViewProps {
  templates: ReportTemplate[]
  history: GeneratedReport[]
  dataMode: CommissionerDataMode
  errorMessage?: string | null
}

/**
 * Reports owns scheduled reports, generation, PDF/CSV export, templates,
 * history, status, sharing, and metadata — but per the module's own
 * placeholder description, it never holds a second copy of the
 * underlying data. Every `GeneratedReport` carries a human-readable
 * `summary` and `relatedLinks` back to its real owner, never the raw
 * data itself.
 *
 * "Generate Report" is a real, local-state interaction (not a
 * represented-but-unwired button) — it adds a `generating` entry to
 * history that transitions to `ready` after a short simulated delay,
 * the same "Demo Mode should look and behave convincingly" reasoning
 * Automation Center's enable/disable toggle already established.
 */
export function ReportsView({ templates, history: initialHistory, dataMode, errorMessage }: ReportsViewProps) {
  const [history, setHistory] = useState(initialHistory)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)

  function handleGenerate(template: ReportTemplate) {
    const id = `local-${Date.now()}`
    const newReport: GeneratedReport = {
      id,
      templateId: template.id,
      templateName: template.name,
      status: 'generating',
      format: 'pdf',
      generatedAt: new Date().toISOString(),
      generatedByLabel: 'You',
      summary: `Generating ${template.name.toLowerCase()}…`,
      sizeLabel: '—',
      shareStatus: 'private',
      relatedLinks: [],
    }
    setHistory((prev) => [newReport, ...prev])
    setTimeout(() => {
      setHistory((prev) =>
        prev.map((report) =>
          report.id === id
            ? { ...report, status: 'ready', summary: `${template.name} generated successfully.`, sizeLabel: '128 KB' }
            : report
        )
      )
    }, 2000)
  }

  function handleToggleShare(reportId: string) {
    setHistory((prev) =>
      prev.map((report) =>
        report.id === reportId
          ? {
              ...report,
              shareStatus: report.shareStatus === 'shared' ? 'private' : 'shared',
              shareLink: report.shareStatus === 'shared' ? undefined : `https://allfantasy.ai/r/${report.id}`,
            }
          : report
      )
    )
  }

  const selectedReport = history.find((report) => report.id === selectedReportId) ?? null

  return (
    <div>
      <PreviewDataBanner mode={dataMode} />

      {errorMessage ? (
        <ErrorState message={errorMessage} />
      ) : (
        <div className="space-y-6">
          <section aria-labelledby="reports-templates-heading">
            <h2 id="reports-templates-heading" className="mb-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
              Report Templates
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {templates.map((template) => (
                <ReportTemplateCard
                  key={template.id}
                  template={template}
                  onGenerate={() => handleGenerate(template)}
                  disabled={history.some((report) => report.templateId === template.id && report.status === 'generating')}
                />
              ))}
            </div>
          </section>

          <section aria-labelledby="reports-history-heading">
            <h2 id="reports-history-heading" className="mb-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
              Report History
            </h2>
            {history.length === 0 ? (
              <EmptyState icon={FileText} title="No reports yet." description="Generate a report above to see it here." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Generated</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell>{report.templateName}</TableCell>
                      <TableCell>{REPORT_STATUS_LABELS[report.status]}</TableCell>
                      <TableCell>{REPORT_FORMAT_LABELS[report.format]}</TableCell>
                      <TableCell>{new Date(report.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => setSelectedReportId(report.id)}>
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>
      )}

      <ReportDetailDialog
        report={selectedReport}
        onOpenChange={(open) => {
          if (!open) setSelectedReportId(null)
        }}
        onToggleShare={handleToggleShare}
      />
    </div>
  )
}
