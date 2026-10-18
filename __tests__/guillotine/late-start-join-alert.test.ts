import { beforeEach, describe, expect, it, vi } from 'vitest'

/* The commissioner join alert reports a native guillotine league's EFFECTIVE seat count. */

const m = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  leagueTeam: { count: vi.fn() },
  userProfile: { findFirst: vi.fn() },
  dispatch: vi.fn(async () => undefined),
  effective: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: m.league, leagueTeam: m.leagueTeam, userProfile: m.userProfile } }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.dispatch }))
vi.mock('@/lib/guillotine/lateStartSeats', () => ({ resolveGuillotineEffectiveSeats: m.effective }))

const { notifyCommissionerOfJoin } = await import('@/lib/league-join/notifyCommissionerOfJoin')

describe('join alert seat count', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.league.findUnique.mockResolvedValue({ name: 'The Ciege NBA Guilly', userId: 'owner', leagueSize: 16 })
    m.leagueTeam.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (where.claimedByUserId ? 3 : 16))
    m.userProfile.findFirst.mockResolvedValue({ displayName: 'Steve', sleeperUsername: null })
  })
  it('uses the seats the remaining season supports for a guillotine league', async () => {
    m.effective.mockResolvedValue(15)
    await notifyCommissionerOfJoin({ leagueId: 'L1', joinerUserId: 'steve' })
    expect(m.dispatch).toHaveBeenCalledWith(expect.objectContaining({ body: '3/15 spots filled.', meta: expect.objectContaining({ size: 15 }) }))
  })
  it('keeps the configured size for every other league', async () => {
    m.effective.mockResolvedValue(null)
    await notifyCommissionerOfJoin({ leagueId: 'L1', joinerUserId: 'steve' })
    expect(m.dispatch).toHaveBeenCalledWith(expect.objectContaining({ body: '3/16 spots filled.' }))
  })
})
