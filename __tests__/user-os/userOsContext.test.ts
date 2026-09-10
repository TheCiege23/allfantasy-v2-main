/**
 * User OS League-Specific Intelligence Wiring phase — Part 4 context tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/*
 * ⚠ THIS MOCK WAS INCOMPLETE AND THE WHOLE SUITE HAD BEEN RED ON `main` BECAUSE OF IT.
 *
 * `activeLeagueContext` routes through `resolveLeagueAccess`, which reads
 * `prisma.redraftLeagueMember`, `prisma.roster.count` and `prisma.leagueTeam.findFirst`.
 * None of the three were mocked, so every test died at
 * `lib/league-access.ts:68` with "Cannot read properties of undefined (reading 'findUnique')"
 * before reaching an assertion. Verified failing identically at `origin/main` `1a43ebbd8`, so
 * this is a pre-existing gap being closed, not a regression introduced here.
 */
const {
  leagueFindUnique,
  leagueTeamFindMany,
  leagueTeamFindFirst,
  redraftMemberFindUnique,
  rosterCount,
  rosterFindFirst,
  rosterFindFirstForContext,
  injuryFindMany,
  forecastFindFirst,
} = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  leagueTeamFindMany: vi.fn(),
  leagueTeamFindFirst: vi.fn(),
  redraftMemberFindUnique: vi.fn(),
  rosterCount: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterFindFirstForContext: vi.fn(),
  injuryFindMany: vi.fn(),
  forecastFindFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueFindUnique },
    leagueTeam: { findMany: leagueTeamFindMany, findFirst: leagueTeamFindFirst },
    redraftLeagueMember: { findUnique: redraftMemberFindUnique },
    roster: { count: rosterCount, findFirst: (...args: unknown[]) => {
      // activeLeagueContext.ts calls roster.findFirst for rosterId; userOsContext.ts calls it for playerData.
      // Distinguish by the select clause shape.
      const select = (args[0] as { select?: Record<string, unknown> })?.select
      if (select && 'playerData' in select) return rosterFindFirstForContext(...args)
      return rosterFindFirst(...args)
    } },
    sportsInjury: { findMany: injuryFindMany },
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

let leagueRow: Record<string, unknown>
let settingsRow: Record<string, unknown> | null

