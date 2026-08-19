export type NflRedraftProviderId =
  | 'api_sports'
  | 'clearsports'
  | 'deterministic'
  | 'espn'
  | 'fantasycalc'
  | 'openweather'
  | 'rolling_insights'
  | 'sleeper'
  | 'sportsdataio'
  | 'thesportsdb'

export type NflRedraftProviderDomain =
  | 'depth_chart'
  | 'headshot'
  | 'historical_stats'
  | 'injury'
  | 'live_score'
  | 'mock_draft'
  | 'news'
  | 'player_metadata'
  | 'projection'
  | 'schedule'
  | 'standings'
  | 'team_logo'
  | 'fantasy_valuation'
  | 'league_import'
  | 'weather'

export type NflRedraftProviderStatus = 'available' | 'degraded' | 'fallback_only' | 'missing_config'
export type NflRedraftFreshnessStatus = 'fresh' | 'missing' | 'stale'
export type NflRedraftProviderErrorCode =
  | 'forbidden'
  | 'invalid_credentials'
  | 'network_error'
  | 'provider_error'
  | 'rate_limited'
  | 'timeout'
  | 'unknown'

export type NflRedraftProviderCapability = {
  providerId: NflRedraftProviderId
  domain: NflRedraftProviderDomain
  priority: number
  requiresApiKey: boolean
  maxAgeMinutes: number
  note: string
}

export type NflRedraftProviderEnvRequirement = {
  providerId: NflRedraftProviderId
  required: boolean
  envKeys: string[]
  configured: boolean
  keyUsed: string | null
  missingEnv: string[]
}

export type NflRedraftProviderHealth = {
  providerId: NflRedraftProviderId
  status: NflRedraftProviderStatus
  configured: boolean
  missingEnv: string[]
  capabilities: NflRedraftProviderDomain[]
  warnings: string[]
}

export type NflRedraftProviderHealthReport = {
  generatedAtIso: string
  providers: NflRedraftProviderHealth[]
  fallbackChains: Record<NflRedraftProviderDomain, NflRedraftProviderId[]>
  launchBlockers: string[]
  warnings: string[]
}

export type NflRedraftProviderFreshness = {
  status: NflRedraftFreshnessStatus
  updatedAtIso: string | null
  ageMinutes: number | null
  maxAgeMinutes: number
}

export type NflRedraftProviderError = {
  providerId: NflRedraftProviderId
  code: NflRedraftProviderErrorCode
  retryable: boolean
  message: string
  retryAfterMs: number | null
}

export type NflRedraftProviderRateLimitPolicy = {
  providerId: NflRedraftProviderId
  maxRequestsPerMinute: number
  burst: number
  retryBackoffMs: number
}

export type CanonicalNflRedraftProviderRecord<T> = {
  providerId: NflRedraftProviderId
  providerRecordId: string
  fetchedAtIso: string
  sourceUpdatedAtIso: string | null
  freshness: NflRedraftProviderFreshness
  fallback: boolean
  data: T
  warnings: string[]
}

export type NflRedraftProviderContext = {
  season: number
  week?: number | null
  leagueId?: string | null
}

export interface NflRedraftProviderAdapter {
  id: NflRedraftProviderId
  displayName: string
  capabilities: NflRedraftProviderDomain[]
  healthCheck(context?: NflRedraftProviderContext): Promise<NflRedraftProviderHealth>
}

export const NFL_PROVIDER_ENV_KEYS: Record<NflRedraftProviderId, string[]> = {
  api_sports: ['API_SPORTS_KEY', 'APISPORTS_API_KEY', 'API_SPORTS_API_KEY'],
  clearsports: ['CLEARSPORTS_API_KEY', 'CLEAR_SPORTS_API_KEY'],
  rolling_insights: ['ROLLING_INSIGHTS_API_KEY', 'ROLLING_INSIGHTS_CLIENT_ID', 'ROLLING_INSIGHTS_CLIENT_SECRET'],
  fantasycalc: ['FANTASYCALC_API_KEY', 'FANTASY_CALC_API_KEY'],
  sportsdataio: ['SPORTSDATAIO_API_KEY', 'SPORTSDATA_API_KEY', 'SPORTS_DATA_IO_API_KEY'],
  openweather: ['OPENWEATHER_API_KEY', 'OPENWEATHERMAP_API_KEY', 'OPEN_WEATHER_API_KEY'],
  thesportsdb: ['THESPORTSDB_API_KEY', 'SPORTSDB_API_KEY', 'THE_SPORTS_DB_API_KEY'],
  sleeper: [],
  espn: [],
  deterministic: [],
}

