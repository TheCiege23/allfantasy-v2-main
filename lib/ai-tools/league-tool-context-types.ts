/**
 * Shared contract for league-aware AI tools (dashboard, modals, APIs, War Room).
 * Global tools omit leagueId; league intelligence requires a resolved league row + membership.
 */

import type { UserLeague } from '@/app/dashboard/types'

/** Structured error codes for APIs — never collapse unrelated failures into one string. */
export type LeagueToolAccessErrorCode =
  | 'MISSING_LEAGUE_CONTEXT'
  | 'MISSING_USER_CONTEXT'
  | 'INVALID_LEAGUE_ID'
  | 'LEAGUE_NOT_FOUND'
  | 'NOT_LEAGUE_MEMBER'
  | 'ACCESS_DENIED'
  | 'TEAM_NOT_FOUND'
  | 'TEAM_CONTEXT_UNAVAILABLE'
  | 'IMPORT_MAPPING_MISSING'
  | 'DATA_LOAD_FAILED'

type LeagueToolContextPayload = {
  leagueId: string
  leagueName: string | null
  sport: string
  platform: string
  /** True when row is Sleeper/Yahoo/etc. import vs native AF */
  isImported: boolean
  userId: string
  /** LeagueTeam.platformUserId or external id when resolved */
  teamPlatformUserId: string | null
  /** Present when resolved via `lib/intelligence/resolveLeagueIntelligenceContext` */
  membershipValidated?: boolean
  userTeamId?: string | null
}

/** Full normalized engine payload — import from `@/lib/league-context-engine/types`. */
export type { NormalizedLeagueContext, ToolLeagueContext } from '@/lib/league-context-engine/types'

export function buildLeagueToolContext(args: {
  league: UserLeague
  userId: string
  teamPlatformUserId?: string | null
}): LeagueToolContextPayload {
  const { league, userId } = args
  const platform = String(league.platform ?? '').toLowerCase()
  const isImported = platform !== '' && platform !== 'allfantasy' && platform !== 'af'
  return {
    leagueId: league.id,
    leagueName: league.name ?? null,
    sport: String(league.sport ?? 'NFL'),
    platform: league.platform ?? 'unknown',
    isImported,
    userId,
    teamPlatformUserId: args.teamPlatformUserId ?? null,
  }
}
