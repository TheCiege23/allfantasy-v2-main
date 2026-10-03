import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany, findClaim, findUser, claim, dispatch } = vi.hoisted(() => ({
  findMany: vi.fn(),
  findClaim: vi.fn(),
  findUser: vi.fn(),
  claim: vi.fn(),
  dispatch: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  afLeagueTrade: { findMany },
  leagueTeam: { findFirst: findClaim },
  appUser: { findUnique: findUser },
  sportsDataCache: { create: claim },
} }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: dispatch }))

import { pendingOfferReminderKind, remindPendingTrades } from '@/lib/automation/jobs/trades/remindPendingTrades'

const now = new Date('2026-10-03T18:00:00.000Z')
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000)

beforeEach(() => {
  findMany.mockReset()
  findClaim.mockReset().mockResolvedValue({ claimedByUserId: 'receiver' })
  findUser.mockReset().mockResolvedValue(null)
  claim.mockReset().mockResolvedValue({})
  dispatch.mockReset().mockResolvedValue(undefined)
})

describe('pending trade reminders', () => {
  it('only selects an open day-later offer or a near-expiry offer', () => {
    expect(pendingOfferReminderKind({ createdAt: hoursAgo(25), expiresAt: null }, now)).toBe('followup')
    expect(pendingOfferReminderKind({ createdAt: hoursAgo(1), expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000) }, now)).toBe('expiring')
    expect(pendingOfferReminderKind({ createdAt: hoursAgo(2), expiresAt: null }, now)).toBeNull()
    expect(pendingOfferReminderKind({ createdAt: hoursAgo(25), expiresAt: hoursAgo(1) }, now)).toBeNull()
  })

  it('alerts only the receiving manager and links to the actionable league view once', async () => {
    findMany.mockResolvedValue([{
      id: 'trade-1', leagueId: 'league-1', proposedByUserId: 'proposer',
      createdAt: hoursAgo(25), expiresAt: null,
      league: { name: 'Test League' }, receiverRoster: { platformUserId: 'receiver' },
    }])
    const first = await remindPendingTrades(now)
    expect(first).toEqual({ checked: 1, sent: 1 })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ['receiver'], category: 'trade_proposals',
      actionHref: '/league/league-1?view=trades',
      skipChannels: { email: true, sms: true },
    }))
    claim.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 'P2002' }))
    const second = await remindPendingTrades(now)
    expect(second.sent).toBe(0)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('does not address a provider roster id as an app user', async () => {
    findMany.mockResolvedValue([{
      id: 'trade-2', leagueId: 'league-1', proposedByUserId: 'proposer',
      createdAt: hoursAgo(25), expiresAt: null,
      league: { name: 'Test League' }, receiverRoster: { platformUserId: 'sleeper-123' },
    }])
    findClaim.mockResolvedValue(null)
    expect((await remindPendingTrades(now)).sent).toBe(0)
    expect(dispatch).not.toHaveBeenCalled()
  })
})
