'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/commissioner-os/states'
import { StackedBarChart, InfoCard } from '@/components/commissioner-os/cards'
import { reportOutcomesByTemplate, REPORT_OUTCOME_SERIES } from '@/lib/commissioner-ui/charts/deriveChartSeries'
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
 * "Generate Report" behaves DIFFERENTLY BY DATA MODE, and that split is the point.
 *
 * In stub/demo it stays the local simulation it always was — a `generating` entry that flips to
 * `ready` after a short delay — which is the "Demo Mode should look and behave convincingly"
 * reasoning Automation Center's toggle already established, and which is honest there because
 * every row on the page is a fixture.
 *
 * 🛑 IN LIVE MODE IT CALLS THE REAL GENERATOR, because the simulation stopped being honest the
 * moment the history became real. Its fabricated row carried a hard-coded `sizeLabel: '128 KB'`
 * and sat in the same table as genuine artifacts, indistinguishable from them. A real list beside
 * a button that invents entries is worse than the honest error this module used to return.
 */
export function ReportsView({ templates, history: initialHistory, dataMode, errorMessage }: ReportsViewProps) {
  const [history, setHistory] = useState(initialHistory)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)

  const router = useRouter()
  const [isGenerating, startGenerating] = useTransition()
  const [generateError, setGenerateError] = useState<string | null>(null)
  /*
   * From the `history` STATE rather than the `initialHistory` prop, so generating a report updates the
   * chart along with the table. Reading the prop would leave the two disagreeing until a reload.
   */
  const outcomeRows = useMemo(() => reportOutcomesByTemplate(history), [history])

  async function handleGenerateLive(template: ReportTemplate) {
    setGenerateError(null)
    try {
      const res = await fetch('/api/commissioner-os/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: template.id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setGenerateError(body?.error ?? `Generation failed (${res.status}).`)
        return
      }
      const body = await res.json()
      if (body?.status === 'failed') {
        // The run happened and was recorded; the history row carries the reason. Say so rather
        // than reporting success over a report that does not exist.
        setGenerateError(body?.failureReason ?? 'The report could not be generated.')
      }
      // The server owns the history, so re-read it rather than guessing what it now contains.
      startGenerating(() => router.refresh())
    } catch {
      setGenerateError('Generation failed — the request did not complete.')
    }
  }

  function handleGenerate(template: ReportTemplate) {
    if (dataMode === 'live') {
      void handleGenerateLive(template)
      return
    }
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

      {/*
        * Runs per template, split by outcome. Horizontal because template names are sentences and
        * would collide on an x-axis; stacked because "which template is failing" is a comparison
        * inside each template's own total.
        */}
      {outcomeRows.length > 0 ? (
        <div className="mb-6">
          <InfoCard title="Report runs by template">
            <StackedBarChart
              rows={outcomeRows}
              layout="horizontal"
              height={Math.max(160, outcomeRows.length * 44 + 60)}
              ariaLabel="Report generation runs per template, split into ready, generating and failed"
              series={[
                { id: 'ready', label: 'Ready', color: 'var(--accent-emerald-strong)' },
                { id: 'generating', label: 'Generating', color: 'var(--accent-cyan-strong)' },
                { id: 'failed', label: 'Failed', color: 'var(--accent-red-strong)' },
              ]}
            />
          </InfoCard>
        </div>
      ) : null}

      {errorMessage ? (
        <ErrorState message={errorMessage} />
      ) : (
        <div className="space-y-6">
          <section aria-labelledby="reports-templates-heading">
            <h2 id="reports-templates-heading" className="mb-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
              Report Templates
            </h2>
            {generateError ? (
              <p className="mb-2 text-sm" role="alert" style={{ color: 'var(--accent-red-strong)' }}>
                {generateError}
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {templates.map((template) => (
                <ReportTemplateCard
                  key={template.id}
                  template={template}
                  onGenerate={() => handleGenerate(template)}
                  disabled={
                    isGenerating ||
                    history.some((report) => report.templateId === template.id && report.status === 'generating')
                  }
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
