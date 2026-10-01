// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  users: [] as string[],
  existing: [] as string[] | null,
  dispatch: vi.fn(async () => undefined),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(async () => m.users.map((userId) => ({ userId }))),
    platformNotification: {
      findMany: vi.fn(async () => {
        if (m.existing == null) throw new Error('db down')
        return m.existing.map((sourceKey) => ({ sourceKey }))
      }),
    },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.dispatch }))

import { notifyWeeklyStories, storyWeekKey } from '@/lib/core-app/weeklyStoryNotify'

const TUESDAY = new Date('2026-09-29T14:05:00Z')

beforeEach(() => {
  m.users = []
  m.existing = []
  m.dispatch.mockClear()
})

describe('storyWeekKey', () => {
  it('is the Monday that starts the week, so every fire in one week shares a key', () => {
    expect(storyWeekKey(TUESDAY)).toBe('2026-09-28')
    expect(storyWeekKey(new Date('2026-09-28T00:00:00Z'))).toBe('2026-09-28')
    expect(storyWeekKey(new Date('2026-10-04T23:59:00Z'))).toBe('2026-09-28') // Sunday
    expect(storyWeekKey(new Date('2026-10-05T00:00:00Z'))).toBe('2026-10-05')
  })
})

describe('notifyWeeklyStories', () => {
  it('sends nothing when nobody has a scored week', async () => {
    expect(await notifyWeeklyStories(TUESDAY)).toEqual({ targeted: 0, sent: 0, skipped: 0 })
    expect(m.dispatch).not.toHaveBeenCalled()
  })

  it('pushes once per user per week, as matchup_results, push and in-app only', async () => {
    m.users = ['u1', 'u2', 'u3']
    m.existing = ['weekly-story:2026-09-28:u2'] // already sent this week
    expect(await notifyWeeklyStories(TUESDAY)).toEqual({ targeted: 3, sent: 2, skipped: 1 })
    expect(m.dispatch).toHaveBeenCalledTimes(1)
    expect(m.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['u1', 'u3'],
        category: 'matchup_results',
        dedupePrefix: 'weekly-story:2026-09-28',
        skipChannels: { email: true, sms: true },
        actionHref: '/core/career',
      }),
    )
  })

  it('sends nothing when it cannot tell who was already sent — a missed push beats a repeated one', async () => {
    m.users = ['u1']
    m.existing = null
    expect(await notifyWeeklyStories(TUESDAY)).toEqual({ targeted: 1, sent: 0, skipped: 1 })
    expect(m.dispatch).not.toHaveBeenCalled()
  })

  it('dispatches in chunks of 100', async () => {
    m.users = Array.from({ length: 230 }, (_, i) => `u${i}`)
    expect(await notifyWeeklyStories(TUESDAY)).toMatchObject({ sent: 230 })
    expect(m.dispatch.mock.calls.map((c) => (c as unknown as [{ userIds: string[] }])[0].userIds.length)).toEqual([100, 100, 30])
  })

  it('never throws', async () => {
    m.dispatch.mockRejectedValueOnce(new Error('push down'))
    m.users = ['u1']
    await expect(notifyWeeklyStories(TUESDAY)).resolves.toEqual({ targeted: 0, sent: 0, skipped: 0 })
  })

  it('names no week number in what the user sees', async () => {
    m.users = ['u1']
    await notifyWeeklyStories(TUESDAY)
    const call = (m.dispatch.mock.calls[0] as unknown as [{ title: string; body: string }])[0]
    expect(`${call.title} ${call.body}`).not.toMatch(/week \d|wk ?\d/i)
  })
})
