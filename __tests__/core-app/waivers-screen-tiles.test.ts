import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The league Waivers screen's tiles and rules, each pinned to the defect it used to have
 * (2026-10-02 audit). Same harness shape as waivers-roster-payload.test.ts.
 */

const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn(), findUnique: vi.fn() },
  leagueWaiverSettings: { findUnique: vi.fn() },
  waiverClaim: { count: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('server-only', () => ({}))

const LEAGUE = { id: 'L1', name: 'Test League', platform: 'sleeper', leagueType: 'redraft', platformLeagueId: 'SL1' }

vi.mock('@/lib/core-app/leagueContext', () => ({
  leagueContextFor: () => ({
    league: async () => LEAGUE,
    claimedTeam: async () => ({ platformUserId: 'me', externalId: '1' }),
  }),
}))

import { getWaiversData } from '@/lib/core-app/waivers'

beforeEach(() => {
  vi.clearAllMocks()
  LEAGUE.platform = 'sleeper'
  prismaMock.leagueWaiverSettings.findUnique.mockResolvedValue(null)
  prismaMock.waiverClaim.count.mockResolvedValue(2)
  prismaMock.roster.findMany.mockResolvedValue([
    { id: 'r-me', platformUserId: 'me', faabRemaining: 40, waiverPriority: 3 },
    { id: 'r-them', platformUserId: 'them', faabRemaining: 40, waiverPriority: 1 },
    { id: 'r-other', platformUserId: 'other', faabRemaining: 90, waiverPriority: 7 },
  ])
  prismaMock.roster.findUnique.mockResolvedValue({ playerData: { players: ['p1'], starters: ['p1'] } })
})

describe('Claims queued', () => {
  it('does not claim "0 pending" on an imported league — it cannot see those claims at all', async () => {
    const data = await getWaiversData('L1', 'me')
    expect(data?.claimsQueued).toMatchObject({ available: false, reason: expect.stringContaining('Sleeper') })
    /* Not merely relabelled: the table that cannot hold a Sleeper claim is not even read. */
    expect(prismaMock.waiverClaim.count).not.toHaveBeenCalled()
  })

  it('counts only PENDING claims on a league AllFantasy runs', async () => {
    LEAGUE.platform = 'manual'
    const data = await getWaiversData('L1', 'me')
    expect(data?.claimsQueued).toEqual({ available: true, data: { count: 2, committed: null } })
    expect(prismaMock.waiverClaim.count.mock.calls[0][0].where).toMatchObject({ status: 'pending' })
  })
})

describe('FAAB tiebreak', () => {
  const faab = { waiverType: 'faab', faabBudget: 100, tiebreakRule: 'faab_highest' }

  it('does not print "Highest FAAB bid" as the answer to how EQUAL bids are split (imported)', async () => {
    prismaMock.leagueWaiverSettings.findUnique.mockResolvedValue(faab)
    const data = await getWaiversData('L1', 'me')
    expect(data?.tiebreak).toMatchObject({ available: false, reason: expect.stringContaining('equal bids') })
  })

  it("states the native engine's own order — equal bids go to waiver priority", async () => {
    LEAGUE.platform = 'manual'
    prismaMock.leagueWaiverSettings.findUnique.mockResolvedValue(faab)
    const data = await getWaiversData('L1', 'me')
    expect(data?.tiebreak).toEqual({ available: true, data: 'Highest bid wins · equal bids go to waiver priority' })
  })
})

describe('Your FAAB rank', () => {
  it('shares a rank on a tied budget rather than ordering the tie arbitrarily', async () => {
    prismaMock.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'faab', faabBudget: 100 })
    const data = await getWaiversData('L1', 'me')
    /* 90 is first; the two 40s are both second. */
    expect(data?.budget).toMatchObject({ available: true, data: { faabRemaining: 40, rankByBudget: 2 } })
  })
})
