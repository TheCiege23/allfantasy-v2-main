import { describe, expect, it, vi } from 'vitest'
import { copyImportedHistory } from '@/lib/league-creation/canonical/copyImportedHistory'

function transaction() {
  return Object.fromEntries(['leagueSeason', 'matchupFact', 'draftFact', 'transactionFact', 'seasonStandingFact', 'leagueDynastySeason', 'rosterSnapshot', 'seasonResult'].map(name => [name, {
    findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn(),
  }]))
}

describe('native imported history identity continuity', () => {
  it('maps known team and roster references in their own namespaces without rewriting outcomes', async () => {
    const tx = transaction()
    tx.leagueSeason!.findMany.mockResolvedValue([{
      id: 'old-season', leagueId: 'source', season: 2026, platformLeagueId: 'provider-season', championTeamId: 'source-team',
      teamRecords: [{ teamId: 'source-team', team_id: '1', rosterId: 1, ownerId: 'provider-manager', managerName: 'Alice', wins: 15, pointsFor: 901.25, isChampion: true },
        { rosterId: 'retired-seat', managerName: 'Former manager', wins: 3 }],
    }])
    tx.seasonResult!.findMany.mockResolvedValue([{ id: 'old-result', leagueId: 'source', season: '2026', rosterId: 'source-roster', wins: 15, pointsFor: '901.25', champion: true }])
    tx.draftFact!.findMany.mockResolvedValue([{ draftId: 'old-draft', leagueId: 'source', season: 2026, playerId: 'provider-player', metadata: { playerName: 'Player' } }])
    await copyImportedHistory(tx as never, 'source', 'native', new Map([['source-team', 'native-team'], ['1', 'native-team']]), new Map([['1', 'native-roster'], ['source-roster', 'native-roster']]))
    expect(tx.leagueSeason!.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      leagueId: 'native', season: 2026, championTeamId: 'native-team', platformLeagueId: 'provider-season',
      teamRecords: [{ teamId: 'native-team', team_id: 'native-team', rosterId: 'native-roster', sourceRosterId: 1, ownerId: 'provider-manager', managerName: 'Alice', wins: 15, pointsFor: 901.25, isChampion: true },
        { rosterId: 'retired-seat', managerName: 'Former manager', wins: 3 }],
    })] })
    expect(tx.seasonResult!.createMany).toHaveBeenCalledWith({ data: [{ leagueId: 'native', season: '2026', rosterId: 'native-roster', wins: 15, pointsFor: '901.25', champion: true }] })
    expect(tx.draftFact!.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ playerId: 'provider-player', metadata: expect.objectContaining({ sourcePlayerId: 'provider-player', sourceLeagueId: 'source', importedHistory: true }) })] })
  })

  it('keeps archived managers without a current native seat and nullable records intact', async () => {
    const tx = transaction()
    tx.leagueSeason!.findMany.mockResolvedValue([{ id: 'old', leagueId: 'source', season: 2023, championTeamId: 'former-team', teamRecords: null }])
    tx.seasonResult!.findMany.mockResolvedValue([{ id: 'old-result', leagueId: 'source', season: '2023', rosterId: 'former-seat', champion: true }])
    await copyImportedHistory(tx as never, 'source', 'native', new Map(), new Map())
    expect(tx.leagueSeason!.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ championTeamId: null })] })
    expect(tx.seasonResult!.createMany).toHaveBeenCalledWith({ data: [{ leagueId: 'native', season: '2023', rosterId: 'former-seat', champion: true }] })
  })
})
