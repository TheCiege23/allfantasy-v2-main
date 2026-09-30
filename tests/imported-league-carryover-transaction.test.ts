import { describe, expect, it, vi } from 'vitest'
import { carryOverImportedLeague } from '@/lib/league-creation/canonical/carryOverImportedLeague'

function transaction() {
  const teams = [
    { id: 'source-team-1', externalId: 'seat-1', platformUserId: 'manager-1', claimedByUserId: 'creator', teamName: 'Aces', ownerName: 'Alice', avatarUrl: null, isCommissioner: true },
    { id: 'source-team-2', externalId: 'seat-2', platformUserId: 'manager-2', claimedByUserId: 'friend', teamName: 'Bears', ownerName: 'Bob', avatarUrl: null, isCommissioner: false },
  ]
  const rosters = [
    { id: 'source-roster-1', platformUserId: 'manager-1', playerData: { source_team_id: 'seat-1', players: ['sleeper-1'] }, faabRemaining: 50, waiverPriority: 1 },
    { id: 'source-roster-2', platformUserId: 'manager-2', playerData: { source_team_id: 'seat-2', players: ['sleeper-2'] }, faabRemaining: 75, waiverPriority: 2 },
  ]
  return {
    league: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) =>
        where.id === 'source' ? { platform: 'sleeper', sport: 'NFL' } : { settings: { existing: true } }),
      update: vi.fn(),
    },
    leagueTeam: { findMany: vi.fn().mockResolvedValue(teams), update: vi.fn() },
    roster: {
      findMany: vi.fn().mockResolvedValue(rosters),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => ({ id: where.id, platformUserId: where.id })),
      update: vi.fn(),
    },
    leagueEntrySlot: {
      findMany: vi.fn().mockResolvedValue([{ slotNumber: 1, rosterId: 'native-roster-1' }, { slotNumber: 2, rosterId: 'native-roster-2' }]),
      updateMany: vi.fn(),
    },
    draftSession: { findFirst: vi.fn().mockResolvedValue({ id: 'native-draft' }), update: vi.fn() },
    draftPick: { createMany: vi.fn() },
    redraftLeagueMember: { create: vi.fn() },
    playerIdentityMap: { findMany: vi.fn().mockResolvedValue([
      { sleeperId: 'sleeper-1', canonicalName: 'First Player', position: 'QB', currentTeam: 'BUF' },
      { sleeperId: 'sleeper-2', canonicalName: 'Second Player', position: 'RB', currentTeam: 'NYG' },
    ]) },
    player: { findMany: vi.fn().mockResolvedValue([]) },
  }
}

describe('standalone carryover transaction', () => {
  it('carries claimed manager seats and produces a completed native draft snapshot', async () => {
    const tx = transaction()
    const count = await carryOverImportedLeague(tx as never, {
      sourceLeagueId: 'source', targetLeagueId: 'native', creatorUserId: 'creator', sport: 'NFL', teamCount: 2,
    })
    expect(count).toBe(2)
    expect(tx.roster.update).toHaveBeenCalledTimes(2)
    expect(tx.leagueTeam.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ claimedByUserId: 'friend', teamName: 'Bears' }),
    }))
    expect(tx.redraftLeagueMember.create).toHaveBeenCalledWith({ data: {
      leagueId: 'native', userId: 'friend', role: 'MEMBER', teamNumber: 2,
    } })
    expect(tx.draftSession.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed', draftModeLabel: 'imported_rosters' }),
    }))
    expect(tx.draftPick.createMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ rosterId: 'native-roster-1', playerId: 'sleeper-1', source: 'import' }),
      expect.objectContaining({ rosterId: 'native-roster-2', playerId: 'sleeper-2', source: 'import' }),
    ] })
    expect(tx.league.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { settings: expect.objectContaining({ existing: true, importCarryover: expect.objectContaining({ playerCount: 2, teamCount: 2 }) }) },
    }))
  })

  it('refuses an unmapped player before writing any target roster', async () => {
    const tx = transaction()
    tx.playerIdentityMap.findMany.mockResolvedValue([])
    await expect(carryOverImportedLeague(tx as never, {
      sourceLeagueId: 'source', targetLeagueId: 'native', creatorUserId: 'creator', sport: 'NFL', teamCount: 2,
    })).rejects.toThrow(/cannot be verified/)
    expect(tx.roster.update).not.toHaveBeenCalled()
    expect(tx.draftPick.createMany).not.toHaveBeenCalled()
  })
})
