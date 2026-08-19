import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRosterFindMany } = vi.hoisted(() => ({ mockRosterFindMany: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { roster: { findMany: mockRosterFindMany } },
}))

import { countDistinctLeaguesWithRosterData, loadManagerRosterSnapshots } from '@/lib/shared-services/knowledge-graph/RosterSnapshotLoader'

describe('loadManagerRosterSnapshots', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries by platformUserId and parses playerData via the shared roster-utils parser', async () => {
    mockRosterFindMany.mockResolvedValue([
      { leagueId: 'league-1', playerData: { players: ['player-a', 'player-b'] } },
      { leagueId: 'league-2', playerData: ['player-c'] },
    ])

    const snapshots = await loadManagerRosterSnapshots('user-1')

    expect(mockRosterFindMany).toHaveBeenCalledWith({
      where: { platformUserId: 'user-1' },
      select: { leagueId: true, playerData: true },
    })
    expect(snapshots).toEqual([
      { leagueId: 'league-1', playerIds: ['player-a', 'player-b'] },
      { leagueId: 'league-2', playerIds: ['player-c'] },
    ])
  })

  it('returns an empty array for a manager with no rosters', async () => {
    mockRosterFindMany.mockResolvedValue([])
    expect(await loadManagerRosterSnapshots('nobody')).toEqual([])
  })
})

describe('countDistinctLeaguesWithRosterData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries distinct leagueIds across all roster data, independent of any one manager', async () => {
    mockRosterFindMany.mockResolvedValue([{ leagueId: 'league-1' }, { leagueId: 'league-2' }])

    const count = await countDistinctLeaguesWithRosterData()

    expect(mockRosterFindMany).toHaveBeenCalledWith({ distinct: ['leagueId'], select: { leagueId: true } })
    expect(count).toBe(2)
  })
})
