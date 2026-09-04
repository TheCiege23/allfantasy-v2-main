import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getSeverityStyle, SEVERITY_LABELS } from '@/components/commissioner-os/cards'
import { TASK_STATUS_LABELS } from './taskStatusLabels'
import type { CommissionerTask } from '@/lib/commissioner-ui/workspace/decision-os-client'

export interface TaskListItemProps {
  task: CommissionerTask
  onOpen: () => void
}

/** Composes the shared Card/Badge primitives — priority renders as the colored severity badge, status as a neutral pill, kept visually distinct. */
export function TaskListItem({ task, onOpen }: TaskListItemProps) {
  const style = getSeverityStyle(task.priority)

  return (
    <Card style={{ borderColor: style.border }}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={onOpen} className="focus-ring link-themed text-left">
            <CardTitle>{task.title}</CardTitle>
          </button>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: 'var(--panel2)', color: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              {TASK_STATUS_LABELS[task.status]}
            </span>
            <Badge style={{ background: style.bg, color: style.text, borderColor: style.border }}>{SEVERITY_LABELS[task.priority]}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {task.description}
        </p>
        {task.dueAt && (
          <p className="mt-1 text-xs" style={{ color: 'var(--muted2)' }}>
            Due {new Date(task.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