export const NFL_REDRAFT_PROVIDER_CAPABILITIES: NflRedraftProviderCapability[] = [
  { providerId: 'rolling_insights', domain: 'player_metadata', priority: 5, requiresApiKey: true, maxAgeMinutes: 1440, note: 'Primary AllFantasy NFL identity/profile import source when configured.' },
  { providerId: 'rolling_insights', domain: 'historical_stats', priority: 5, requiresApiKey: true, maxAgeMinutes: 10080, note: 'Primary imported historical player stat source when licensed.' },
  { providerId: 'rolling_insights', domain: 'injury', priority: 5, requiresApiKey: true, maxAgeMinutes: 120, note: 'Primary imported injury/designation source when licensed.' },
  { providerId: 'rolling_insights', domain: 'depth_chart', priority: 5, requiresApiKey: true, maxAgeMinutes: 1440, note: 'Primary imported depth chart/role source when licensed.' },
  { providerId: 'rolling_insights', domain: 'schedule', priority: 5, requiresApiKey: true, maxAgeMinutes: 1440, note: 'Operational backbone for NFL schedule context.' },
  { providerId: 'rolling_insights', domain: 'live_score', priority: 5, requiresApiKey: true, maxAgeMinutes: 5, note: 'Operational backbone for live stat snapshots when available.' },
  { providerId: 'rolling_insights', domain: 'standings', priority: 5, requiresApiKey: true, maxAgeMinutes: 15, note: 'Operational backbone for standings refresh context.' },

  { providerId: 'api_sports', domain: 'player_metadata', priority: 15, requiresApiKey: true, maxAgeMinutes: 1440, note: 'Monthly enhancement source for identity enrichment.' },
  { providerId: 'api_sports', domain: 'schedule', priority: 15, requiresApiKey: true, maxAgeMinutes: 1440, note: 'Monthly enhancement source for schedule context.' },
  { providerId: 'api_sports', domain: 'team_logo', priority: 15, requiresApiKey: true, maxAgeMinutes: 10080, note: 'Monthly enhancement source for team media.' },
  { providerId: 'api_sports', domain: 'headshot', priority: 15, requiresApiKey: true, maxAgeMinutes: 43200, note: 'Monthly enhancement source for player media.' },
  { providerId: 'api_sports', domain: 'news', priority: 15, requiresApiKey: true, maxAgeMinutes: 180, note: 'Monthly enhancement source for NFL news.' },
  { providerId: 'api_sports', domain: 'standings', priority: 15, requiresApiKey: true, maxAgeMinutes: 15, note: 'Monthly enhancement source for standings.' },

  { providerId: 'clearsports', domain: 'player_metadata', priority: 25, requiresApiKey: true, maxAgeMinutes: 1440, note: 'Monthly enhancement source for identity fallback.' },
  { providerId: 'clearsports', domain: 'projection', priority: 25, requiresApiKey: true, maxAgeMinutes: 360, note: 'Monthly enhancement source for projection fallback.' },

  { providerId: 'fantasycalc', domain: 'fantasy_valuation', priority: 10, requiresApiKey: true, maxAgeMinutes: 360, note: 'Monthly enhancement source for fantasy market valuations.' },

  { providerId: 'sportsdataio', domain: 'live_score', priority: 10, requiresApiKey: true, maxAgeMinutes: 5, note: 'Primary live scoring and stat correction source.' },
  { providerId: 'sportsdataio', domain: 'historical_stats', priority: 10, requiresApiKey: true, maxAgeMinutes: 10080, note: 'Primary historical player/team stat source.' },
  { providerId: 'sportsdataio', domain: 'projection', priority: 10, requiresApiKey: true, maxAgeMinutes: 360, note: 'Primary fantasy projection source.' },
  { providerId: 'sportsdataio', domain: 'injury', priority: 10, requiresApiKey: true, maxAgeMinutes: 120, note: 'Primary injury/designation source.' },
  { providerId: 'sportsdataio', domain: 'news', priority: 10, requiresApiKey: true, maxAgeMinutes: 180, note: 'Primary player news source.' },
  { providerId: 'sportsdataio', domain: 'headshot', priority: 10, requiresApiKey: true, maxAgeMinutes: 43200, note: 'Primary player image source.' },
  { providerId: 'sportsdataio', domain: 'schedule', priority: 10, requiresApiKey: true, maxAgeMinutes: 1440, note: 'Primary NFL schedule/kickoff source.' },
  { providerId: 'sportsdataio', domain: 'depth_chart', priority: 10, requiresApiKey: true, maxAgeMinutes: 1440, note: 'Primary depth chart/role source when licensed.' },

  { providerId: 'sleeper', domain: 'player_metadata', priority: 20, requiresApiKey: false, maxAgeMinutes: 1440, note: 'Free read-only NFL player metadata fallback.' },
  { providerId: 'sleeper', domain: 'mock_draft', priority: 20, requiresApiKey: false, maxAgeMinutes: 1440, note: 'Free read-only user/league/draft context fallback.' },
  { providerId: 'sleeper', domain: 'league_import', priority: 10, requiresApiKey: false, maxAgeMinutes: 1440, note: 'Primary league import provider for Sleeper leagues.' },
  { providerId: 'espn', domain: 'league_import', priority: 20, requiresApiKey: false, maxAgeMinutes: 1440, note: 'Secondary import provider for ESPN leagues when user credentials exist.' },

  { providerId: 'thesportsdb', domain: 'team_logo', priority: 30, requiresApiKey: false, maxAgeMinutes: 10080, note: 'Free team badge/logo fallback; live feeds may require paid access.' },
  { providerId: 'thesportsdb', domain: 'schedule', priority: 30, requiresApiKey: false, maxAgeMinutes: 1440, note: 'Secondary public team/event schedule fallback.' },

  { providerId: 'openweather', domain: 'weather', priority: 10, requiresApiKey: true, maxAgeMinutes: 120, note: 'Primary stadium/city weather context source.' },

  { providerId: 'deterministic', domain: 'player_metadata', priority: 100, requiresApiKey: false, maxAgeMinutes: 525600, note: 'Last-resort internal deterministic player fixtures.' },
  { providerId: 'deterministic', domain: 'live_score', priority: 100, requiresApiKey: false, maxAgeMinutes: 525600, note: 'Last-resort deterministic scoring fixtures for tests only.' },
  { providerId: 'deterministic', domain: 'projection', priority: 100, requiresApiKey: false, maxAgeMinutes: 525600, note: 'Last-resort fixture projections, never current production claims.' },
  { providerId: 'deterministic', domain: 'injury', priority: 100, requiresApiKey: false, maxAgeMinutes: 525600, note: 'Last-resort missing/unknown injury fallback.' },
  { providerId: 'deterministic', domain: 'news', priority: 100, requiresApiKey: false, maxAgeMinutes: 525600, note: 'Last-resort no-news fallback.' },
  { providerId: 'deterministic', domain: 'weather', priority: 100, requiresApiKey: false, maxAgeMinutes: 525600, note: 'Last-resort weather unavailable fallback.' },
]

