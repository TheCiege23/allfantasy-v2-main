/**
 * Shared contract for league-aware AI tools (dashboard, modals, APIs, War Room).
 * Global tools omit leagueId; league intelligence requires a resolved league row + membership.
 */

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

/** Full normalized engine payload — import from `@/lib/league-context-engine/types`. */
export type { NormalizedLeagueContext, ToolLeagueContext } from '@/lib/league-context-engine/types'

