'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getSeverityStyle, SEVERITY_LABELS } from '@/components/commissioner-os/cards'
import { TASK_STATUS_LABELS, TASK_NEXT_ACTION_LABEL } from './taskStatusLabels'
import type { CommissionerTask } from '@/lib/commissioner-ui/workspace/decision-os-client'

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

  return (
    <Dialog open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {displayedTask && style && (
          <>
            <DialogHeader>
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ background: 'var(--panel2)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                >
                  {TASK_STATUS_LABELS[displayedTask.status]}
                </span>
                <Badge style={{ background: style.bg, color: style.text, borderColor: style.border }}>
                  {SEVERITY_LABELS[displayedTask.priority]}
                </Badge>
              </div>
              <DialogTitle>{displayedTask.title}</DialogTitle>
              <DialogDescription>{displayedTask.description}</DialogDescription>
            </DialogHeader>

            {displayedTask.dueAt && (
              <p className="text-sm" style={{ color: 'var(--text)' }}>
                Due {new Date(displayedTask.dueAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            )}

            {displayedTask.relatedLinks.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted2)' }}>
                  Related evidence
                </h3>
                <ul className="space-y-1">
                  {displayedTask.relatedLinks.map((link) => (
                    <li key={link.href + link.label}>
                      <Link href={link.href} className="focus-ring link-themed text-sm">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <DialogFooter>
              <Button size="sm">{TASK_NEXT_ACTION_LABEL[displayedTask.status]}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
