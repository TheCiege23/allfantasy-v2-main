import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A chopped guillotine team is out of the league. Its players are released to waivers the moment
 * it is chopped, so without this it could simply claim them back.
 */

const db = vi.hoisted(() => ({
  redraftSeason: { findFirst: vi.fn() },
  redraftWaiverClaim: { findMany: vi.fn(), update: vi.fn() },
  redraftRoster: { findFirst: vi.fn() },
  redraftRosterPlayer: { findFirst: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { processWaiverWindow } from '@/lib/redraft/waiverEngine'

beforeEach(() => {
  vi.clearAllMocks()
  db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', leagueId: 'L1', sport: 'NFL' })
  db.redraftWaiverClaim.findMany.mockResolvedValue([
    { id: 'c1', rosterId: 'rr-chopped', addPlayerId: 'p1', addPlayerName: 'Released Star', bidAmount: 40, priority: 1 },
  ])
  db.redraftRoster.findFirst.mockResolvedValue({ id: 'rr-chopped', isEliminated: true, faabBalance: 100 })
  db.redraftWaiverClaim.update.mockResolvedValue({})
})

describe('processWaiverWindow — eliminated teams', () => {
  it('denies a claim from an eliminated team and touches no roster', async () => {
    const results = await processWaiverWindow('L1', 's1')

    expect(results).toEqual([{ claimId: 'c1', status: 'denied', reason: 'This team has been eliminated.' }])
    expect(db.redraftWaiverClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ status: 'denied' }) }),
    )
    expect(db.redraftRosterPlayer.findFirst).not.toHaveBeenCalled()
  })
})
