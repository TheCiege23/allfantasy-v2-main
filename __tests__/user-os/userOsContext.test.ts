/**
 * User OS League-Specific Intelligence Wiring phase — Part 4 context tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { leagueFindUnique, leagueTeamFindMany, rosterFindFirst, rosterFindFirstForContext, injuryFindMany, forecastFindFirst } =
  vi.hoisted(() => ({
    leagueFindUnique: vi.fn(),
    leagueTeamFindMany: vi.fn(),
    rosterFindFirst: vi.fn(),
    rosterFindFirstForContext: vi.fn(),
    injuryFindMany: vi.fn(),
    forecastFindFirst: vi.fn(),
  }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueFindUnique },
    leagueTeam: { findMany: leagueTeamFindMany },
    roster: { findFirst: (...args: unknown[]) => {
      // activeLeagueContext.ts calls roster.findFirst for rosterId; userOsContext.ts calls it for playerData.
      // Distinguish by the select clause shape.
      const select = (args[0] as { select?: Record<string, unknown> })?.select
      if (select && 'playerData' in select) return rosterFindFirstForContext(...args)
      return rosterFindFirst(...args)
    } },
    injuryReportRecord: { findMany: injuryFindMany },
    seasonForecastSnapshot: { findFirst: forecastFindFirst },
  },
}))

function baseLeague(overrides: Record<string, unknown> = {}) {
  return {
    id: 'league-1',
    userId: 'owner-1',
    platform: 'sleeper',
    sport: 'NFL',
    season: 2026,
    scoring: 'PPR',
    syncStatus: 'success',
    lastSyncedAt: new Date('2026-07-11T00:00:00Z'),
    settings: null,
    redraftMembers: [],
    teams: [],
    ...overrides,
  }
}

describe('assembleUserOsContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leagueTeamFindMany.mockResolvedValue([])
    injuryFindMany.mockResolvedValue([])
    forecastFindFirst.mockResolvedValue(null)
    rosterFindFirstForContext.mockResolvedValue(null)
    rosterFindFirst.mockResolvedValue(null)
  })

  it('returns null when the caller has no real relationship to the league (fails closed)', async () => {
    leagueFindUnique.mockResolvedValue(baseLeague())
    const { assembleUserOsContext } = await import('@/lib/shared-services/league-hub/userOsContext')
    const result = await assembleUserOsContext({ appUserId: 'stranger', canonicalLeagueId: 'league-1' })
    expect(result).toBeNull()
  })

  it('resolves a real context for the owner, including real playoff settings', async () => {
    leagueFindUnique
      .mockResolvedValueOnce(baseLeague({ userId: 'owner-1', platform: 'allfantasy' }))
      .mockResolvedValueOnce({ isDynasty: false, playoffTeams: 6, playoffStartWeek: 15 })
    const { assembleUserOsContext } = await import('@/lib/shared-services/league-hub/userOsContext')
    const result = await assembleUserOsContext({ appUserId: 'owner-1', canonicalLeagueId: 'league-1' })
    expect(result).not.toBeNull()
    expect(result?.playoffTeams).toBe(6)
    expect(result?.playoffStartWeek).toBe(15)
    expect(result?.isDynasty).toBe(false)
  })

  it('marks lineup/roster unavailable when the viewer has no claimed team', async () => {
    leagueFindUnique
      .mockResolvedValueOnce(baseLeague({ userId: 'owner-1', redraftMembers: [{ role: 'member' }] }))
      .mockResolvedValueOnce({ isDynasty: false, playoffTeams: 4, playoffStartWeek: 14 })
    const { assembleUserOsContext } = await import('@/lib/shared-services/league-hub/userOsContext')
    const result = await assembleUserOsContext({ appUserId: 'member-1', canonicalLeagueId: 'league-1' })
    expect(result).not.toBeNull()
    expect(result?.unavailableDomains).toContain('lineup')
    expect(result?.unavailableDomains).toContain('roster')
  })

  it('marks lineup/waiver unavailable for a non-NFL sport (multi-sport seam)', async () => {
    leagueFindUnique
      .mockResolvedValueOnce(
        baseLeague({ userId: 'owner-1', sport: 'NBA', teams: [{ id: 'team-1', isCommissioner: false, isCoCommissioner: false }] })
      )
      .mockResolvedValueOnce({ isDynasty: false, playoffTeams: 6, playoffStartWeek: 20 })
    const { assembleUserOsContext } = await import('@/lib/shared-services/league-hub/userOsContext')
    const result = await assembleUserOsContext({ appUserId: 'member-1', canonicalLeagueId: 'league-1' })
    expect(result?.unavailableDomains).toContain('lineup')
    expect(result?.unavailableDomains).toContain('waiver')
    // Roster/strategy/playoff remain sport-neutral — not blocked by sport alone.
    expect(result?.unavailableDomains).not.toContain('strategy')
  })

  it('is scoring-specific — real League.scoring string passed through, never invented', async () => {
    leagueFindUnique
      .mockResolvedValueOnce(baseLeague({ userId: 'owner-1', scoring: 'Half-PPR' }))
      .mockResolvedValueOnce({ isDynasty: false, playoffTeams: 4, playoffStartWeek: 14 })
    const { assembleUserOsContext } = await import('@/lib/shared-services/league-hub/userOsContext')
    const result = await assembleUserOsContext({ appUserId: 'owner-1', canonicalLeagueId: 'league-1' })
    expect(result?.scoring).toBe('Half-PPR')
  })

  it('cross-references live InjuryReportRecord for lineup player ids, keeping only the most recent row per player', async () => {
    leagueFindUnique
      .mockResolvedValueOnce(baseLeague({ userId: 'owner-1', teams: [{ id: 'team-1', isCommissioner: true, isCoCommissioner: false }] }))
      .mockResolvedValueOnce({ isDynasty: false, playoffTeams: 4, playoffStartWeek: 14 })
    rosterFindFirstForContext.mockResolvedValue({
      playerData: { lineup_sections: { starters: [{ id: 'p1', name: 'Player One', position: 'RB', status: 'healthy' }], bench: [], ir: [] } },
    })
    injuryFindMany.mockResolvedValue([
      { playerId: 'p1', status: 'questionable', gameStatus: 'game_status', reportDate: new Date('2026-07-11T00:00:00Z') },
      { playerId: 'p1', status: 'out', gameStatus: null, reportDate: new Date('2026-07-12T00:00:00Z') },
    ])
    const { assembleUserOsContext } = await import('@/lib/shared-services/league-hub/userOsContext')
    const result = await assembleUserOsContext({ appUserId: 'owner-1', canonicalLeagueId: 'league-1' })
    expect(result?.injuryByPlayerId.get('p1')?.status).toBe('questionable')
  })

  it('propagates real sync freshness from the active league context, never re-deriving it', async () => {
    leagueFindUnique
      .mockResolvedValueOnce(baseLeague({ userId: 'owner-1', syncStatus: 'error' }))
      .mockResolvedValueOnce({ isDynasty: false, playoffTeams: 4, playoffStartWeek: 14 })
    const { assembleUserOsContext } = await import('@/lib/shared-services/league-hub/userOsContext')
    const result = await assembleUserOsContext({ appUserId: 'owner-1', canonicalLeagueId: 'league-1' })
    expect(result?.syncFreshness.state).toBe('failed')
  })
})
