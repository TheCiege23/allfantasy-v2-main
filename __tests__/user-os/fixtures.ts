/**
 * User OS League-Specific Intelligence Wiring phase — shared test fixtures.
 * Generators are pure functions over `UserOsContext` — no Prisma mocking
 * needed to test them, just a real, representative context object.
 */
import type { UserOsContext, RosterPlayerEntry, UserOsTeamStanding } from '@/lib/shared-services/league-hub/userOsContext'
import type { SyncFreshness } from '@/lib/shared-services/league-hub/types'

export function freshFreshness(): SyncFreshness {
  return { state: 'fresh', lastSyncedAt: '2026-07-12T00:00:00.000Z' }
}

export function staleFreshness(): SyncFreshness {
  return { state: 'stale', lastSyncedAt: '2026-06-01T00:00:00.000Z' }
}

export function player(overrides: Partial<RosterPlayerEntry> = {}): RosterPlayerEntry {
  return {
    id: 'p1',
    name: 'Player One',
    team: 'BUF',
    position: 'RB',
    opponent: 'MIA',
    gameTime: '2026-07-13T17:00:00.000Z',
    projection: 10,
    actual: null,
    status: 'healthy',
    ...overrides,
  }
}

export function standing(overrides: Partial<UserOsTeamStanding> = {}): UserOsTeamStanding {
  return {
    teamId: 'team-1',
    teamName: 'Team One',
    wins: 5,
    losses: 2,
    ties: 0,
    pointsFor: 800,
    pointsAgainst: 700,
    currentRank: 1,
    isViewerTeam: true,
    ...overrides,
  }
}

export function baseContext(overrides: Partial<UserOsContext> = {}): UserOsContext {
  const viewer = standing()
  // classifyStrategy() requires >=2 real standings rows to compute a real
  // percentile — a single-team `standings` array (the original bug here)
  // made it return `null` for every test using the default context,
  // silently masking every strategy-domain assertion until this phase's
  // Commissioner OS work re-ran vitest for the first time in a while and
  // caught it for real.
  const opponent = standing({ teamId: 'team-2', teamName: 'Team Two', wins: 3, losses: 4, isViewerTeam: false })
  return {
    appUserId: 'user-1',
    canonicalLeagueId: 'league-1',
    provider: 'sleeper',
    sport: 'NFL',
    season: 2026,
    isDynasty: false,
    scoring: 'PPR',
    currentWeek: 5,
    playoffTeams: 6,
    playoffStartWeek: 15,
    teamId: 'team-1',
    rosterId: 'roster-1',
    isCommissioner: false,
    viewerTeam: viewer,
    lineup: { starters: [player()], bench: [], ir: [] },
    standings: [viewer, opponent],
    injuryByPlayerId: new Map(),
    syncFreshness: freshFreshness(),
    latestForecastWeek: null,
    playoffForecastByTeamId: null,
    unavailableDomains: [],
    ...overrides,
  }
}
