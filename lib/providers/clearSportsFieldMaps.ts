/**
 * ClearSports NFL REST paths (public docs / screenshots) — capability metadata only.
 * Product ingestion may use a different internal ClearSports client shape (`lib/clear-sports`).
 *
 * Docs: https://www.clearsportsapi.com/docs
 */

import { extractClearSportsExperienceSignals } from '@/lib/player-data/providerExperienceFields'

/** Base URL from vendor docs (separate from legacy ingestion routes). */
export const CLEARSPORTS_API_PUBLIC_BASE = 'https://api.clearsportsapi.com'

export const CLEARSPORTS_NFL_ENDPOINTS = {
  playerStats: '/api/v1/nfl/player-stats',
  teamStats: '/api/v1/nfl/team-stats',
  injuryStats: '/api/v1/nfl/injury-stats',
  /** Path template — substitute :teamId */
  teamById: '/api/v1/nfl/teams/:teamId',
  games: '/api/v1/nfl/games',
} as const

/** Documented query parameters per screenshot — values omitted when not supplied at request time. */
export const CLEARSPORTS_NFL_QUERY_PARAMS = {
  playerStats: ['game_id', 'player_id', 'team_id', 'season', 'week'] as const,
  teamStats: ['game_id', 'team_id', 'season', 'week'] as const,
  injuryStats: ['team_id', 'player_id', 'week', 'season'] as const,
  games: ['season', 'week', 'team_id', 'date'] as const,
} as const

export type ClearSportsNflCapabilityFlag =
  | 'player_stats'
  | 'team_stats'
  | 'injuries'
  | 'teams'
  | 'schedules_games'
  | 'player_profile'
  | 'rookie_experience'
  | 'projections'
  | 'adp'

/** Endpoint-level support from screenshots — experience/profile/projections not documented there. */
export const CLEARSPORTS_NFL_CAPABILITIES: Record<ClearSportsNflCapabilityFlag, 'supported' | 'unknown'> = {
  player_stats: 'supported',
  team_stats: 'supported',
  injuries: 'supported',
  teams: 'supported',
  schedules_games: 'supported',
  player_profile: 'unknown',
  rookie_experience: 'unknown',
  projections: 'unknown',
  adp: 'unknown',
}

/**
 * True only when merged payload contains explicit rookie/experience/draft/debut/service keys
 * that `extractExperienceSignalsFromProviderPayload` accepts — not stats-only boxes.
 */
export function hasClearSportsExperienceSignal(payload: unknown): boolean {
  const s = extractClearSportsExperienceSignals(payload)
  return s.reason !== 'no_matching_fields'
}
