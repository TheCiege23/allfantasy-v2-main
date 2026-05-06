/**
 * TheSportsDB capability flags — enrichment-focused (images, lookups, schedules).
 * Rookie/experience fields are **not** guaranteed by vendor docs referenced in product docs.
 */

export const THE_SPORTS_DB_CAPABILITIES = {
  league_search: 'supported',
  team_search: 'supported',
  player_search: 'supported',
  league_lookup: 'supported',
  team_lookup: 'supported',
  player_lookup: 'supported',
  player_honours: 'supported',
  player_former_teams: 'supported',
  player_milestones: 'supported',
  player_contracts: 'supported',
  player_results: 'supported',
  team_players: 'supported',
  league_teams: 'supported',
  event_lookup: 'supported',
  event_stats: 'supported',
  event_lineup: 'supported',
  event_timeline: 'supported',
  schedules: 'supported',
  livescores_v2: 'supported',
  images: 'supported',
  rookie_experience: 'unknown',
  draft_year_confirmed: 'unknown',
  debut_year_confirmed: 'unknown',
  service_time: 'unknown',
  fantasy_adp: 'unknown',
  fantasy_ownership: 'unknown',
} as const

export type TheSportsDbCapabilityKey = keyof typeof THE_SPORTS_DB_CAPABILITIES

/** Until real imported payloads contain explicit experience keys, do not treat TSDB as rookie authority. */
export function isTheSportsDbRookieExperienceSupported(): boolean {
  return false
}
