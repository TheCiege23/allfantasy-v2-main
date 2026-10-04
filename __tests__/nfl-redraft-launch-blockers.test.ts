import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  adminAuditLog: { create: vi.fn() },
  league: { findFirst: vi.fn() },
  playerGameLogCache: { findMany: vi.fn() },
  playerIdentityMap: { findFirst: vi.fn() },
  playerWeeklyScore: { upsert: vi.fn(), findUnique: vi.fn() },
  redraftLeagueTransaction: { create: vi.fn() },
  redraftMatchup: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  redraftRoster: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  redraftSeason: { findFirst: vi.fn(), findUnique: vi.fn() },
  redraftWaiverClaim: { findMany: vi.fn(), update: vi.fn() },
  sportsPlayer: { findFirst: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: vi.fn(async () => false),
  calculateOfficialTeamScore: vi.fn(async () => ({ officialScore: 0 })),
}))

vi.mock('@/lib/c2c/scoringEngine', () => ({
  leagueUsesC2CEngine: vi.fn(async () => false),
  updateC2CMatchupScores: vi.fn(),
}))

vi.mock('@/lib/idp/capEngine', () => ({
  assignIdpCapSalaryForWaiverClaim: vi.fn(async () => undefined),
}))

describe('NFL redraft launch blockers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.redraftSeason.findUnique.mockResolvedValue({ id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026, league: { settings: { scoring_mode: 'points' } } })
    prismaMock.adminAuditLog.create.mockResolvedValue({ id: 'audit-1' })
    prismaMock.league.findFirst.mockResolvedValue({ sport: 'NFL', settings: { sportConfig: { scoringPreset: 'PPR' } } })
    prismaMock.playerIdentityMap.findFirst.mockResolvedValue(null)
    prismaMock.playerWeeklyScore.upsert.mockResolvedValue({})
    prismaMock.redraftLeagueTransaction.create.mockResolvedValue({})
    prismaMock.redraftRoster.update.mockResolvedValue({})
    prismaMock.redraftRosterPlayer.create.mockResolvedValue({})
    prismaMock.redraftRosterPlayer.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.redraftWaiverClaim.update.mockResolvedValue({})
    prismaMock.sportsPlayer.findFirst.mockResolvedValue(null)
  })

  it('syncs cached Sleeper NFL week rows into PlayerWeeklyScore', async () => {
    prismaMock.redraftSeason.findFirst.mockResolvedValue({
      id: 'season-1',
      leagueId: 'league-1',
      sport: 'NFL',
      season: 2026,
      currentWeek: 1,
    })
    prismaMock.redraftRoster.findMany.mockResolvedValue([{ id: 'roster-1' }])
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([{ playerId: 'player-1', sport: 'NFL' }])
    prismaMock.playerGameLogCache.findMany.mockResolvedValue([
      {
        playerId: 'player-1',
        payload: [{ week: 1, pass_yd: 250, pass_td: 2, rec: 1 }],
      },
    ])

    const { syncPlayerWeeklyScoresForRedraftSeason } = await import('@/lib/redraft/playerWeeklyScoreService')
    const summary = await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: 'season-1', week: 1, actorId: 'admin-1' })

    expect(summary.scoresUpserted).toBe(1)
    expect(prismaMock.playerWeeklyScore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          playerId_week_season_sport: {
            playerId: 'player-1',
            week: 1,
            season: 2026,
            sport: 'NFL',
          },
        },
        update: expect.objectContaining({
          stats: expect.objectContaining({ pass_yds: 250, pass_td: 2, rec: 1 }),
          fantasyPts: 19,
        }),
      }),
    )
  })

  it('recalculates standings only from complete scored matchups', async () => {
    prismaMock.redraftRoster.findMany.mockResolvedValue([{ id: 'home' }, { id: 'away' }])
    prismaMock.redraftMatchup.findMany.mockResolvedValue([
      {
        id: 'matchup-1',
        homeRosterId: 'home',
        awayRosterId: 'away',
        homeScore: 101.25,
        awayScore: 99.1,
        status: 'active',
        lineupSnapshots: { redraftScoring: { isComplete: true } },
        week: 1,
      },
      {
        id: 'matchup-2',
        homeRosterId: 'home',
        awayRosterId: 'away',
        homeScore: 0,
        awayScore: 0,
        status: 'active',
        lineupSnapshots: { redraftScoring: { isComplete: false } },
        week: 2,
      },
    ])

    const { updateStandings } = await import('@/lib/redraft/standingsEngine')
    const result = await updateStandings('season-1', 2)

    expect(result.matchupsCounted).toBe(1)
    expect(prismaMock.redraftRoster.update).toHaveBeenCalledWith({
      where: { id: 'home' },
      data: expect.objectContaining({ wins: 1, losses: 0, pointsFor: 101.25, pointsAgainst: 99.1, streak: 'W1' }),
    })
    expect(prismaMock.redraftRoster.update).toHaveBeenCalledWith({
      where: { id: 'away' },
      data: expect.objectContaining({ wins: 0, losses: 1, pointsFor: 99.1, pointsAgainst: 101.25, streak: 'L1' }),
    })
  })

  it('approves one waiver claim, writes roster/audit rows, and denies duplicate winners', async () => {
    prismaMock.redraftSeason.findFirst.mockResolvedValue({
      id: 'season-1',
      leagueId: 'league-1',
      sport: 'NFL',
    })
    prismaMock.redraftWaiverClaim.findMany.mockResolvedValue([
      {
        id: 'claim-1',
        rosterId: 'roster-1',
        addPlayerId: 'player-2',
        addPlayerName: 'Free Agent',
        dropPlayerId: 'drop-1',
        dropPlayerName: 'Dropped Player',
        bidAmount: 10,
        priority: 1,
      },
      {
        id: 'claim-2',
        rosterId: 'roster-2',
        addPlayerId: 'player-2',
        addPlayerName: 'Free Agent',
        dropPlayerId: null,
        dropPlayerName: null,
        bidAmount: 0,
        priority: 2,
      },
    ])
    prismaMock.redraftRoster.findFirst
      .mockResolvedValueOnce({ id: 'roster-1', faabBalance: 100 })
      .mockResolvedValueOnce({ id: 'roster-2', faabBalance: 100 })
    prismaMock.redraftRoster.findMany.mockResolvedValue([{ waiverPriority: 2 }])
    prismaMock.redraftRosterPlayer.findFirst.mockResolvedValue(null)
    prismaMock.sportsPlayer.findFirst.mockResolvedValue({ name: 'Free Agent', position: 'WR', team: 'KC' })

    const { processWaiverWindow } = await import('@/lib/redraft/waiverEngine')
    const result = await processWaiverWindow('league-1', 'season-1')

    expect(result).toEqual([
      { claimId: 'claim-1', status: 'approved', reason: undefined },
      { claimId: 'claim-2', status: 'denied', reason: 'Another claim in this waiver run already won this player.' },
    ])
    expect(prismaMock.redraftRosterPlayer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rosterId: 'roster-1',
          playerId: 'player-2',
          position: 'WR',
          acquisitionType: 'waiver',
        }),
      }),
    )
    expect(prismaMock.redraftLeagueTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'waiver_claim_approved',
          rosterId: 'roster-1',
        }),
      }),
    )
  })
})