export const NFL_REDRAFT_RATE_LIMITS: Record<NflRedraftProviderId, NflRedraftProviderRateLimitPolicy> = {
  api_sports: { providerId: 'api_sports', maxRequestsPerMinute: 60, burst: 10, retryBackoffMs: 30_000 },
  clearsports: { providerId: 'clearsports', maxRequestsPerMinute: 60, burst: 10, retryBackoffMs: 30_000 },
  rolling_insights: { providerId: 'rolling_insights', maxRequestsPerMinute: 60, burst: 10, retryBackoffMs: 30_000 },
  fantasycalc: { providerId: 'fantasycalc', maxRequestsPerMinute: 60, burst: 10, retryBackoffMs: 30_000 },
  sportsdataio: { providerId: 'sportsdataio', maxRequestsPerMinute: 60, burst: 10, retryBackoffMs: 30_000 },
  sleeper: { providerId: 'sleeper', maxRequestsPerMinute: 900, burst: 50, retryBackoffMs: 5_000 },
  espn: { providerId: 'espn', maxRequestsPerMinute: 120, burst: 20, retryBackoffMs: 10_000 },
  thesportsdb: { providerId: 'thesportsdb', maxRequestsPerMinute: 60, burst: 10, retryBackoffMs: 30_000 },
  openweather: { providerId: 'openweather', maxRequestsPerMinute: 60, burst: 10, retryBackoffMs: 60_000 },
  deterministic: { providerId: 'deterministic', maxRequestsPerMinute: Number.POSITIVE_INFINITY, burst: Number.POSITIVE_INFINITY, retryBackoffMs: 0 },
}

