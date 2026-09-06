import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 🛑 `KeeperPickAdjustment` HAD ZERO WRITERS.
 *
 * `getKeeperDraftOrder` (lib/keeper/draftIntegration.ts) already reads this
 * table and groups adjustments by forfeited round — real, working consumer
 * code. But nothing ever created a row, so a dynasty league's rookie-draft
 * pick-forfeiture count always read zero regardless of keeper cost rules,
 * and `CarryoverResult.byTeam[].forfeited` was declared in the type but
 * never populated.
 *
 * These tests pin: a round-cost keeper forfeits that round (writes the
 * adjustment, appears in `forfeited`); an auction-cost keeper (no
 * `costRound`) forfeits nothing, since it pays auction dollars instead.
 */

const {
  findManyRedraftRoster,
  findManyKeeperRecord,
  createRedraftRosterPlayer,
  createKeeperPickAdjustment,
  createKeeperAuditLog,
} = vi.hoisted(() => ({
  findManyRedraftRoster: vi.fn(),
  findManyKeeperRecord: vi.fn(),
  createRedraftRosterPlayer: vi.fn(),
  createKeeperPickAdjustment: vi.fn(),
  createKeeperAuditLog: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftRoster: { findMany: findManyRedraftRoster },
    keeperRecord: { findMany: findManyKeeperRecord },
    redraftRosterPlayer: { create: createRedraftRosterPlayer },
    keeperPickAdjustment: { create: createKeeperPickAdjustment },
    keeperAuditLog: { create: createKeeperAuditLog },
  },
}))

import { executeSeasonCarryover } from '@/lib/keeper/carryoverEngine'

beforeEach(() => {
  vi.clearAllMocks()
  findManyRedraftRoster.mockResolvedValue([{ id: 'roster-1', teamName: 'Team A' }])
})

describe('executeSeasonCarryover — KeeperPickAdjustment writes', () => {
  it('writes a pick adjustment and reports the forfeit for a round-cost keeper', async () => {
    findManyKeeperRecord.mockResolvedValue([
      {
        id: 'keeper-1',
        rosterId: 'roster-1',
        playerId: 'p1',
        playerName: 'Star Player',
        position: 'WR',
        team: 'KC',
        sport: 'NFL',
        acquisitionType: 'drafted',
        costRound: 3,
      },
    ])

    const result = await executeSeasonCarryover('league-1', 'season-1', 'season-2')

    expect(createKeeperPickAdjustment).toHaveBeenCalledWith({
      data: {
        leagueId: 'league-1',
        seasonId: 'season-2',
        rosterId: 'roster-1',
        keeperRecordId: 'keeper-1',
        pickRoundForfeited: 3,
        reason: 'Keeper: Star Player',
      },
    })
    expect(result.byTeam[0]!.forfeited).toEqual(['Star Player'])
    expect(result.totalKept).toBe(1)
  })

  it('does not forfeit a pick for an auction-cost keeper (no costRound)', async () => {
    findManyKeeperRecord.mockResolvedValue([
      {
        id: 'keeper-2',
        rosterId: 'roster-1',
        playerId: 'p2',
        playerName: 'Auction Keep',
        position: 'RB',
        team: 'SF',
        sport: 'NFL',
        acquisitionType: 'auction',
        costRound: null,
        costAuctionValue: 42,
      },
    ])

    const result = await executeSeasonCarryover('league-1', 'season-1', 'season-2')

    expect(createKeeperPickAdjustment).not.toHaveBeenCalled()
    expect(result.byTeam[0]!.forfeited).toEqual([])
    expect(result.byTeam[0]!.keptPlayers).toEqual(['Auction Keep'])
  })
})
