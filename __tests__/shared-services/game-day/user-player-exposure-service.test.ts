import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUserProfileFindUnique, mockRosterFindMany } = vi.hoisted(() => ({
  mockUserProfileFindUnique: vi.fn(),
  mockRosterFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: { findUnique: mockUserProfileFindUnique },
    roster: { findMany: mockRosterFindMany },
  },
}))

import { computeUserPlayerExposure } from '@/lib/shared-services/game-day/UserPlayerExposureService'

function rosterPlayerData(sections: { starters?: unknown[]; bench?: unknown[]; ir?: unknown[]; taxi?: unknown[] }) {
  return { lineup_sections: { starters: sections.starters ?? [], bench: sections.bench ?? [], ir: sections.ir ?? [], taxi: sections.taxi ?? [], devy: [] } }
}

describe('computeUserPlayerExposure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUserProfileFindUnique.mockResolvedValue({ sleeperUserId: null })
  })

  it('returns empty exposure with no connected leagues', async () => {
    mockRosterFindMany.mockResolvedValue([])
    const result = await computeUserPlayerExposure({ userId: 'user-1' })
    expect(result).toEqual({ exposures: [], connectedLeagueCount: 0 })
  })

  it('reports a player owned in one league as 100% exposure', async () => {
    mockRosterFindMany.mockResolvedValue([{ id: 'roster-1', leagueId: 'league-1', playerData: rosterPlayerData({ starters: [{ id: 'p1', name: 'Player One', position: 'RB' }] }) }])

    const result = await computeUserPlayerExposure({ userId: 'user-1' })

    expect(result.connectedLeagueCount).toBe(1)
    expect(result.exposures).toEqual([
      { playerId: 'p1', sport: 'NFL', idSpace: 'sleeper', exposureKey: 'sleeper:NFL:p1', playerName: 'Player One', position: 'RB', leagueCount: 1, rosterCount: 1, startingCount: 1, benchCount: 0, irTaxiCount: 0, exposurePercent: 1, leaguesRequiringAttention: [], injuryStatus: null, gameWindow: null },
    ])
  })

  it('aggregates a player owned across several leagues with mixed starter/bench placement', async () => {
    mockRosterFindMany.mockResolvedValue([
      { id: 'roster-1', leagueId: 'league-1', playerData: rosterPlayerData({ starters: [{ id: 'p1', name: 'Player One', position: 'RB' }] }) },
      { id: 'roster-2', leagueId: 'league-2', playerData: rosterPlayerData({ bench: [{ id: 'p1', name: 'Player One', position: 'RB' }] }) },
      { id: 'roster-3', leagueId: 'league-3', playerData: rosterPlayerData({}) },
    ])

    const result = await computeUserPlayerExposure({ userId: 'user-1' })
    const exposure = result.exposures.find((e) => e.playerId === 'p1')

    expect(result.connectedLeagueCount).toBe(3)
    expect(exposure).toMatchObject({ leagueCount: 2, rosterCount: 2, startingCount: 1, benchCount: 1, irTaxiCount: 0, exposurePercent: 2 / 3 })
  })

  it('counts IR and taxi placements together as irTaxiCount', async () => {
    mockRosterFindMany.mockResolvedValue([
      { id: 'roster-1', leagueId: 'league-1', playerData: rosterPlayerData({ ir: [{ id: 'p1', name: 'Player One', position: 'RB' }] }) },
      { id: 'roster-2', leagueId: 'league-2', playerData: rosterPlayerData({ taxi: [{ id: 'p1', name: 'Player One', position: 'RB' }] }) },
    ])

    const result = await computeUserPlayerExposure({ userId: 'user-1' })
    const exposure = result.exposures.find((e) => e.playerId === 'p1')
    expect(exposure?.irTaxiCount).toBe(2)
  })

  it('resolves duplicate-provider identity via linked platformUserIds (native userId + sleeperUserId)', async () => {
    mockUserProfileFindUnique.mockResolvedValue({ sleeperUserId: 'sleeper-123' })
    mockRosterFindMany.mockResolvedValue([{ id: 'roster-1', leagueId: 'league-1', playerData: rosterPlayerData({ starters: [{ id: 'p1', name: 'Player One', position: 'RB' }] }) }])

    await computeUserPlayerExposure({ userId: 'user-1' })

    expect(mockRosterFindMany).toHaveBeenCalledWith({
      where: { platformUserId: { in: ['user-1', 'sleeper-123'] } },
      select: { id: true, leagueId: true, playerData: true, league: { select: { platform: true, sport: true } } },
    })
  })

  it('skips a lineup section row with no resolvable player id', async () => {
    mockRosterFindMany.mockResolvedValue([{ id: 'roster-1', leagueId: 'league-1', playerData: rosterPlayerData({ starters: [{ position: 'RB' }] }) }])
    const result = await computeUserPlayerExposure({ userId: 'user-1' })
    expect(result.exposures).toEqual([])
  })

  it('never merges one number from two id spaces into one player (Sleeper NFL 1332 vs a native NHL roster)', async () => {
    // 1332 is Sleeper's Ifeanyi Momah and, on the production native NHL roster, Rolling Insights'
    // Alan Quine — two people. Merged on the bare id they were one "player on 2 of your rosters".
    mockRosterFindMany.mockResolvedValue([
      { id: 'r-1', leagueId: 'league-nfl', playerData: rosterPlayerData({ starters: [{ id: '1332', name: 'Ifeanyi Momah', position: 'WR' }] }), league: { platform: 'sleeper', sport: 'NFL' } },
      { id: 'r-2', leagueId: 'league-nhl', playerData: rosterPlayerData({ starters: [{ id: '1332', name: 'Alan Quine', position: 'C' }] }), league: { platform: 'manual', sport: 'NHL' } },
    ])
    const result = await computeUserPlayerExposure({ userId: 'user-1' })
    expect(result.exposures.map((e) => [e.exposureKey, e.playerName, e.leagueCount])).toEqual([
      ['sleeper:NFL:1332', 'Ifeanyi Momah', 1],
      ['sleeper:NHL:1332', 'Alan Quine', 1],
    ])
  })
})
