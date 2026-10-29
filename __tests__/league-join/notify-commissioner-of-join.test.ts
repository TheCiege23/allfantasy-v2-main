import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  leagueTeam: { count: vi.fn() },
  userProfile: { findFirst: vi.fn() },
  dispatch: vi.fn(async () => undefined),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: m.league, leagueTeam: m.leagueTeam, userProfile: m.userProfile } }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.dispatch }))

const { notifyCommissionerOfJoin } = await import('@/lib/league-join/notifyCommissionerOfJoin')

describe('the league owner is told when a manager joins, with the fill count', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.league.findUnique.mockResolvedValue({ name: 'The Ciege NBA Guilly', userId: 'owner', leagueSize: 16 })
    m.leagueTeam.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (where.claimedByUserId ? 3 : 16))
    m.userProfile.findFirst.mockResolvedValue({ displayName: 'Steve', sleeperUsername: null })
  })

  it('sends "Steve joined … — 3/16 spots filled" to the owner as a commissioner alert', async () => {
    await notifyCommissionerOfJoin({ leagueId: 'L1', joinerUserId: 'steve' })
    expect(m.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ['owner'],
      category: 'commissioner_alerts',
      title: 'Steve joined The Ciege NBA Guilly',
      body: '3/16 spots filled.',
      leagueId: 'L1',
      actionHref: '/league/L1',
    }))
    // Counts claimed seats, the same claim that makes someone a member.
    expect(m.leagueTeam.count).toHaveBeenCalledWith({ where: { leagueId: 'L1', claimedByUserId: { not: null } } })
  })

  it('says when the league is full', async () => {
    m.leagueTeam.count.mockResolvedValue(16)
    await notifyCommissionerOfJoin({ leagueId: 'L1', joinerUserId: 'steve' })
    expect(m.dispatch.mock.calls[0][0].body).toBe('16/16 spots filled. Your league is full.')
  })

  it('does not notify the owner about their own join', async () => {
    await notifyCommissionerOfJoin({ leagueId: 'L1', joinerUserId: 'owner' })
    expect(m.dispatch).not.toHaveBeenCalled()
  })

  it('falls back to the team count when the league has no size', async () => {
    m.league.findUnique.mockResolvedValue({ name: 'L', userId: 'owner', leagueSize: null })
    m.userProfile.findFirst.mockResolvedValue(null)
    await notifyCommissionerOfJoin({ leagueId: 'L1', joinerUserId: 'x' })
    expect(m.dispatch.mock.calls[0][0]).toMatchObject({ title: 'A new manager joined L', body: '3/16 spots filled.' })
  })
})
