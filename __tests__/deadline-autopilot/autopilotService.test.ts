import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  entitled: true,
  sends: [] as Array<{ userIds: string[]; title: string; dedupePrefix?: string }>,
}))

vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    async evaluateUserFeatureAccess() {
      return { allowed: state.entitled }
    }
  },
}))

vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: vi.fn(async (p: { userIds: string[]; title: string; dedupePrefix?: string }) => {
    state.sends.push({ userIds: p.userIds, title: p.title, dedupePrefix: p.dedupePrefix })
  }),
}))

vi.mock('@/lib/prisma', () => {
  const league = {
    findUnique: vi.fn(async () => ({ id: 'L1', name: 'Dynasty Bros', userId: 'owner', settings: state.settings })),
    findMany: vi.fn(async () => [{ id: 'L1', name: 'Dynasty Bros', userId: 'owner', settings: state.settings }]),
    update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => {
      state.settings = data.settings
    }),
  }
  const prisma = {
    league,
    keeperSelectionSession: {
      findMany: vi.fn(async () => [{ id: 'S1', seasonId: 'incoming', deadline: new Date('2026-10-20T08:00:00Z') }]),
    },
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 'outgoing' })) },
    redraftRoster: {
      findMany: vi.fn(async () => [
        { id: 'r1', ownerId: 'u1' },
        { id: 'r2', ownerId: 'u2' },
        { id: 'r3', ownerId: 'u3' },
      ]),
    },
    // r1 submitted under the outgoing season, r2 under the incoming one — both count.
    keeperRecord: { findMany: vi.fn(async () => [{ rosterId: 'r1' }, { rosterId: 'r2' }]) },
    leagueTeam: { findMany: vi.fn(async () => [{ claimedByUserId: 'u1' }, { claimedByUserId: 'u2' }, { claimedByUserId: 'u3' }]) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: vi.fn(async () => []), league })),
  }
  return { prisma }
})

import { readLeagueDeadlines, runDeadlineAutopilot, sendManualReminder } from '@/lib/deadline-autopilot/autopilotService'

const NOW = new Date('2026-10-19T12:00:00Z') // keeper deadline is 20 h out → the 24 h stage

beforeEach(() => {
  state.settings = { deadline_autopilot: { enabled: true, custom: [], sent: {} } }
  state.entitled = true
  state.sends = []
})

describe('keeper deadlines', () => {
  it('reminds only managers with no keeper submitted, looking under both seasons', async () => {
    const [d] = await readLeagueDeadlines({ id: 'L1', userId: 'owner', settings: state.settings }, NOW)
    expect(d).toMatchObject({ key: 'keeper:S1', targeted: true, recipientUserIds: ['u3'] })
  })
})

describe('runDeadlineAutopilot', () => {
  it('sends the due stage once and records it', async () => {
    const first = await runDeadlineAutopilot({ dryRun: false, budgetMs: 10_000, now: NOW })
    expect(first).toMatchObject({ leagues: 1, reminders: 1, recipients: 1, errors: [] })
    expect(state.sends).toEqual([{ userIds: ['u3'], title: 'Keeper deadline — 20 hours left', dedupePrefix: 'deadline-autopilot:L1:keeper:S1:24h' }])
    const sent = (state.settings.deadline_autopilot as { sent: Record<string, string> }).sent
    expect(Object.keys(sent).sort()).toEqual(['keeper:S1:24h', 'keeper:S1:72h'])

    const second = await runDeadlineAutopilot({ dryRun: false, budgetMs: 10_000, now: NOW })
    expect(second.reminders).toBe(0)
    expect(state.sends).toHaveLength(1)
  })

  it('a lapsed plan stops sending without touching the switch', async () => {
    state.entitled = false
    const run = await runDeadlineAutopilot({ dryRun: false, budgetMs: 10_000, now: NOW })
    expect(run).toMatchObject({ notEntitled: 1, reminders: 0 })
    expect(state.sends).toEqual([])
    expect((state.settings.deadline_autopilot as { enabled: boolean }).enabled).toBe(true)
  })

  it('a dry run counts but neither sends nor records', async () => {
    const run = await runDeadlineAutopilot({ dryRun: true, budgetMs: 10_000, now: NOW })
    expect(run.reminders).toBe(1)
    expect(state.sends).toEqual([])
    expect((state.settings.deadline_autopilot as { sent: object }).sent).toEqual({})
  })
})

describe('sendManualReminder (free)', () => {
  it('sends to every manager for a custom deadline, then cools down', async () => {
    state.settings = { deadline_autopilot: { enabled: false, custom: [{ id: 'T', kind: 'trade', label: 'Trade deadline', at: '2026-10-25T00:00:00Z' }], sent: {} } }
    expect(await sendManualReminder('L1', 'custom:T', NOW)).toEqual({ ok: true, recipients: 3 })
    expect(state.sends[0].userIds).toEqual(['u1', 'u2', 'u3'])
    expect(await sendManualReminder('L1', 'custom:T', new Date(NOW.getTime() + 3600_000))).toEqual({ ok: false, error: 'cooldown' })
    expect(state.sends).toHaveLength(1)
  })
})
