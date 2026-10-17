import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  dispatch: vi.fn(),
  findMany: vi.fn(),
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/prisma', () => ({ prisma: { platformNotification: { findMany: h.findMany } } }))

import {
  LIVE_PUSH_CAP,
  LIVE_PUSH_MINOR_CAP,
  livePushAllowed,
  livePushTier,
  splitByLivePushBudget,
} from '@/lib/notifications/liveGamePushBudget'
import { ingest } from '@/lib/notification-engine'

const pushed = (userId: string, tier: 'major' | 'minor') => ({ userId, meta: { pushBudget: 'pushed', pushTier: tier } })

describe('livePushAllowed', () => {
  it('lets major alerts through until the hourly cap, minor ones only until the minor cap', () => {
    expect(livePushAllowed({ total: 0, minor: 0 }, 'minor')).toBe(true)
    expect(livePushAllowed({ total: LIVE_PUSH_MINOR_CAP, minor: LIVE_PUSH_MINOR_CAP }, 'minor')).toBe(false)
    // A touchdown still buzzes after the minor budget is spent…
    expect(livePushAllowed({ total: LIVE_PUSH_MINOR_CAP, minor: LIVE_PUSH_MINOR_CAP }, 'major')).toBe(true)
    // …until the overall cap.
    expect(livePushAllowed({ total: LIVE_PUSH_CAP, minor: 0 }, 'major')).toBe(false)
  })

  it('treats high severity as major and everything else as minor', () => {
    expect(livePushTier('high')).toBe('major')
    expect(livePushTier('medium')).toBe('minor')
    expect(livePushTier('low')).toBe('minor')
    expect(livePushTier(undefined)).toBe('minor')
  })
})

describe('splitByLivePushBudget', () => {
  it('holds only the people who have spent their budget this hour', async () => {
    const rows = [
      ...Array.from({ length: LIVE_PUSH_MINOR_CAP }, () => pushed('busy', 'minor')),
      pushed('quiet', 'major'),
    ]
    const r = await splitByLivePushBudget(['busy', 'quiet', 'new'], 'minor', { findRecent: async () => rows })
    expect(r).toEqual({ push: ['quiet', 'new'], held: ['busy'] })
  })

  it('asks only for the last hour of PUSHED live alerts', async () => {
    const now = new Date('2026-10-04T18:00:00Z')
    const findRecent = vi.fn(async () => [])
    await splitByLivePushBudget(['u1'], 'major', { findRecent, now })
    expect(findRecent).toHaveBeenCalledWith({ userIds: ['u1'], since: new Date('2026-10-04T17:00:00Z') })
  })

  it('fails open: a history it cannot read never silences a touchdown', async () => {
    const r = await splitByLivePushBudget(['u1', 'u2'], 'major', {
      findRecent: async () => {
        throw new Error('db down')
      },
    })
    expect(r).toEqual({ push: ['u1', 'u2'], held: [] })
  })
})

describe('ingest applies the budget to live alerts only', () => {
  beforeEach(() => {
    h.dispatch.mockReset().mockResolvedValue(undefined)
    h.findMany.mockReset().mockResolvedValue([])
  })

  const play = {
    type: 'live_score_swing' as const,
    title: 'Breece Hall 42-yard catch',
    userIds: ['busy', 'fresh'],
    severity: 'low' as const,
    skipChannels: { email: true, sms: true },
    meta: { idempotencyKey: 'play-1' },
  }

  it('sends the push to whoever has budget and holds it, bell-only, for whoever does not', async () => {
    // The cooldown query and the budget query share findMany; route by what is asked.
    h.findMany.mockImplementation(async (args: { where: { meta?: { path?: string[] } } }) =>
      args.where.meta?.path?.[0] === 'pushBudget'
        ? Array.from({ length: LIVE_PUSH_MINOR_CAP }, () => pushed('busy', 'minor'))
        : [],
    )
    await ingest(play)
    expect(h.dispatch).toHaveBeenCalledTimes(2)
    const [first, second] = h.dispatch.mock.calls.map((c) => c[0])
    expect(first).toMatchObject({
      userIds: ['fresh'],
      skipChannels: { email: true, sms: true },
      meta: { pushBudget: 'pushed', pushTier: 'minor' },
    })
    expect(second).toMatchObject({
      userIds: ['busy'],
      skipChannels: { email: true, sms: true, push: true },
      meta: { pushBudget: 'held', pushTier: 'minor' },
    })
  })

  it('leaves every other alert type exactly as it was: one send, no budget fields', async () => {
    await ingest({ type: 'injury_update', title: 'X — Out', userIds: ['u1'] })
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0][0].meta).not.toHaveProperty('pushBudget')
  })

  it('does not count an alert the caller already kept off the phone', async () => {
    await ingest({ ...play, skipChannels: { email: true, sms: true, push: true } })
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0][0].meta).not.toHaveProperty('pushBudget')
  })
})
