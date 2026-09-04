'use client'

import { useState } from 'react'
import NextLink from 'next/link'
import { Download, Link as LinkIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { downloadReportCsv, downloadReportPdf } from '@/lib/commissioner-ui/reports/exportUtils'
import { REPORT_STATUS_LABELS, REPORT_FORMAT_LABELS } from './reportsLabels'
import type { GeneratedReport } from '@/lib/commissioner-ui/reports/decision-os-client'

export interface ReportDetailDialogProps {
  report: GeneratedReport | null
  onOpenChange: (open: boolean) => void
  onToggleShare: (reportId: string) => void
}

/**
 * Export and share are real, working, client-side actions — not
 * represented-but-unwired affordances — because both operate purely on
 * this report's own already-fetched metadata/summary. Neither needs a
 * Decision OS backend: exporting serializes data already in memory
 * (reusing the shared `lib/commissioner-ui/utils/csv` primitives and
 * `jspdf`, already a project dependency); sharing toggles local state
 * and copies an already-known link to the clipboard.
 */
export function ReportDetailDialog({ report, onOpenChange, onToggleShare }: ReportDetailDialogProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopyLink(link: string) {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={report !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {report && (
          <>
            <DialogHeader>
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ background: 'var(--panel2)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                >
                  {REPORT_STATUS_LABELS[report.status]}
                </span>
                <span className="text-xs" style={{ color: 'var(--muted2)' }}>
                  {REPORT_FORMAT_LABELS[report.format]} · {report.sizeLabel}
                </span>
              </div>
              <DialogTitle>{report.templateName}</DialogTitle>
              <DialogDescription>{report.summary}</DialogDescription>
            </DialogHeader>

            {report.status === 'failed' && report.failureReason && (
              <p className="text-sm" role="alert" style={{ color: 'var(--severity-critical-text)' }}>
                {report.failureReason}
              </p>
            )}

            <p className="text-xs" style={{ color: 'var(--muted2)' }}>
              Generated {new Date(report.generatedAt).toLocaleString()} by {report.generatedByLabel}
            </p>

            {report.relatedLinks.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted2)' }}>
                  Related evidence
                </h3>
                <ul className="space-y-1">
                  {report.relatedLinks.map((link) => (
                    <li key={link.href + link.label}>
                      <NextLink href={link.href} className="focus-ring link-themed text-sm">
                        {link.label}
                      </NextLink>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.status === 'ready' && (
              <>
                {report.shareStatus === 'shared' && report.shareLink && (
                  <div className="flex items-center gap-2 rounded-[var(--radius-standard)] border p-2 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                    <LinkIcon size={12} aria-hidden />
                    <span className="truncate">{report.shareLink}</span>
                  </div>
                )}
                <DialogFooter className="flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => downloadReportPdf(report)}>
                    <Download size={14} aria-hidden /> Download PDF
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => downloadReportCsv(report)}>
                    <Download size={14} aria-hidden /> Download CSV
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => onToggleShare(report.id)}>
                    {report.shareStatus === 'shared' ? 'Unshare' : 'Share'}
                  </Button>
                  {report.shareStatus === 'shared' && report.shareLink && (
                    <Button size="sm" variant="ghost" onClick={() => handleCopyLink(report.shareLink!)}>
                      {copied ? 'Copied!' : 'Copy Link'}
                    </Button>
                  )}
                </DialogFooter>
              </>
            )}

            {report.status === 'failed' && (
              <DialogFooter>
                <Button size="sm" variant="outline">
                  Retry
                </Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
