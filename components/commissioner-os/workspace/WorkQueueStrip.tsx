'use client'

import type { WorkspaceQueueDefinition } from '@/lib/commissioner-ui/workspace/queues'
import type { CommissionerTask } from '@/lib/commissioner-ui/workspace/decision-os-client'

export interface WorkQueueStripProps {
  queues: WorkspaceQueueDefinition[]
  tasks: CommissionerTask[]
  activeQueueId: string
  onSelectQueue: (id: string) => void
}

/** Same tablist interaction pattern as Recommendations Center's Queue/History toggle, extended to 10 queues with live counts. */
export function WorkQueueStrip({ queues, tasks, activeQueueId, onSelectQueue }: WorkQueueStripProps) {
  return (
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Work queues">
      {queues.map((queue) => {
        const count = queue.filter(tasks).length
        const isActive = queue.id === activeQueueId
        return (
          <button
            key={queue.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelectQueue(queue.id)}
            className="focus-ring shrink-0 whitespace-nowrap rounded-[var(--radius-standard)] px-3 py-1.5 text-sm font-medium"
            style={{
              background: isActive ? 'var(--panel2)' : 'transparent',
              color: isActive ? 'var(--text)' : 'var(--muted)',
              border: '1px solid var(--border)',
            }}
          >
            {queue.label} <span style={{ color: 'var(--muted2)' }}>({count})</span>
          </button>
        )
      })}
    </div>
  )
}
