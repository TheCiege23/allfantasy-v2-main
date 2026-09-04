import type { CommissionerTask } from './decision-os-client/types'

const DUE_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const ATTENTION_PRIORITIES = new Set(['critical', 'elevated'])
const UNRESOLVED_STATUSES = new Set(['open', 'waiting_on_manager', 'waiting_on_league_vote'])

function isDueSoon(task: CommissionerTask): boolean {
  if (!task.dueAt) return false
  if (task.status === 'completed' || task.status === 'archived') return false
  const dueInMs = new Date(task.dueAt).getTime() - Date.now()
  return dueInMs >= 0 && dueInMs <= DUE_SOON_WINDOW_MS
}

export interface WorkspaceQueueDefinition {
  id: string
  label: string
  emptyTitle: string
  emptyDescription: string
  filter: (tasks: CommissionerTask[]) => CommissionerTask[]
}

/**
 * The single source of truth for every queue — the UI strip and any test
 * both read this list, so there is exactly one place that defines what
 * "Needs Attention" or "Due Soon" means. Queues are pure filters over one
 * task array (never a copy), per the Workspace ownership rule: "Work
 * Queues must be filtered views of one underlying task model."
 */
export const WORKSPACE_QUEUES: WorkspaceQueueDefinition[] = [
  {
    id: 'all',
    label: 'All',
    emptyTitle: 'No tasks yet.',
    emptyDescription: 'Operational work will appear here as it comes up.',
    filter: (tasks) => tasks,
  },
  {
    id: 'needs-attention',
    label: 'Needs Attention',
    emptyTitle: "Nothing needs your attention right now.",
    emptyDescription: 'No unresolved high-priority tasks.',
    filter: (tasks) => tasks.filter((task) => UNRESOLVED_STATUSES.has(task.status) && ATTENTION_PRIORITIES.has(task.priority)),
  },
  {
    id: 'high-priority',
    label: 'High Priority',
    emptyTitle: 'No high-priority tasks.',
    emptyDescription: 'Critical and elevated tasks will appear here.',
    filter: (tasks) => tasks.filter((task) => ATTENTION_PRIORITIES.has(task.priority)),
  },
  {
    id: 'due-soon',
    label: 'Due Soon',
    emptyTitle: 'Nothing due soon.',
    emptyDescription: 'Tasks due within the next 7 days will appear here.',
    filter: (tasks) => tasks.filter(isDueSoon),
  },
  {
    id: 'waiting-on-managers',
    label: 'Waiting on Managers',
    emptyTitle: 'Not waiting on any managers.',
    emptyDescription: 'Tasks blocked on a manager response will appear here.',
    filter: (tasks) => tasks.filter((task) => task.status === 'waiting_on_manager'),
  },
  {
    id: 'waiting-on-league-vote',
    label: 'Waiting on League Vote',
    emptyTitle: 'Nothing waiting on a league vote.',
    emptyDescription: 'Tasks blocked on a league-wide decision will appear here.',
    filter: (tasks) => tasks.filter((task) => task.status === 'waiting_on_league_vote'),
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    emptyTitle: 'Nothing in progress.',
    emptyDescription: 'Tasks you have started will appear here.',
    filter: (tasks) => tasks.filter((task) => task.status === 'in_progress'),
  },
  {
    id: 'automation-candidates',
    label: 'Automation Candidates',
    emptyTitle: 'No automation candidates.',
    emptyDescription: 'Recurring, low-stakes tasks worth automating will appear here.',
    filter: (tasks) => tasks.filter((task) => task.automationCandidate && task.status !== 'completed' && task.status !== 'archived'),
  },
  {
    id: 'recently-completed',
    label: 'Recently Completed',
    emptyTitle: 'Nothing completed recently.',
    emptyDescription: 'Tasks you finish will appear here.',
    filter: (tasks) =>
      tasks.filter((task) => task.status === 'completed').sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  },
  {
    id: 'recently-archived',
    label: 'Recently Archived',
    emptyTitle: 'Nothing archived recently.',
    emptyDescription: 'Tasks you archive will appear here.',
    filter: (tasks) =>
      tasks.filter((task) => task.status === 'archived').sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  },
]

export const DEFAULT_WORKSPACE_QUEUE_ID = 'all'

export function getWorkspaceQueue(id: string): WorkspaceQueueDefinition {
  return WORKSPACE_QUEUES.find((queue) => queue.id === id) ?? WORKSPACE_QUEUES[0]
}
