import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ count: vi.fn(), user: vi.fn(), profile: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { count: h.count },
    appUser: { findUnique: h.user },
    userProfile: { findUnique: h.profile },
  },
}))

import { loadConnectLeagueFacts } from '@/lib/core-app/connectLeagueReads'

beforeEach(() => {
  h.count.mockResolvedValue(0)
  h.user.mockResolvedValue({ emailVerified: null })
  h.profile.mockResolvedValue({ phoneVerifiedAt: null, sleeperUserId: null })
})

describe('loadConnectLeagueFacts', () => {
  it("counts only this season's claimed teams, and takes the home's league count as given", async () => {
    const f = await loadConnectLeagueFacts('u1', 4, new Date('2026-09-25T00:00:00Z'))
    expect(h.count).toHaveBeenCalledWith({ where: { claimedByUserId: 'u1', league: { season: { gte: 2026 } } } })
    expect(f).toEqual({ claimedTeams: 0, leagueCount: 4, verified: false, sleeperLinked: false })
  })

  it('treats a verified email or phone as verified, and notices a linked Sleeper account', async () => {
    h.user.mockResolvedValue({ emailVerified: new Date() })
    expect((await loadConnectLeagueFacts('u1', 0))?.verified).toBe(true)
    h.user.mockResolvedValue({ emailVerified: null })
    h.profile.mockResolvedValue({ phoneVerifiedAt: new Date(), sleeperUserId: '123' })
    expect(await loadConnectLeagueFacts('u1', 0)).toMatchObject({ verified: true, sleeperLinked: true })
  })

  it('fails closed — a read error hides the card rather than nagging a manager with teams', async () => {
    h.count.mockRejectedValue(new Error('db down'))
    expect(await loadConnectLeagueFacts('u1', 12)).toBeNull()
  })
})
