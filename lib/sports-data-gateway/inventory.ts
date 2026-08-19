/**
 * Fantasy OS Phase 5 — Gate 1 provider inventory (from a real code + environment audit, not prior docs).
 *
 * Status vocabulary is intentionally conservative: a provider is only `production_connected` /
 * `nonproduction_connected` when a real request has verified it. Credentials present without a verified
 * request are `configured_not_verified` (per the Phase 5 stop-gate).
 */
export type ProviderInventoryStatus =
  | 'production_connected'
  | 'nonproduction_connected'
  | 'partial'
  | 'configured_not_verified'
  | 'mock_only'
  | 'unused'
  | 'deprecated'

export type ProviderInventoryRecord = {
  provider: string
  sports: string[]
  capabilities: string[]
  status: ProviderInventoryStatus
  clientLocations: string[]
  directConsumers: string[]
  requiredEnvironmentVariables: string[]
  authenticationMethod: string
  rateLimitKnown: boolean
  lastVerifiedAt: string | null
  evidence: string[]
}

/** The audited inventory. `directConsumers` names the anti-pattern this gateway consolidates. */
export const PROVIDER_INVENTORY: ProviderInventoryRecord[] = [
  {
    provider: 'sleeper',
    sports: ['NFL'],
    capabilities: ['players', 'rosters', 'transactions', 'draft_data', 'league_data'],
    status: 'production_connected',
    clientLocations: ['lib/sleeper-sync.ts', 'lib/sleeper-avatar.ts', 'lib/validation-cohort/sleeperCohortClient.ts', 'scripts/sync-sleeper-players.ts', 'lib/sports-data-gateway/providers/sleeper.ts'],
    directConsumers: ['league import', 'validation-cohort', 'fos_phase4 discovery', 'rankings'],
    requiredEnvironmentVariables: [],
    authenticationMethod: 'none (public API)',
    rateLimitKnown: true,
    lastVerifiedAt: '2026-07-11',
    evidence: ['Live-verified reachable in Phase 4 (23,491 real calls, 0 permanent failures)', 'Gateway adapter healthCheck + fetchPlayers verified'],
  },
  {
    provider: 'rolling_insights',
    sports: ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'],
    capabilities: ['players', 'teams', 'schedules', 'games', 'live_scores', 'statistics', 'injuries', 'depth_charts'],
    status: 'configured_not_verified',
    clientLocations: ['lib/upstream-apis.ts', 'lib/workers/api-config.ts', 'scripts/test-ri-*.ts', 'scripts/force-ri-sport-ingest-pg.mjs'],
    directConsumers: ['sports-live-scores-service', 'unified-player-service', 'api-health-monitor'],
    requiredEnvironmentVariables: ['ROLLING_INSIGHTS_CLIENT_ID', 'ROLLING_INSIGHTS_CLIENT_SECRET', 'ROLLING_INSIGHTS_API_KEY'],
    authenticationMethod: 'oauth client_credentials (or api_key)',
    rateLimitKnown: false,
    lastVerifiedAt: null,
    evidence: ['Credentials PRESENT in non-prod env', 'RI_*_ENABLED sport flags', 'No verified request performed this phase'],
  },
  {
    provider: 'cfbd',
    sports: ['NCAAF'],
    capabilities: ['college_players', 'teams', 'schedules', 'games', 'statistics'],
    status: 'configured_not_verified',
    clientLocations: ['lib/cfb-player-data.ts', 'scripts/import-ncaaf-players-cfbd.ts', 'scripts/refresh-ncaaf-pool-cfbd.ts'],
    directConsumers: ['NCAAF draft pool', 'devy-classification'],
    requiredEnvironmentVariables: ['CFBD_API_KEY'],
    authenticationMethod: 'api_key (bearer)',
    rateLimitKnown: false,
    lastVerifiedAt: null,
    evidence: ['CFBD_API_KEY PRESENT in non-prod env'],
  },
  {
    provider: 'thesportsdb',
    sports: ['NFL', 'NBA', 'MLB', 'NHL', 'SOCCER'],
    capabilities: ['players', 'teams', 'team_branding', 'player_headshots'],
    status: 'configured_not_verified',
    clientLocations: ['scripts/sync-thesportsdb-players.ts', 'lib/player-media-urls.ts'],
    directConsumers: ['player media/branding'],
    requiredEnvironmentVariables: ['THESPORTSDB_API_KEY'],
    authenticationMethod: 'api_key',
    rateLimitKnown: false,
    lastVerifiedAt: null,
    evidence: ['THESPORTSDB_API_KEY PRESENT in non-prod env'],
  },
  {
    provider: 'api_sports',
    sports: ['NFL', 'NBA', 'MLB', 'NHL', 'SOCCER'],
    capabilities: ['players', 'teams', 'games', 'live_scores', 'statistics'],
    status: 'configured_not_verified',
    clientLocations: ['lib/api-football.ts'],
    directConsumers: ['sports-router'],
    requiredEnvironmentVariables: ['API_SPORTS_KEY'],
    authenticationMethod: 'api_key',
    rateLimitKnown: false,
    lastVerifiedAt: null,
    evidence: ['API_SPORTS_KEY PRESENT in non-prod env'],
  },
  {
    provider: 'espn',
    sports: ['NFL', 'NCAAF'],
    capabilities: ['games', 'schedules', 'live_scores', 'team_branding'],
    status: 'partial',
    clientLocations: ['lib/espn-data.ts', 'lib/espn-client.ts', 'lib/brackets/espn-playoff-sync.ts'],
    directConsumers: ['bracket/playoff sync'],
    requiredEnvironmentVariables: [],
    authenticationMethod: 'none (public endpoints)',
    rateLimitKnown: false,
    lastVerifiedAt: null,
    evidence: ['Public ESPN endpoints used for bracket/playoff data; not a formal keyed integration'],
  },
  {
    provider: 'yahoo',
    sports: ['NFL'],
    capabilities: ['league_data', 'rosters', 'transactions'],
    status: 'configured_not_verified',
    clientLocations: ['fantasy league import'],
    directConsumers: ['league import'],
    requiredEnvironmentVariables: ['YAHOO_CLIENT_ID', 'YAHOO_CLIENT_SECRET'],
    authenticationMethod: 'oauth',
    rateLimitKnown: false,
    lastVerifiedAt: null,
    evidence: ['OAuth client credentials PRESENT in non-prod env'],
  },
  {
    provider: 'openweathermap',
    sports: ['NFL'],
    capabilities: ['weather'],
    status: 'configured_not_verified',
    clientLocations: ['lib/openweathermap.ts'],
    directConsumers: ['start/sit', 'matchup weather context'],
    requiredEnvironmentVariables: ['OPENWEATHERMAP_API_KEY'],
    authenticationMethod: 'api_key',
    rateLimitKnown: true,
    lastVerifiedAt: null,
    evidence: ['OPENWEATHERMAP_API_KEY PRESENT in non-prod env'],
  },
  {
    provider: 'newsapi',
    sports: ['NFL', 'NBA', 'MLB', 'NHL'],
    capabilities: ['news'],
    status: 'configured_not_verified',
    clientLocations: ['news ingestion'],
    directConsumers: ['news/injury intelligence'],
    requiredEnvironmentVariables: ['NEWSAPI_KEY'],
    authenticationMethod: 'api_key',
    rateLimitKnown: true,
    lastVerifiedAt: null,
    evidence: ['NEWSAPI_KEY PRESENT in non-prod env'],
  },
  {
    provider: 'clearsports',
    sports: ['NFL'],
    capabilities: ['players', 'statistics'],
    status: 'configured_not_verified',
    clientLocations: ['lib/provider-config.ts (config only)'],
    directConsumers: [],
    requiredEnvironmentVariables: ['CLEARSPORTS_API_KEY'],
    authenticationMethod: 'api_key',
    rateLimitKnown: false,
    lastVerifiedAt: null,
    evidence: ['CLEARSPORTS_API_KEY PRESENT in non-prod env; no active consumer found in the audit'],
  },
]
