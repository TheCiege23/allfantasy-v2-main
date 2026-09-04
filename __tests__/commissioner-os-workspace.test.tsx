import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { WorkspaceView } from "@/components/commissioner-os/workspace/WorkspaceView"
import { stubWorkspaceClient } from "@/lib/commissioner-ui/workspace/decision-os-client/stub"
import { demoWorkspaceClient } from "@/lib/commissioner-ui/workspace/decision-os-client/demo"
import { liveWorkspaceClient } from "@/lib/commissioner-ui/workspace/decision-os-client/live"
import { WORKSPACE_QUEUES, getWorkspaceQueue } from "@/lib/commissioner-ui/workspace/queues"
import type { CommissionerTask } from "@/lib/commissioner-ui/workspace/decision-os-client"

function makeTask(overrides: Partial<CommissionerTask> = {}): CommissionerTask {
  return {
    id: 'task-1',
    title: 'Test task',
    description: 'A test task.',
    status: 'open',
    priority: 'standard',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    automationCandidate: false,
    relatedLinks: [],
    ...overrides,
  }
}

describe("commissioner-os workspace — client parity", () => {
  it("stub, demo, and live all satisfy the same method surface", () => {
    expect(typeof stubWorkspaceClient.getTasks).toBe("function")
    expect(typeof demoWorkspaceClient.getTasks).toBe("function")
    expect(typeof liveWorkspaceClient.getTasks).toBe("function")
  })

  it("stub and demo are source-tagged and error-free; live is an honest, typed placeholder error", async () => {
    const stub = await stubWorkspaceClient.getTasks()
    const demo = await demoWorkspaceClient.getTasks()
    const live = await liveWorkspaceClient.getTasks()

    expect(stub.source).toBe('stub')
    expect(stub.error).toBeNull()
    expect(demo.source).toBe('demo')
    expect(demo.error).toBeNull()
    expect(live.data).toBeNull()
    expect(live.error?.category).toBe('upstream_unavailable')
    expect(live.error?.retryable).toBe(false)
  })

  it("demo data has at least one task in every default queue", async () => {
    const response = await demoWorkspaceClient.getTasks()
    const tasks = response.data!
    for (const queue of WORKSPACE_QUEUES) {
      expect(queue.filter(tasks).length, `queue "${queue.label}" should have at least one demo task`).toBeGreaterThan(0)
    }
  })

  it("there is exactly one task record per id — no queue duplicates a task under a different identity", async () => {
    const response = await demoWorkspaceClient.getTasks()
    const ids = response.data!.map((task) => task.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("commissioner-os workspace — queue filters", () => {
  const now = Date.now()
  const inDays = (days: number) => new Date(now + days * 24 * 60 * 60 * 1000).toISOString()

  const tasks: CommissionerTask[] = [
    makeTask({ id: 'attn', status: 'open', priority: 'critical' }),
    makeTask({ id: 'low-open', status: 'open', priority: 'standard' }),
    makeTask({ id: 'due-soon', status: 'open', priority: 'standard', dueAt: inDays(3) }),
    makeTask({ id: 'due-far', status: 'open', priority: 'standard', dueAt: inDays(30) }),
    makeTask({ id: 'due-but-completed', status: 'completed', priority: 'standard', dueAt: inDays(1) }),
    makeTask({ id: 'waiting-mgr', status: 'waiting_on_manager', priority: 'standard' }),
    makeTask({ id: 'waiting-vote', status: 'waiting_on_league_vote', priority: 'standard' }),
    makeTask({ id: 'in-progress', status: 'in_progress', priority: 'standard' }),
    makeTask({ id: 'automation', status: 'open', priority: 'standard', automationCandidate: true }),
    makeTask({ id: 'automation-done', status: 'completed', priority: 'standard', automationCandidate: true }),
    makeTask({ id: 'completed-old', status: 'completed', priority: 'standard', updatedAt: inDays(-5) }),
    makeTask({ id: 'completed-new', status: 'completed', priority: 'standard', updatedAt: inDays(-1) }),
    makeTask({ id: 'archived', status: 'archived', priority: 'standard' }),
  ]

  it("All returns every task, unfiltered", () => {
    expect(getWorkspaceQueue('all').filter(tasks)).toHaveLength(tasks.length)
  })

  it("Needs Attention is unresolved status with critical/elevated priority only", () => {
    const result = getWorkspaceQueue('needs-attention').filter(tasks)
    expect(result.map((t) => t.id)).toEqual(['attn'])
  })

  it("Due Soon excludes tasks outside the 7-day window and excludes completed tasks even with a near due date", () => {
    const result = getWorkspaceQueue('due-soon').filter(tasks)
    expect(result.map((t) => t.id)).toEqual(['due-soon'])
  })

  it("Waiting on Managers / Waiting on League Vote / In Progress match exact status only", () => {
    expect(getWorkspaceQueue('waiting-on-managers').filter(tasks).map((t) => t.id)).toEqual(['waiting-mgr'])
    expect(getWorkspaceQueue('waiting-on-league-vote').filter(tasks).map((t) => t.id)).toEqual(['waiting-vote'])
    expect(getWorkspaceQueue('in-progress').filter(tasks).map((t) => t.id)).toEqual(['in-progress'])
  })

  it("Automation Candidates excludes completed/archived even when flagged", () => {
    expect(getWorkspaceQueue('automation-candidates').filter(tasks).map((t) => t.id)).toEqual(['automation'])
  })

  it("Recently Completed / Recently Archived match status and sort newest-updated first", () => {
    const completed = getWorkspaceQueue('recently-completed').filter(tasks)
    // Every 'completed' task in the fixture, regardless of its other flags (due date, automation candidate) — order-independent set check.
    expect(new Set(completed.map((t) => t.id))).toEqual(new Set(['completed-new', 'completed-old', 'due-but-completed', 'automation-done']))
    expect(completed.every((t) => t.status === 'completed')).toBe(true)
    // newest updatedAt first
    for (let i = 1; i < completed.length; i++) {
      expect(new Date(completed[i - 1].updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(completed[i].updatedAt).getTime())
    }
    expect(getWorkspaceQueue('recently-archived').filter(tasks).map((t) => t.id)).toEqual(['archived'])
  })

  it("getWorkspaceQueue falls back to the first queue for an unknown id", () => {
    expect(getWorkspaceQueue('not-a-real-queue').id).toBe('all')
  })
})

describe("commissioner-os workspace — view", () => {
  it("renders the preview data banner and defaults to the All queue", async () => {
    const response = await demoWorkspaceClient.getTasks()
    render(<WorkspaceView tasks={response.data!} dataMode="demo" />)

    expect(screen.getByRole('status')).toHaveTextContent(/preview data/i)
    expect(screen.getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true')
    for (const task of response.data!) {
      expect(screen.getByText(task.title)).toBeInTheDocument()
    }
  })

  it("switching queues filters the visible task list", async () => {
    const response = await demoWorkspaceClient.getTasks()
    render(<WorkspaceView tasks={response.data!} dataMode="demo" />)

    fireEvent.click(screen.getByRole('tab', { name: /^Waiting on Managers/ }))

    expect(screen.getByText("Confirm Devon Okafor's co-commissioner permissions")).toBeInTheDocument()
    expect(screen.queryByText('Send a check-in message to Sam Rivera')).not.toBeInTheDocument()
  })

  it("opening a task shows its detail, due date, and related-evidence links in a dialog", async () => {
    const response = await demoWorkspaceClient.getTasks()
    render(<WorkspaceView tasks={response.data!} dataMode="demo" />)

    fireEvent.click(screen.getByText('Send a check-in message to Sam Rivera'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Manager engagement declining')).toBeInTheDocument()
    expect(within(dialog).getByText('Sam Rivera — Manager Intelligence')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Mark In Progress' })).toBeInTheDocument()
  })

  it("shows a queue-specific empty state when a queue matches nothing", () => {
    render(<WorkspaceView tasks={[makeTask({ status: 'completed' })]} dataMode="demo" />)
    fireEvent.click(screen.getByRole('tab', { name: /^Waiting on Managers/ }))
    expect(screen.getByText('Not waiting on any managers.')).toBeInTheDocument()
  })

  it("renders ErrorState instead of the queue UI when an error is present", () => {
    render(<WorkspaceView tasks={[]} dataMode="live" errorMessage="The live Decision OS backend is not yet integrated in this environment." />)
    expect(screen.getByRole('alert')).toHaveTextContent(/not yet integrated/i)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it("hides the preview data banner in live mode", () => {
    render(<WorkspaceView tasks={[]} dataMode="live" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
