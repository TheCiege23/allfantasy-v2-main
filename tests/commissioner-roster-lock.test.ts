import { beforeEach, describe, expect, it, vi } from 'vitest'

const { leagueFind, rosterFind, teamFind } = vi.hoisted(() => ({
  leagueFind: vi.fn(),
  rosterFind: vi.fn(),
  teamFind: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueFind },
    roster: { findFirst: rosterFind },
    leagueTeam: { findMany: teamFind },
  },
}))

import { isCommissionerRosterLocked, readCommissionerRosterLocks, withCommissionerRosterLocks } from '@/lib/league/commissioner-roster-lock'
import { addDropErrorStatus, mapAddDropErrorCode } from '@/lib/waiver-wire/addDropErrors'

describe('commissioner roster locks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leagueFind.mockResolvedValue({ settings: { scoring: 'ppr', commissionerRosterLocks: { teamA: true } } })
    rosterFind.mockResolvedValue({ platformUserId: 'managerA' })
    teamFind.mockResolvedValue([{ id: 'teamA' }])
  })

  it('keeps unrelated league settings and persists only locked team IDs', () => {
    const settings = withCommissionerRosterLocks({ scoring: 'ppr' }, { teamA: true, teamB: false })
    expect(settings).toEqual({ scoring: 'ppr', commissionerRosterLocks: { teamA: true } })
    expect(readCommissionerRosterLocks(settings)).toEqual({ teamA: true })
  })

  it('blocks a locked roster after its manager changes', async () => {
    expect(await isCommissionerRosterLocked('league1', 'roster1')).toBe(true)
    expect(teamFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ leagueId: 'league1', OR: expect.arrayContaining([{ externalId: 'roster1' }]) }),
    }))
  })

  it('does not lock other teams and fails open only when no lock is configured', async () => {
    teamFind.mockResolvedValue([{ id: 'teamB' }])
    expect(await isCommissionerRosterLocked('league1', 'roster1')).toBe(false)
    leagueFind.mockResolvedValue({ settings: { commissionerRosterLocks: {} } })
    expect(await isCommissionerRosterLocked('league1', 'roster1')).toBe(false)
  })

  it('returns a roster-specific error for blocked add/drop actions', () => {
    const code = mapAddDropErrorCode('This roster is locked by the commissioner.', { hasDrop: false })
    expect(code).toBe('ROSTER_LOCKED')
    expect(addDropErrorStatus(code)).toBe(423)
  })
})
