// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A task that asks for a decision notifies the commissioners once — when first opened, never again. */

const m = vi.hoisted(() => ({
  existing: [] as unknown[],
  create: vi.fn(async () => ({})),
  update: vi.fn(async () => ({})),
  dispatch: vi.fn(async () => ({})),
  candidates: [] as unknown[],
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    commissionerWorkspaceTask: { findMany: async () => m.existing, create: m.create, update: m.update },
    league: { findUnique: async () => ({ userId: 'owner' }) },
    leagueTeam: { findMany: async () => [{ claimedByUserId: 'co-commish' }, { claimedByUserId: 'owner' }] },
  },
}))
vi.mock('@/lib/commissioner-workspace/taskSources', () => ({ detectLeagueTasks: async () => m.candidates }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.dispatch }))

import { reconcileLeagueTasks } from '@/lib/commissioner-workspace/taskStore'

const candidate = {
  sourceKey: 'daily-waiver-game-day-conflict:v1:2026-11-25',
  title: 'Wednesday has games but no free-agent window before kickoff',
  description: 'd',
  priority: 'elevated',
  automationCandidate: false,
  relatedLinks: [],
  notifyOnOpen: { title: 't', body: 'b', actionHref: '/league/L1?view=settings&settingsPanel=waivers', actionLabel: 'Change Wednesday' },
}

beforeEach(() => {
  vi.clearAllMocks()
  m.existing = []
  m.candidates = [candidate]
})

describe('notify on open', () => {
  it('a new task notifies the owner and co-commissioners once, deduped by task', async () => {
    await reconcileLeagueTasks('L1')
    expect(m.create).toHaveBeenCalledTimes(1)
    expect(m.dispatch).toHaveBeenCalledTimes(1)
    expect(m.dispatch.mock.calls[0]![0]).toMatchObject({
      userIds: ['owner', 'co-commish'],
      category: 'commissioner_alerts',
      actionLabel: 'Change Wednesday',
      dedupePrefix: `cw-task:L1:${candidate.sourceKey}`,
    })
  })

  it('a task already stored (open or left as is) sends nothing again', async () => {
    m.existing = [{ id: 'r1', leagueId: 'L1', sourceKey: candidate.sourceKey, status: 'archived', title: candidate.title, description: 'd', priority: 'elevated', dueAt: null, automationCandidate: false, relatedLinks: [] }]
    await reconcileLeagueTasks('L1')
    expect(m.create).not.toHaveBeenCalled()
    expect(m.dispatch).not.toHaveBeenCalled()
  })
})
