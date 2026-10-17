/**
 * Tests for GameDayContextAssembler.ts — mocks the true external boundaries
 * (prisma, buildMatchupCenterPayload, resolveCurrentWeek). MatchupStateNormalizer
 * is real/pure and runs unmocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLeagueFindUnique, mockBuildMatchupCenterPayload, mockResolveCurrentWeek } = vi.hoisted(() => ({
  mockLeagueFindUnique: vi.fn(),
  mockBuildMatchupCenterPayload: vi.fn(),
  mockResolveCurrentWeek: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: mockLeagueFindUnique } } }))
vi.mock('@/server/services/matchupCenterService', () => ({ buildMatchupCenterPayload: mockBuildMatchupCenterPayload }))
vi.mock('@/lib/chimmy-context/providers/_helpers/currentWeek', () => ({ resolveCurrentWeek: mockResolveCurrentWeek }))

import { buildLeagueGameDayContext } from '@/lib/shared-services/game-day/GameDayContextAssembler'

const RESOLVED_WEEK = { leagueId: 'league-1', season: 2026, week: 5, source: 'redraftSeason', playoffStartWeek: 15, isPlayoffWeek: false, weeksUntilPlayoffs: 10 }

describe('buildLeagueGameDayContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveCurrentWeek.mockResolvedValue(RESOLVED_WEEK)
  })

  it('reports unavailable honestly when the league does not exist', async () => {
    mockLeagueFindUnique.mockResolvedValue(null)
    const ctx = await buildLeagueGameDayContext({ leagueId: 'league-1', viewerUserId: 'user-1' })
    expect(ctx.unavailableReason).toBe('League not found.')
    expect(ctx.matchupState.state).toBe('unavailable')
    expect(mockBuildMatchupCenterPayload).not.toHaveBeenCalled()
  })

  it('assembles a real context reusing buildMatchupCenterPayload + resolveCurrentWeek', async () => {
    mockLeagueFindUnique.mockResolvedValue({ sport: 'NFL', platform: 'sleeper', season: 2026 })
    mockBuildMatchupCenterPayload.mockResolvedValue({
      leagueId: 'league-1',
      season: 2026,
      week: 5,
      sport: 'NFL',
      matchupStatus: 'live',
      conceptOverlay: null,
      left: { rosterId: 'roster-1', teamName: 'My Team', avatarUrl: null, record: { wins: 3, losses: 2, ties: 0 }, winPct: 0.6, totalPoints: 40, projectedTotal: 100, starters: [], remainingStarters: 5 },
      right: { rosterId: 'roster-2', teamName: 'Opp', avatarUrl: null, record: { wins: 2, losses: 3, ties: 0 }, winPct: 0.4, totalPoints: 30, projectedTotal: 90, starters: [], remainingStarters: 5 },
      winProbabilityLeft: 0.55,
      insights: { matchupEdge: '', startSit: '', weather: '', injuryNews: '', swingPlayers: [], riskLevel: 'low', floorVsCeiling: '' },
      partialData: false,
      refreshIntervalMs: 15000,
    })

    const ctx = await buildLeagueGameDayContext({ leagueId: 'league-1', viewerUserId: 'user-1' })

    expect(mockResolveCurrentWeek).toHaveBeenCalledWith({ leagueId: 'league-1', week: undefined, season: undefined })
    expect(mockBuildMatchupCenterPayload).toHaveBeenCalledWith({ leagueId: 'league-1', viewerUserId: 'user-1', season: 2026, week: 5 })
    expect(ctx.season).toBe(2026)
    expect(ctx.week).toBe(5)
    expect(ctx.sport).toBe('NFL')
    expect(ctx.platform).toBe('sleeper')
    expect(ctx.weekResolution.source).toBe('redraftSeason')
    expect(ctx.matchup?.matchupStatus).toBe('live')
    expect(ctx.matchupState.state).toBe('live')
    expect(ctx.unavailableReason).toBeNull()
  })

  it('reports the real error and a null matchup when buildMatchupCenterPayload itself fails', async () => {
    mockLeagueFindUnique.mockResolvedValue({ sport: 'NFL', platform: 'sleeper', season: 2026 })
    mockBuildMatchupCenterPayload.mockResolvedValue({ error: 'Roster not found', status: 404 })

    const ctx = await buildLeagueGameDayContext({ leagueId: 'league-1', viewerUserId: 'user-1' })

    expect(ctx.matchup).toBeNull()
    expect(ctx.unavailableReason).toBe('Roster not found')
    expect(ctx.matchupState.state).toBe('unavailable')
  })

  it('passes explicit season/week overrides through to both resolveCurrentWeek and buildMatchupCenterPayload', async () => {
    mockLeagueFindUnique.mockResolvedValue({ sport: 'NFL', platform: 'sleeper', season: 2026 })
    mockBuildMatchupCenterPayload.mockResolvedValue({ error: 'Roster not found', status: 404 })

    await buildLeagueGameDayContext({ leagueId: 'league-1', viewerUserId: 'user-1', season: 2025, week: 12 })

    expect(mockResolveCurrentWeek).toHaveBeenCalledWith({ leagueId: 'league-1', week: 12, season: 2025 })
    expect(mockBuildMatchupCenterPayload).toHaveBeenCalledWith({ leagueId: 'league-1', viewerUserId: 'user-1', season: 2025, week: 12 })
  })
})
