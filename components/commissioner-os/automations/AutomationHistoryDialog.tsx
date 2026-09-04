'use client'

import { Fragment, useState } from 'react'
import { History } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { EmptyState } from '@/components/commissioner-os/states'
import { getSeverityStyle } from '@/components/commissioner-os/cards'
import { AUTOMATION_RESULT_LABELS } from './automationLabels'
import type { SeverityTier } from '@/lib/commissioner-ui/tokens/colors'
import type { AutomationCatalogEntry, AutomationExecutionEntry, AutomationExecutionResult } from '@/lib/commissioner-ui/automations/decision-os-client'

export interface AutomationHistoryDialogProps {
  automation: AutomationCatalogEntry | null
  history: AutomationExecutionEntry[]
  onOpenChange: (open: boolean) => void
}

const RESULT_SEVERITY: Record<AutomationExecutionResult, SeverityTier> = {
  success: 'positive',
  failure: 'critical',
  skipped: 'standard',
}

/**
 * Execution history (the compact list) and execution details (the fuller
 * per-run explanation) are deliberately distinct: the table row is the
 * history, expanding a row reveals its detail — no second nested dialog.
 */
export function AutomationHistoryDialog({ automation, history, onOpenChange }: AutomationHistoryDialogProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <Dialog open={automation !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {automation && (
          <>
            <DialogHeader>
              <DialogTitle>{automation.name} — Execution History</DialogTitle>
              <DialogDescription>{automation.schedule.description}</DialogDescription>
            </DialogHeader>

            {history.length === 0 ? (
              <EmptyState icon={History} title="No executions yet." description="This automation hasn't run yet." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((entry) => {
                    const style = getSeverityStyle(RESULT_SEVERITY[entry.result])
                    const isExpanded = expandedId === entry.id
                    return (
                      <Fragment key={entry.id}>
                        <TableRow
                          role="button"
                          tabIndex={0}
                          aria-expanded={isExpanded}
                          onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setExpandedId(isExpanded ? null : entry.id)
                            }
                          }}
                          className="focus-ring cursor-pointer"
                        >
                          <TableCell>{new Date(entry.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</TableCell>
                          <TableCell>
                            <span style={{ color: style.text }}>{AUTOMATION_RESULT_LABELS[entry.result]}</span>
                          </TableCell>
                          <TableCell>{(entry.durationMs / 1000).toFixed(1)}s</TableCell>
                          <TableCell>{entry.summary}</TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow>
                            <TableCell colSpan={4} style={{ color: 'var(--muted)' }} className="text-sm">
                              {entry.detail}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