function envValue(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]
  return typeof value === 'string' ? value.trim() : ''
}

function hasKey(env: NodeJS.ProcessEnv, keys: string[]): { configured: boolean; keyUsed: string | null } {
  for (const key of keys) {
    if (envValue(env, key)) return { configured: true, keyUsed: key }
  }
  return { configured: false, keyUsed: null }
}

export function validateNflRedraftProviderEnv(env: NodeJS.ProcessEnv = process.env): NflRedraftProviderEnvRequirement[] {
  return (Object.keys(NFL_PROVIDER_ENV_KEYS) as NflRedraftProviderId[]).map((providerId) => {
    const envKeys = NFL_PROVIDER_ENV_KEYS[providerId]
    const requiresApiKey = NFL_REDRAFT_PROVIDER_CAPABILITIES.some(
      (capability) => capability.providerId === providerId && capability.requiresApiKey,
    )
    const resolved = hasKey(env, envKeys)
    return {
      providerId,
      required: requiresApiKey,
      envKeys,
      configured: envKeys.length === 0 ? true : resolved.configured,
      keyUsed: resolved.keyUsed,
      missingEnv: resolved.configured ? [] : envKeys,
    }
  })
}

export function getNflRedraftFallbackChain(
  domain: NflRedraftProviderDomain,
  env: NodeJS.ProcessEnv = process.env,
): NflRedraftProviderId[] {
  const envRows = validateNflRedraftProviderEnv(env)
  const configured = new Map(envRows.map((row) => [row.providerId, row.configured]))
  return NFL_REDRAFT_PROVIDER_CAPABILITIES
    .filter((capability) => capability.domain === domain)
    .filter((capability) => !capability.requiresApiKey || configured.get(capability.providerId))
    .sort((a, b) => a.priority - b.priority)
    .map((capability) => capability.providerId)
}

export function getNflRedraftProviderCapabilities(providerId: NflRedraftProviderId): NflRedraftProviderDomain[] {
  return Array.from(
    new Set(
      NFL_REDRAFT_PROVIDER_CAPABILITIES
        .filter((capability) => capability.providerId === providerId)
        .map((capability) => capability.domain),
    ),
  )
}

export function buildNflRedraftProviderHealthReport(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): NflRedraftProviderHealthReport {
  const envRows = validateNflRedraftProviderEnv(env)
  const domains = Array.from(new Set(NFL_REDRAFT_PROVIDER_CAPABILITIES.map((capability) => capability.domain))).sort() as NflRedraftProviderDomain[]
  const fallbackChains = Object.fromEntries(
    domains.map((domain) => [domain, getNflRedraftFallbackChain(domain, env)]),
  ) as Record<NflRedraftProviderDomain, NflRedraftProviderId[]>
  const providers = envRows.map((row): NflRedraftProviderHealth => {
    const capabilities = getNflRedraftProviderCapabilities(row.providerId)
    const configuredCapabilities = NFL_REDRAFT_PROVIDER_CAPABILITIES.filter((capability) => capability.providerId === row.providerId)
    const allCapabilitiesRequireKey = configuredCapabilities.length > 0 && configuredCapabilities.every((capability) => capability.requiresApiKey)
    const status: NflRedraftProviderStatus = row.configured
      ? row.providerId === 'deterministic'
        ? 'fallback_only'
        : 'available'
      : allCapabilitiesRequireKey
        ? 'missing_config'
        : 'degraded'
    return {
      providerId: row.providerId,
      status,
      configured: row.configured,
      missingEnv: row.missingEnv,
      capabilities,
      warnings: row.configured
        ? []
        : [`${row.providerId} is not configured; using lower-priority fallbacks where available.`],
    }
  })
  const launchBlockers = [
    fallbackChains.live_score.includes('sportsdataio') ? null : 'Live scoring has no configured primary provider.',
    fallbackChains.projection.includes('sportsdataio') ? null : 'Projection data has no configured primary provider.',
    fallbackChains.injury.includes('sportsdataio') ? null : 'Injury data has no configured primary provider.',
    fallbackChains.weather.includes('openweather') ? null : 'Weather context has no configured weather provider.',
  ].filter((value): value is string => Boolean(value))

  return {
    generatedAtIso: now.toISOString(),
    providers,
    fallbackChains,
    launchBlockers,
    warnings: providers.flatMap((provider) => provider.warnings),
  }
}