describe('assembleUserOsContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    /*
     * ⚠ DISCRIMINATE BY `select`, NOT BY CALL ORDER.
     *
     * These tests used to chain two `mockResolvedValueOnce` calls, assuming exactly two
     * `league.findUnique` reads: activeLeagueContext's, then userOsContext's playoff settings.
     * `resolveLeagueAccess` later added a THIRD read, ahead of both, which shifted every
     * queued value by one — the settings row was served to the membership check and the
     * settings read fell through to `undefined`. Ordering is the wrong key; the `select` shape
     * is stable, and the `roster.findFirst` mock in this same file already works that way.
     */
    leagueRow = baseLeague()
    settingsRow = { isDynasty: false, playoffTeams: 6, playoffStartWeek: 15 }
    leagueFindUnique.mockImplementation((args?: { select?: Record<string, unknown> }) =>
      Promise.resolve(args?.select && 'isDynasty' in args.select ? settingsRow : leagueRow),
    )
    leagueTeamFindMany.mockResolvedValue([])
    leagueTeamFindFirst.mockResolvedValue(null)
    redraftMemberFindUnique.mockResolvedValue(null)
    rosterCount.mockResolvedValue(0)
    injuryFindMany.mockResolvedValue([])
    forecastFindFirst.mockResolvedValue(null)
    rosterFindFirstForContext.mockResolvedValue(null)
    rosterFindFirst.mockResolvedValue(null)
  })

  it('returns null when the caller has no real relationship to the league (fails closed)', async () => {
    leagueRow = baseLeague()
    const { assembleUserOsContext } = await import('@/lib/shared-services/league-hub/userOsContext')
    const result = await assembleUserOsContext({ appUserId: 'stranger', canonicalLeagueId: 'league-1' })
    expect(result).toBeNull()
  })

  it('resolves a real context for the owner, including real playoff settings', async () => {
    leagueRow = baseLeague({ userId: 'owner-1', platform: 'allfantasy' })
    settingsRow = { isDynasty: false, playoffTeams: 6, playoffStartWeek: 15 }
    const { assembleUserOsContext } = await import('@/lib/shared-services/league-hub/userOsContext')
    const result = await assembleUserOsContext({ appUserId: 'owner-1', canonicalLeagueId: 'league-1' })
    expect(result).not.toBeNull()
    expect(result?.playoffTeams).toBe(6)
    expect(result?.playoffStartWeek).toBe(15)
    expect(result?.isDynasty).toBe(false)
  })

  it('marks lineup/roster unavailable when the viewer has no claimed team', async () => {
    leagueRow = baseLeague({ userId: 'owner-1', redraftMembers: [{ role: 'member' }] })
    /* Membership comes from `prisma.redraftLeagueMember`, not from a relation on the
     * league row — `resolveLeagueAccess` queries it separately. The `redraftMembers`
     * array in the fixture predates that and grants nothing. */
    redraftMemberFindUnique.mockResolvedValue({ role: 'MEMBER' })
    settingsRow = { isDynasty: false, playoffTeams: 4, playoffStartWeek: 14 }
    const { assembleUserOsContext } = await import('@/lib/shared-services/league-hub/userOsContext')
    const result = await assembleUserOsContext({ appUserId: 'member-1', canonicalLeagueId: 'league-1' })
    expect(result).not.toBeNull()
    expect(result?.unavailableDomains).toContain('lineup')
    expect(result?.unavailableDomains).toContain('roster')
  })

  it('marks lineup/waiver unavailable for a non-NFL sport (multi-sport seam)', async () => {
    leagueRow = baseLeague({ userId: 'owner-1', sport: 'NBA', teams: [{ id: 'team-1', isCommissioner: false, isCoCommissioner: false }] })
    /* Membership comes from `prisma.redraftLeagueMember`, not from a relation on the
     * league row — `resolveLeagueAccess` queries it separately. The `redraftMembers`
     * array in the fixture predates that and grants nothing. */
    redraftMemberFindUnique.mockResolvedValue({ role: 'MEMBER' })
    settingsRow = { isDynasty: false, playoffTeams: 6, playoffStartWeek: 20 }
    const { assembleUserOsContext } = await import('@/lib/shared-services/league-hub/userOsContext')
    const result = await assembleUserOsContext({ appUserId: 'member-1', canonicalLeagueId: 'league-1' })
    expect(result?.unavailableDomains).toContain('lineup')
    expect(result?.unavailableDomains).toContain('waiver')
    // Roster/strategy/playoff remain sport-neutral — not blocked by sport alone.
    expect(result?.unavailableDomains).not.toContain('strategy')
  })

  it('is scoring-specific — real League.scoring string passed through, never invented', async () => {
    leagueRow = baseLeague({ userId: 'owner-1', scoring: 'Half-PPR' })
    settingsRow = { isDynasty: false, playoffTeams: 4, playoffStartWeek: 14 }
    const { assembleUserOsContext } = await import('@/lib/shared-services/league-hub/userOsContext')
    const result = await assembleUserOsContext({ appUserId: 'owner-1', canonicalLeagueId: 'league-1' })
    expect(result?.scoring).toBe('Half-PPR')
  })

  it('cross-references the canonical injury read port for lineup players, keyed by lineup player id (freshest row wins)', async () => {
    leagueRow = baseLeague({ userId: 'owner-1', teams: [{ id: 'team-1', isCommissioner: true, isCoCommissioner: false }] })
    settingsRow = { isDynasty: false, playoffTeams: 4, playoffStartWeek: 14 }
    rosterFindFirstForContext.mockResolvedValue({
      playerData: { lineup_sections: { starters: [{ id: 'p1', name: 'Player One', position: 'RB', status: 'healthy' }], bench: [], ir: [] } },
    })
    const factBase = { type: null, description: null, date: null, week: null, team: null, position: 'RB' }
    injuryFindMany.mockResolvedValue([
      { ...factBase, playerName: 'Player One', status: 'questionable', source: 'rolling_insights', fetchedAt: new Date('2026-07-12T00:00:00Z') },
      { ...factBase, playerName: 'Player One', status: 'out', source: 'api_sports', fetchedAt: new Date('2026-07-11T00:00:00Z') },
    ])
    const { assembleUserOsContext } = await import('@/lib/shared-services/league-hub/userOsContext')
    const result = await assembleUserOsContext({ appUserId: 'owner-1', canonicalLeagueId: 'league-1' })
    expect(result?.injuryByPlayerId.get('p1')?.status).toBe('questionable')
  })

  it('propagates real sync freshness from the active league context, never re-deriving it', async () => {
    leagueRow = baseLeague({ userId: 'owner-1', syncStatus: 'error' })
    settingsRow = { isDynasty: false, playoffTeams: 4, playoffStartWeek: 14 }
    const { assembleUserOsContext } = await import('@/lib/shared-services/league-hub/userOsContext')
    const result = await assembleUserOsContext({ appUserId: 'owner-1', canonicalLeagueId: 'league-1' })
    expect(result?.syncFreshness.state).toBe('failed')
  })
})
