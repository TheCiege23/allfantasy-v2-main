// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  claimed: [] as Array<{ leagueId: string; claimedByUserId: string }>,
  members: [] as Array<{ leagueId: string; userId: string }>,
  existing: [] as string[] | null,
  dispatch: vi.fn(async () => undefined),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: vi.fn(async () => m.claimed) },
    redraftLeagueMember: { findMany: vi.fn(async () => m.members) },
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

const R = (leagueId: string, leagueName: string, ownerUserId: string) => ({
  leagueId,
  leagueName,
  ownerUserId,
  season: '2026',
  week: 5,
  text: `📺 Week 5 recap — ${leagueName} (2026)

🏆 Weekly awards
  🚀 Boom of the week: MisterG201, 255.0`,
})
type Call = {
  userIds: string[]
  title: string
  actionHref: string
  category: string
  skipChannels: Record<string, boolean>
  dedupePrefix: string
  meta: Record<string, unknown>
  emailOverride?: { subject: string; html: string }
}
const calls = () => m.dispatch.mock.calls.map((c) => (c as unknown as [Call])[0])

beforeEach(() => {
  m.claimed = []
  m.members = []
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

  it('reaches a leaguemate who joined as a member, with no team', async () => {
    m.members = [{ leagueId: 'L1', userId: 'joined-from-link' }]
    const out = await notifyWeeklyRecaps([R('L1', 'Death Squad', 'owner')])
    expect([...out.notified].sort()).toEqual(['joined-from-link', 'owner'])
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

describe('the recap email', () => {
  it('is off unless asked for — no email channel, no designed email', async () => {
    const out = await notifyWeeklyRecaps([R('L1', 'Death Squad', 'owner')])
    expect(calls()[0]!.skipChannels).toEqual({ email: true, sms: true })
    expect(calls()[0]!.emailOverride).toBeUndefined()
    expect(out.emailed).toBe(0)
  })

  it('rides the same once-a-week dispatch when switched on', async () => {
    const out = await notifyWeeklyRecaps([R('L1', 'Death Squad', 'owner')], { email: true, baseUrl: 'https://allfantasy.ai/' })
    const c = calls()[0]!
    expect(c.skipChannels).toEqual({ email: false, sms: true })
    expect(c.emailOverride!.subject).toBe('Week 5 recap — Death Squad')
    expect(c.emailOverride!.html).toContain('Boom of the week: MisterG201, 255.0')
    expect(c.emailOverride!.html).toContain('https://allfantasy.ai/league/L1?openChat=league')
    expect(out.emailed).toBe(1)
  })

  it('one email covering every recapped league of that person', async () => {
    await notifyWeeklyRecaps([R('L1', 'Death Squad', 'owner'), R('L2', 'Iron Horse', 'owner')], { email: true, baseUrl: 'https://allfantasy.ai' })
    expect(m.dispatch).toHaveBeenCalledTimes(1)
    expect(calls()[0]!.emailOverride!.subject).toBe('Week 5 recaps — Death Squad + 1 more')
  })

  it('no origin, no email — a link-less email is worse than none', async () => {
    await notifyWeeklyRecaps([R('L1', 'Death Squad', 'owner')], { email: true, baseUrl: null })
    expect(calls()[0]!.skipChannels.email).toBe(true)
  })

  it('a person already notified this week is not emailed again', async () => {
    m.existing = ['weekly-recap:2026-w5:owner']
    const out = await notifyWeeklyRecaps([R('L1', 'Death Squad', 'owner')], { email: true, baseUrl: 'https://allfantasy.ai' })
    expect(m.dispatch).not.toHaveBeenCalled()
    expect(out.emailed).toBe(0)
  })
})
