'use client'

import type { WorkspaceQueueDefinition } from '@/lib/commissioner-ui/workspace/queues'
import type { CommissionerTask } from '@/lib/commissioner-ui/workspace/decision-os-client'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { workspaceCopy } from '@/lib/commissioner-os/i18n/analyticsCopy'

export interface WorkQueueStripProps {
  queues: WorkspaceQueueDefinition[]
  tasks: CommissionerTask[]
  activeQueueId: string
  onSelectQueue: (id: string) => void
}

/** Same tablist interaction pattern as Recommendations Center's Queue/History toggle, extended to 10 queues with live counts. */
export function WorkQueueStrip({ queues, tasks, activeQueueId, onSelectQueue }: WorkQueueStripProps) {
  const { language } = useOptionalLanguage()
  const es = workspaceCopy(language)
  return (
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={es ? es.workQueues : 'Work queues'}>
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
            {es?.queue[queue.id]?.label ?? queue.label} <span style={{ color: 'var(--muted2)' }}>({count})</span>
          </button>
        )
      })}
    </div>
  )
}
