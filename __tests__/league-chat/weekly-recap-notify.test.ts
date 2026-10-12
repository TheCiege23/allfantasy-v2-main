// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  claimed: [] as Array<{ leagueId: string; claimedByUserId: string }>,
  existing: [] as string[] | null,
  dispatch: vi.fn(async () => undefined),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: vi.fn(async () => m.claimed) },
    platformNotification: {
      findMany: vi.fn(async () => {
        if (m.existing == null) throw new Error('db down')
        return m.existing.map((sourceKey) => ({ sourceKey }))
      }),
    },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.dispatch }))

import { notifyWeeklyRecaps } from '@/lib/league-chat/weeklyRecapNotify'
import { pushTagFor } from '@/lib/notifications/pushTag'

const R = (leagueId: string, leagueName: string, ownerUserId: string) => ({ leagueId, leagueName, ownerUserId, season: '2026', week: 5 })
type Call = { userIds: string[]; title: string; actionHref: string; category: string; skipChannels: Record<string, boolean>; dedupePrefix: string; meta: Record<string, unknown> }
const calls = () => m.dispatch.mock.calls.map((c) => (c as unknown as [Call])[0])

beforeEach(() => {
  m.claimed = []
  m.existing = []
  m.dispatch.mockClear()
})

describe('notifyWeeklyRecaps', () => {
  it('tells the owner and every claimed member, once each, and opens the league chat', async () => {
    m.claimed = [
      { leagueId: 'L1', claimedByUserId: 'u2' },
      { leagueId: 'L1', claimedByUserId: 'owner' },
    ]
    const out = await notifyWeeklyRecaps([R('L1', 'Death Squad', 'owner')])
    expect(out.sent).toBe(2)
    expect([...out.notified].sort()).toEqual(['owner', 'u2'])
    expect(calls().map((c) => c.userIds[0]).sort()).toEqual(['owner', 'u2'])
    expect(calls()[0]).toMatchObject({
      category: 'matchup_results',
      title: 'Week 5 recap: Death Squad',
      actionHref: '/league/L1?openChat=league',
      skipChannels: { email: true, sms: true },
      dedupePrefix: 'weekly-recap:2026-w5',
    })
  })

  it('is ONE notification for someone in several recapped leagues', async () => {
    const out = await notifyWeeklyRecaps([R('L1', 'Death Squad', 'owner'), R('L2', 'Iron Horse', 'owner')])
    expect(out.sent).toBe(1)
    expect(calls()[0]!.title).toBe('Week 5 recaps are in for 2 of your leagues')
  })

  it('never notifies the same person twice in a week — the later fires dedupe', async () => {
    m.existing = ['weekly-recap:2026-w5:owner']
    const out = await notifyWeeklyRecaps([R('L1', 'Death Squad', 'owner')])
    expect(out.sent).toBe(0)
    expect(m.dispatch).not.toHaveBeenCalled()
    expect(out.notified.size).toBe(0)
  })

  it('sends nothing when the dedupe read fails — a missed push beats a repeated one', async () => {
    m.existing = null
    const out = await notifyWeeklyRecaps([R('L1', 'Death Squad', 'owner')])
    expect(out.sent).toBe(0)
    expect(m.dispatch).not.toHaveBeenCalled()
  })

  it('carries its own device tag', async () => {
    await notifyWeeklyRecaps([R('L1', 'Death Squad', 'owner')])
    const c = calls()[0]!
    expect(pushTagFor(c.category, c.meta)).toBe('weekly-recap:2026-w5')
  })

  it('does nothing for no recaps', async () => {
    expect((await notifyWeeklyRecaps([])).sent).toBe(0)
    expect(m.dispatch).not.toHaveBeenCalled()
  })
})