export function buildNflRedraftProviderFreshness(input: {
  updatedAtIso?: string | null
  maxAgeMinutes: number
  now?: Date
}): NflRedraftProviderFreshness {
  const now = input.now ?? new Date()
  if (!input.updatedAtIso) {
    return { status: 'missing', updatedAtIso: null, ageMinutes: null, maxAgeMinutes: input.maxAgeMinutes }
  }
  const updated = new Date(input.updatedAtIso)
  const ageMinutes = Number.isFinite(updated.getTime())
    ? Math.max(0, Math.floor((now.getTime() - updated.getTime()) / 60_000))
    : null
  if (ageMinutes == null) {
    return { status: 'missing', updatedAtIso: input.updatedAtIso, ageMinutes: null, maxAgeMinutes: input.maxAgeMinutes }
  }
  return {
    status: ageMinutes > input.maxAgeMinutes ? 'stale' : 'fresh',
    updatedAtIso: input.updatedAtIso,
    ageMinutes,
    maxAgeMinutes: input.maxAgeMinutes,
  }
}

export function toCanonicalNflRedraftProviderRecord<T>(input: {
  providerId: NflRedraftProviderId
  providerRecordId: string
  data: T
  fetchedAtIso?: string | null
  sourceUpdatedAtIso?: string | null
  maxAgeMinutes: number
  fallback?: boolean
  warnings?: string[]
  now?: Date
}): CanonicalNflRedraftProviderRecord<T> {
  const now = input.now ?? new Date()
  const fetchedAtIso = input.fetchedAtIso ?? now.toISOString()
  return {
    providerId: input.providerId,
    providerRecordId: input.providerRecordId,
    fetchedAtIso,
    sourceUpdatedAtIso: input.sourceUpdatedAtIso ?? null,
    freshness: buildNflRedraftProviderFreshness({
      updatedAtIso: input.sourceUpdatedAtIso ?? fetchedAtIso,
      maxAgeMinutes: input.maxAgeMinutes,
      now,
    }),
    fallback: input.fallback === true,
    data: input.data,
    warnings: input.warnings ?? [],
  }
}

export function normalizeNflRedraftProviderError(input: {
  providerId: NflRedraftProviderId
  error: unknown
  status?: number | null
  retryAfterMs?: number | null
}): NflRedraftProviderError {
  const status = input.status ?? null
  const message = input.error instanceof Error ? input.error.message : String(input.error ?? 'Provider request failed')
  if (status === 429) {
    return { providerId: input.providerId, code: 'rate_limited', retryable: true, message, retryAfterMs: input.retryAfterMs ?? NFL_REDRAFT_RATE_LIMITS[input.providerId].retryBackoffMs }
  }
  if (status === 401) return { providerId: input.providerId, code: 'invalid_credentials', retryable: false, message, retryAfterMs: null }
  if (status === 403) return { providerId: input.providerId, code: 'forbidden', retryable: false, message, retryAfterMs: null }
  if (typeof status === 'number' && status >= 500) {
    return { providerId: input.providerId, code: 'provider_error', retryable: true, message, retryAfterMs: input.retryAfterMs ?? NFL_REDRAFT_RATE_LIMITS[input.providerId].retryBackoffMs }
  }
  if (/timeout/i.test(message)) {
    return { providerId: input.providerId, code: 'timeout', retryable: true, message, retryAfterMs: input.retryAfterMs ?? NFL_REDRAFT_RATE_LIMITS[input.providerId].retryBackoffMs }
  }
  if (/network|fetch failed|econn/i.test(message)) {
    return { providerId: input.providerId, code: 'network_error', retryable: true, message, retryAfterMs: input.retryAfterMs ?? NFL_REDRAFT_RATE_LIMITS[input.providerId].retryBackoffMs }
  }
  return { providerId: input.providerId, code: 'unknown', retryable: false, message, retryAfterMs: null }
}

export function shouldRetryNflRedraftProviderError(error: NflRedraftProviderError): boolean {
  return error.retryable && error.retryAfterMs != null && error.retryAfterMs >= 0
}
