/**
 * Universal League Hub — Part 1 canonical League Portfolio service.
 *
 * Deliberately mocks `getDashboardLeagueListForUser` rather than re-testing
 * its own merge/dedup logic (already covered by that module's own tests,
 * and this program's own guardrail against duplicating provider-specific
 * logic) — this suite only proves the *enrichment* this service adds on
 * top: canonical shape, LeagueTeam record, playoff-probability snapshot
 * lookup, capability badges, sync freshness.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDashboardLeagueListForUserMock, leagueTeamFindMany, forecastFindMany } = vi.hoisted(() => ({
  getDashboardLeagueListForUserMock: vi.fn(),
  leagueTeamFindMany: vi.fn(),
  forecastFindMany: vi.fn(),
}))

vi.mock('@/lib/dashboard/get-dashboard-league-list', () => ({
  getDashboardLeagueListForUser: getDashboardLeagueListForUserMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: leagueTeamFindMany },
    seasonForecastSnapshot: { findMany: forecastFindMany },
  },
}))

describe('getLeaguePortfolioForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leagueTeamFindMany.mockResolvedValue([])
    forecastFindMany.mockResolvedValue([])
  })

  it('normalizes a native AllFantasy league with zero LeagueTeam/forecast lookups skipped when no canonical rows exist', async () => {
    getDashboardLeagueListForUserMock.mockResolvedValue({
      leagues: [],
      sleeperUserId: null,
    })

    const { getLeaguePortfolioForUser } = await import('@/lib/shared-services/league-hub/LeaguePortfolioService')
    const result = await getLeaguePortfolioForUser('user-1')

    expect(result.leagues).toEqual([])
    expect(leagueTeamFindMany).not.toHaveBeenCalled()
  })

  it('enriches a canonical league with the viewer team record and matching playoff-probability snapshot', async () => {
    getDashboardLeagueListForUserMock.mockResolvedValue({
      leagues: [
        {
          id: 'league-1',
          name: 'Dynasty Warriors',
          sport: 'NFL',
          sport_type: 'NFL',
          platform: 'sleeper',
          season: 2026,
          status: 'in_season',
          isCommissioner: true,
          syncStatus: 'success',
          syncError: null,
          lastSyncedAt: new Date('2026-07-11T00:00:00Z'),
          createdAt: new Date('2026-01-01T00:00:00Z'),
          settings: null,
          navigationLeagueId: 'league-1',
          unifiedLeagueId: 'league-1',
          hasUnifiedRecord: true,
        },
      ],
      sleeperUserId: 'sleeper-user-1',
    })
    leagueTeamFindMany.mockResolvedValue([
      { id: 'team-1', leagueId: 'league-1', teamName: 'My Team', wins: 8, losses: 5, ties: 0, currentRank: 2 },
    ])
    forecastFindMany.mockResolvedValue([
      { leagueId: 'league-1', week: 10, teamForecasts: [{ teamId: 'team-1', playoffProbability: 0.73 }] },
    ])

    const { getLeaguePortfolioForUser } = await import('@/lib/shared-services/league-hub/LeaguePortfolioService')
    const result = await getLeaguePortfolioForUser('user-1')

    expect(result.leagues).toHaveLength(1)
    const entry = result.leagues[0]
    expect(entry.canonicalLeagueId).toBe('league-1')
    expect(entry.hasCanonicalRecord).toBe(true)
    expect(entry.provider).toBe('sleeper')
    expect(entry.userTeam).toEqual({
      id: 'team-1',
      name: 'My Team',
      record: { wins: 8, losses: 5, ties: 0 },
      standingsPosition: 2,
    })
    expect(entry.playoffProbability).toBe(0.73)
    expect(entry.capabilities).toContain('commissioner_verified')
    expect(entry.syncFreshness.state).toBe('stale')
    expect(entry.recommendations.totalCount).toBe(0)
    expect(leagueTeamFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: { in: ['league-1'] }, claimedByUserId: 'user-1' } })
    )
  })

  it('leaves playoffProbability null when no snapshot matches the viewer team id', async () => {
    getDashboardLeagueListForUserMock.mockResolvedValue({
      leagues: [
        {
          id: 'league-2',
          name: 'No Forecast League',
          sport: 'NFL',
          platform: 'espn',
          season: 2026,
          status: 'in_season',
          isCommissioner: false,
          syncStatus: 'success',
          lastSyncedAt: new Date(),
          createdAt: new Date(),
          settings: null,
          navigationLeagueId: 'league-2',
          unifiedLeagueId: 'league-2',
          hasUnifiedRecord: true,
        },
      ],
      sleeperUserId: null,
    })
    leagueTeamFindMany.mockResolvedValue([
      { id: 'team-2', leagueId: 'league-2', teamName: 'Other Team', wins: 3, losses: 10, ties: 0, currentRank: 9 },
    ])
    forecastFindMany.mockResolvedValue([
      { leagueId: 'league-2', week: 10, teamForecasts: [{ teamId: 'someone-elses-team', playoffProbability: 0.9 }] },
    ])

    const { getLeaguePortfolioForUser } = await import('@/lib/shared-services/league-hub/LeaguePortfolioService')
    const result = await getLeaguePortfolioForUser('user-1')

    expect(result.leagues[0].playoffProbability).toBeNull()
  })

  it('never claims a canonical record for a legacy Sleeper row with no unified League row', async () => {
    getDashboardLeagueListForUserMock.mockResolvedValue({
      leagues: [
        {
          id: 'sleeper-legacy-1',
          name: 'Orphan Sleeper League',
          sport: 'NFL',
          platform: 'sleeper',
          season: 2026,
          status: 'in_season',
          isCommissioner: false,
          syncStatus: 'success',
          lastSyncedAt: new Date(),
          createdAt: new Date(),
          navigationLeagueId: null,
          unifiedLeagueId: null,
          hasUnifiedRecord: false,
        },
      ],
      sleeperUserId: 'sleeper-user-1',
    })

    const { getLeaguePortfolioForUser } = await import('@/lib/shared-services/league-hub/LeaguePortfolioService')
    const result = await getLeaguePortfolioForUser('user-1')

    expect(result.leagues[0].hasCanonicalRecord).toBe(false)
    expect(result.leagues[0].canonicalLeagueId).toBe('sleeper-legacy-1')
    expect(result.leagues[0].playoffProbability).toBeNull()
    expect(result.leagues[0].userTeam.id).toBeNull()
    expect(leagueTeamFindMany).not.toHaveBeenCalled()
  })
})
