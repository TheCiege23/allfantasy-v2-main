import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'

/** Rolling Insights REST + cache chain — canonical lowercase keys (7 sports; matches `LeagueSport`). */
export const SUPPORTED_SPORTS = [
  'nfl',
  'nba',
  'nhl',
  'mlb',
  'ncaaf',
  'ncaab',
  'soccer_euro',
  /** MLS / North America soccer data chain (distinct from {@link soccer_euro}). */
  'soccer_mls',
] as const

export type ApiChainSport = (typeof SUPPORTED_SPORTS)[number]

export type ApiProviderName =
  | 'rolling_insights'
  | 'clearsports'
  | 'api_sports'
  | 'thesportsdb'
  | 'cfbd'
  /** Final fantasy-data fallback (NFL player pool + injury_status from public players feed). */
  | 'sleeper'
  /** Public ESPN site API — news/injuries last-resort fallback. */
  | 'espn'

/** Cache TTLs in seconds — drives all cache expiry (DB-first). */
export const API_CHAIN_TTLS = {
  scores: 60,
  live_game: 30,
  injuries: 900,
  news: 300,
  trending: 600,
  players: 86400,
  teams: 86400,
  schedule: 3600,
  standings: 1800,
  projections: 3600,
  rankings: 3600,
  player_headshots: 604800,
  team_logos: 604800,
  roster: 3600,
  /** Season-long player stat totals — refresh twice daily (12h). */
  season_stats: 43200,
  /** Per-week player stat lines — refresh every 15m during live windows. */
  weekly_stats: 900,
  rolling_insights: 1800,
  adp: 21600,
} as const

export type ApiDataType = keyof typeof API_CHAIN_TTLS

export interface ApiFetchParams {
  sport: ApiChainSport | SupportedSport | string
  dataType: ApiDataType | string
  query?: Record<string, unknown>
  /** Alias for query (e.g. from route JSON). Merged into provider requests. */
  options?: Record<string, unknown>
  forceRefresh?: boolean
}

export interface ApiProvider {
  name: ApiProviderName
  supports: (params: ApiFetchParams) => boolean
  fetch: (params: ApiFetchParams) => Promise<unknown | null>
}

/** Legacy ApiChain result shape (used by workers). */
export interface ApiResult<T = unknown> {
  data: T | null
  source: ApiProviderName | 'cache'
  latency: number
  cached?: boolean
  attemptedSources?: ApiProviderName[]
  error?: string
}

/** Result from fetchWithChain (DB-first). */
export interface ChainFetchResult<T = unknown> {
  data: T | null
  error?: string
  fromCache: boolean
  cacheAge?: number
  source?: ApiProviderName | 'cache'
  latency?: number
}

/** Rolling Insights enabled for all 7 chain sports. */
export function isRollingInsightsEnabledForSport(sport: ApiChainSport | string): boolean {
  if (typeof sport === 'string') {
    return toApiChainSport(sport) != null
  }
  return true
}

export function isSupportedApiChainSport(value: string): value is ApiChainSport {
  return (SUPPORTED_SPORTS as readonly string[]).includes(value.toLowerCase())
}

export function toApiChainSport(input: string | SupportedSport | undefined): ApiChainSport | null {
  if (!input) return null
  const raw = String(input).trim()
  const lower = raw.toLowerCase()

  if (isSupportedApiChainSport(lower)) return lower as ApiChainSport

  const map: Record<string, ApiChainSport> = {
    nfl: 'nfl',
    nba: 'nba',
    mlb: 'mlb',
    nhl: 'nhl',
    ncaab: 'ncaab',
    ncaam: 'ncaab',
    ncaabasketball: 'ncaab',
    ncaa_basketball: 'ncaab',
    ncaaf: 'ncaaf',
    cfb: 'ncaaf',
    ncaafb: 'ncaaf',
    ncaa_football: 'ncaaf',
    soccer: 'soccer_euro',
    soccer_euro: 'soccer_euro',
    euro: 'soccer_euro',
    epl: 'soccer_euro',
    /** MLS / NA soccer — distinct Rolling Insights / feed chain from European soccer. */
    mls: 'soccer_mls',
    soccer_mls: 'soccer_mls',
  }
  if (map[lower]) return map[lower]

  try {
    const normalized = normalizeToSupportedSport(raw)
    return legacySupportedSportToApiChain(normalized)
  } catch {
    return null
  }
}

/** Map product SupportedSport → API chain sport. */
export function legacySupportedSportToApiChain(sport: SupportedSport): ApiChainSport {
  const m: Record<SupportedSport, ApiChainSport> = {
    NFL: 'nfl',
    NBA: 'nba',
    MLB: 'mlb',
    NHL: 'nhl',
    NCAAB: 'ncaab',
    NCAAF: 'ncaaf',
    SOCCER: 'soccer_euro',
  }
  return m[sport]
}

/** Store in DB normalized tables using uppercase sport labels. */
export function apiChainSportToDbSport(sport: ApiChainSport): string {
  const m: Record<ApiChainSport, string> = {
    nfl: 'NFL',
    nba: 'NBA',
    mlb: 'MLB',
    nhl: 'NHL',
    ncaab: 'NCAAB',
    ncaaf: 'NCAAF',
    soccer_euro: 'SOCCER',
    soccer_mls: 'SOCCER',
  }
  return m[sport]
}

export function isImageDataType(dataType: ApiDataType): boolean {
  return dataType === 'player_headshots' || dataType === 'team_logos'
}

export function normalizeApiSport(sport: string | SupportedSport | undefined): SupportedSport {
  return normalizeToSupportedSport(sport)
}

function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback
  return /^(1|true|yes|on)$/i.test(value.trim())
}

/**
 * Legacy flags for lib/provider-config.ts.
 * Defaults match historical behavior: NFL on, all other sports off until explicitly enabled.
 */
export const ROLLING_INSIGHTS_SPORTS = {
  NFL: envFlag(process.env.RI_NFL_ENABLED, true),
  NBA: envFlag(process.env.RI_NBA_ENABLED, false),
  MLB: envFlag(process.env.RI_MLB_ENABLED, false),
  NHL: envFlag(process.env.RI_NHL_ENABLED, false),
  NCAAF: envFlag(process.env.RI_NCAAF_ENABLED, false),
  NCAAB: envFlag(process.env.RI_NCAAB_ENABLED, false),
  SOCCER: envFlag(process.env.RI_SOCCER_ENABLED, false),
  Soccer: envFlag(process.env.RI_SOCCER_ENABLED, false),
} as const

export function ttlSecondsForDataType(dataType: string): number {
  const key = dataType as keyof typeof API_CHAIN_TTLS
  if (key in API_CHAIN_TTLS) return API_CHAIN_TTLS[key]
  if (dataType === 'games') return API_CHAIN_TTLS.scores
  return 900
}
