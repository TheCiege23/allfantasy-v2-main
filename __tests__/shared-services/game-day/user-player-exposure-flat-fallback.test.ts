import { describe, expect, it, vi } from 'vitest'

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

// Phase 33: real finding via .env.test execution -- 2 of 3 real Sleeper-imported leagues'
// rosters carry only the flat, platform-native players/starters/taxi/reserve ID-array fields,
// never `lineup_sections`. getNormalizedLineupSections() alone silently produced an EMPTY
// roster for that real, common shape, undercounting real cross-league exposure down to
// whatever the one roster that happened to have lineup_sections contributed (measured: 1
// player instead of the real ~10+ per league). This is the exact same real gap Phase 13
// found and fixed in WaiverContextAssembler.ts's flatSectionsFromPlayerData() -- reused here.
describe('computeUserPlayerExposure — flat (non-normalized) Sleeper roster fallback (Phase 33)', () => {
  const REAL_SLEEPER_SHAPE_PLAYER_DATA = {
    players: ['100', '200', '300'],
    starters: ['100', '200'],
    taxi: [],
    reserve: [],
    import: { provider: 'sleeper' },
    // No lineup_sections key -- the real, common shape confirmed this phase.
  }

  it('counts real players from flat starters/players/taxi/reserve arrays when lineup_sections is absent', async () => {
    mockUserProfileFindUnique.mockResolvedValue({ sleeperUserId: null })
    mockRosterFindMany.mockResolvedValue([
      { id: 'roster-1', leagueId: 'league-1', playerData: REAL_SLEEPER_SHAPE_PLAYER_DATA },
    ])

    const result = await computeUserPlayerExposure({ userId: 'user-1' })

    expect(result.exposures.length).toBe(3)
    const starter = result.exposures.find((e) => e.playerId === '100')
    expect(starter?.startingCount).toBe(1)
    const bench = result.exposures.find((e) => e.playerId === '300')
    expect(bench?.benchCount).toBe(1)
  })

  it('leaves playerName/position honestly null for flat-fallback players (no fabricated identity)', async () => {
    mockUserProfileFindUnique.mockResolvedValue({ sleeperUserId: null })
    mockRosterFindMany.mockResolvedValue([
      { id: 'roster-1', leagueId: 'league-1', playerData: REAL_SLEEPER_SHAPE_PLAYER_DATA },
    ])

    const result = await computeUserPlayerExposure({ userId: 'user-1' })
    for (const e of result.exposures) {
      expect(e.playerName).toBeNull()
      expect(e.position).toBeNull()
    }
  })

  it('aggregates a flat-shape player across leagues alongside a lineup_sections-normalized league', async () => {
    mockUserProfileFindUnique.mockResolvedValue({ sleeperUserId: null })
    mockRosterFindMany.mockResolvedValue([
      { id: 'roster-1', leagueId: 'league-1', playerData: REAL_SLEEPER_SHAPE_PLAYER_DATA },
      {
        id: 'roster-2',
        leagueId: 'league-2',
        playerData: { lineup_sections: { starters: [{ id: '100', name: 'Real Player', position: 'WR' }], bench: [], ir: [], taxi: [], devy: [] } },
      },
    ])

    const result = await computeUserPlayerExposure({ userId: 'user-1' })
    const player100 = result.exposures.find((e) => e.playerId === '100')
    expect(player100?.leagueCount).toBe(2)
    expect(player100?.playerName).toBe('Real Player')
  })

  it('a roster with zero real players in any shape contributes nothing (no crash, no fabrication)', async () => {
    mockUserProfileFindUnique.mockResolvedValue({ sleeperUserId: null })
    mockRosterFindMany.mockResolvedValue([
      { id: 'roster-1', leagueId: 'league-1', playerData: { draftPicks: [], foundation: {} } },
    ])

    const result = await computeUserPlayerExposure({ userId: 'user-1' })
    expect(result.exposures).toEqual([])
    expect(result.connectedLeagueCount).toBe(1)
  })

  it('preserves exact prior behavior when lineup_sections IS already populated (backward compatible)', async () => {
    mockUserProfileFindUnique.mockResolvedValue({ sleeperUserId: null })
    mockRosterFindMany.mockResolvedValue([
      {
        id: 'roster-1',
        leagueId: 'league-1',
        playerData: { lineup_sections: { starters: [{ id: '1', name: 'A', position: 'QB' }], bench: [], ir: [], taxi: [], devy: [] } },
      },
    ])

    const result = await computeUserPlayerExposure({ userId: 'user-1' })
    expect(result.exposures).toHaveLength(1)
    expect(result.exposures[0]).toMatchObject({ playerId: '1', playerName: 'A', position: 'QB', startingCount: 1 })
  })
})
