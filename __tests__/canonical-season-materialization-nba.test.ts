import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  teamFindMany: vi.fn(),
  seasonFindUnique: vi.fn(),
  seasonCreate: vi.fn(),
  rosterCreate: vi.fn(),
  reconcile: vi.fn(),
  materializePlayers: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    leagueTeam: { findMany: mocks.teamFindMany },
    redraftSeason: { findUnique: mocks.seasonFindUnique, create: mocks.seasonCreate },
    redraftRoster: { create: mocks.rosterCreate },
  },
}))
vi.mock('@/lib/league-runtime/reconcileRosterRedraftLinks', () => ({
  reconcileRosterRedraftLinks: mocks.reconcile,
}))
vi.mock('@/lib/league-runtime/materializeRedraftRosterPlayers', () => ({
  materializeRedraftRosterPlayersForLeague: mocks.materializePlayers,
}))

import { materializeRedraftSeasonForImportedLeague } from '@/lib/league-import/canonicalSeasonMaterialization'

describe('imported NBA season materialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.leagueFindUnique.mockResolvedValue({
      id: 'nba-league', sport: 'NBA', season: 2026, status: 'in_season', playoffStartWeek: 20,
    })
    mocks.seasonFindUnique.mockResolvedValue(null)
    mocks.teamFindMany.mockResolvedValue([
      { id: 'team-1', platformUserId: 'fantrax-user:Ciege82', ownerName: 'Ciege82', teamName: 'Ciege82', avatarUrl: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, currentRank: 1 },
      { id: 'team-2', platformUserId: 'fantrax-manager:opponent', ownerName: 'Opponent', teamName: 'Opponent', avatarUrl: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, currentRank: 2 },
    ])
    mocks.seasonCreate.mockResolvedValue({ id: 'nba-season' })
    mocks.rosterCreate.mockResolvedValue({ id: 'roster' })
    mocks.reconcile.mockResolvedValue(undefined)
    mocks.materializePlayers.mockResolvedValue(undefined)
  })

  it('creates the NBA season and both teams, then projects their players for trade analysis', async () => {
    const result = await materializeRedraftSeasonForImportedLeague('nba-league')
    expect(result).toMatchObject({ seasonId: 'nba-season', created: true, rosterCount: 2 })
    expect(mocks.seasonCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leagueId: 'nba-league', sport: 'NBA', playoffStartWeek: 20 }),
    }))
    expect(mocks.rosterCreate).toHaveBeenCalledTimes(2)
    expect(mocks.reconcile).toHaveBeenCalledWith('nba-league')
    expect(mocks.materializePlayers).toHaveBeenCalledWith('nba-league', { sport: 'NBA' })
  })
})
