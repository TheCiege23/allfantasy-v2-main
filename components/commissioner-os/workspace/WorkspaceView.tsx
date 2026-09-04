'use client'

import { useMemo, useState } from 'react'
import { Briefcase } from 'lucide-react'
import { EmptyState, ErrorState } from '@/components/commissioner-os/states'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import { WorkQueueStrip } from './WorkQueueStrip'
import { TaskListItem } from './TaskListItem'
import { TaskDetailDrawer } from './TaskDetailDrawer'
import { WORKSPACE_QUEUES, DEFAULT_WORKSPACE_QUEUE_ID, getWorkspaceQueue } from '@/lib/commissioner-ui/workspace/queues'
import type { CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'
import type { CommissionerTask } from '@/lib/commissioner-ui/workspace/decision-os-client'

export interface WorkspaceViewProps {
  tasks: CommissionerTask[]
  dataMode: CommissionerDataMode
  /** Set when the adapter returned an error (today, only in `live` mode) — supersedes the normal queue/list UI with an honest error rather than an empty-looking queue. */
  errorMessage?: string | null
}

/**
 * Workspace owns the task model, its lifecycle, and Work Queue
 * presentation — every queue below is a pure filter over this one
 * `tasks` array (never a per-queue copy), per the ownership rule "Work
 * Queues must be filtered views of one underlying task model." Related
 * evidence is a link back to the owning module, never duplicated data.
 */
export function WorkspaceView({ tasks, dataMode, errorMessage }: WorkspaceViewProps) {
  const [activeQueueId, setActiveQueueId] = useState(DEFAULT_WORKSPACE_QUEUE_ID)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const activeQueue = getWorkspaceQueue(activeQueueId)
  const visibleTasks = useMemo(() => activeQueue.filter(tasks), [activeQueue, tasks])
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null

  return (
    <div>
      <PreviewDataBanner mode={dataMode} />

      {errorMessage ? (
        <ErrorState message={errorMessage} />
      ) : (
        <>
          <WorkQueueStrip queues={WORKSPACE_QUEUES} tasks={tasks} activeQueueId={activeQueueId} onSelectQueue={setActiveQueueId} />

          {visibleTasks.length === 0 ? (
            <EmptyState icon={Briefcase} title={activeQueue.emptyTitle} description={activeQueue.emptyDescription} />
          ) : (
            <div className="space-y-2">
              {visibleTasks.map((task) => (
                <TaskListItem key={task.id} task={task} onOpen={() => setSelectedTaskId(task.id)} />
              ))}
            </div>
          )}

          <TaskDetailDrawer
            task={selectedTask}
            onOpenChange={(open) => {
              if (!open) setSelectedTaskId(null)
            }}
          />
        </>
      )}
    </div>
  )
}
