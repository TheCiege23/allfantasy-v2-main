'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getSeverityStyle, SEVERITY_LABELS } from '@/components/commissioner-os/cards'
import { TASK_STATUS_LABELS, TASK_NEXT_ACTION_LABEL } from './taskStatusLabels'
import type { CommissionerTask } from '@/lib/commissioner-ui/workspace/decision-os-client'
import { longDate } from '@/components/commissioner-os/primitives/pinnedTime'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { cosLinkText, taskText, workspaceCopy } from '@/lib/commissioner-os/i18n/analyticsCopy'
import { taskPriorityLabelText } from '@/lib/commissioner-os/i18n/cardsCopy'

export interface TaskDetailDrawerProps {
  task: CommissionerTask | null
  onOpenChange: (open: boolean) => void
}

/**
 * Kept mounted with `open` toggling (rather than conditionally rendering
 * the whole Dialog) so Radix's close animation plays instead of the
 * content vanishing instantly. `displayedTask` retains the last non-null
 * task through that close animation, since the parent nulls the
 * selection immediately on close.
 */
export function TaskDetailDrawer({ task, onOpenChange }: TaskDetailDrawerProps) {
  const [displayedTask, setDisplayedTask] = useState<CommissionerTask | null>(task)

  useEffect(() => {
    if (task) setDisplayedTask(task)
  }, [task])

  const style = displayedTask ? getSeverityStyle(displayedTask.priority) : null
  const { language } = useOptionalLanguage()
  const es = workspaceCopy(language)

  return (
    <Dialog open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {displayedTask && style && (
          <>
            <DialogHeader>
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                  style={{ background: 'var(--panel2)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                >
                  {es ? es.status[displayedTask.status] : TASK_STATUS_LABELS[displayedTask.status]}
                </span>
                <Badge style={{ background: style.bg, color: style.text, borderColor: style.border }}>
                  {taskPriorityLabelText(displayedTask.priority, SEVERITY_LABELS[displayedTask.priority], language)}
                </Badge>
              </div>
              <DialogTitle>{taskText(displayedTask.title, language)}</DialogTitle>
              <DialogDescription>{taskText(displayedTask.description, language)}</DialogDescription>
            </DialogHeader>

            {displayedTask.dueAt && (
              <p className="text-sm" style={{ color: 'var(--text)' }}>
                {es ? es.due(longDate(displayedTask.dueAt, language)) : `Due ${longDate(displayedTask.dueAt)}`}
              </p>
            )}

            {displayedTask.relatedLinks.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted2)' }}>
                  {es ? es.relatedEvidence : 'Related evidence'}
                </h3>
                <ul className="space-y-1">
                  {displayedTask.relatedLinks.map((link) => (
                    <li key={link.href + link.label}>
                      <Link href={link.href} className="focus-ring link-themed text-sm">
                        {cosLinkText(link.label, language)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <DialogFooter>
              <Button size="sm">{es ? es.nextAction[displayedTask.status] : TASK_NEXT_ACTION_LABEL[displayedTask.status]}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
