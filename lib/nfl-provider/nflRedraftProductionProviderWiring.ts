import {
  NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES,
  getNflRedraftProviderFallbackOrder,
  mergeNflRedraftCanonicalProviderResults,
  sanitizeNflRedraftCanonicalProviderData,
  type NflRedraftProviderCapabilityPolicy,
  type NflRedraftProviderLifecycleState,
  type NflRedraftProviderNodeConfig,
  type NflRedraftProviderNodeId,
  type NflRedraftProviderOrchestratorCapability,
} from '@/lib/nfl-provider/nflRedraftProviderOrchestrator'
import {
  normalizeNflRedraftProviderPlayerIdentity,
  type NflRedraftPlayerIdentityProviderId,
} from '@/lib/nfl-provider/nflRedraftPlayerIdentity'
import type { NflRedraftProviderId } from '@/lib/nfl-provider/nflRedraftProviderFoundation'
import { normalizeNflRedraftProviderGameContext } from '@/lib/player-data/nflRedraftGameContext'
import { normalizeNflRedraftProviderLiveScoringContext } from '@/lib/player-data/nflRedraftLiveScoringContext'
import { normalizeNflRedraftProviderPlayerIntelligence } from '@/lib/player-data/nflRedraftPlayerIntelligence'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

export const NFL_REDRAFT_PRODUCTION_PROVIDER_WIRING_MODEL_VERSION =
  'nfl-redraft-production-provider-wiring-v1' as const

export type NflRedraftProductionProviderRequest = {
  capability: NflRedraftProviderOrchestratorCapability
  season?: number | string | null
  week?: number | string | null
  playerName?: string | null
  allFantasyPlayerId?: string | null
  teamAbbr?: string | null
  opponentTeamAbbr?: string | null
  gameId?: string | null
  leagueImportId?: string | number | null
  cacheKey?: string | null
  cacheFreshness?: 'available' | 'missing' | 'stale' | 'unknown'
  valuationSettings?: {
    isDynasty: boolean
    numQbs: 1 | 2
    numTeams: number
    ppr: 0 | 0.5 | 1
  }
  configOverrides?: Partial<Record<NflRedraftProviderNodeId, Partial<NflRedraftProviderNodeConfig>>>
  policyOverrides?: Partial<Record<NflRedraftProviderOrchestratorCapability, Partial<NflRedraftProviderCapabilityPolicy>>>
}

export type NflRedraftProductionProviderAdapterResult = {
  providerId: NflRedraftProviderNodeId
  capability: NflRedraftProviderOrchestratorCapability
  canonicalData: Record<string, unknown> | null
  sourceTimestampIso: string | null
  fetchedAtIso: string
  freshnessStatus: 'available' | 'missing' | 'stale' | 'unknown'
  fallbackUsed: boolean
  cacheUsed: boolean
  healthStatus: NflRedraftProviderLifecycleState
  warnings: string[]
  terminal?: boolean
  realIntegration: boolean
  integrationName: string
}

export type NflRedraftProductionProviderAttempt = {
  providerId: NflRedraftProviderNodeId
  state: NflRedraftProviderLifecycleState
  attempted: boolean
  selected: boolean
  cacheUsed: boolean
  fallbackUsed: boolean
  realIntegration: boolean
  reason: string
  error: string | null
}

export type NflRedraftProductionProviderTrace = {
  canonicalPlayerId: string | null
  providerUsed: NflRedraftProviderNodeId | null
  timestampIso: string
  sourceTimestampIso: string | null
  freshnessStatus: 'available' | 'missing' | 'stale' | 'unknown'
  fallbackUsed: boolean
  cacheUsed: boolean
  healthStatus: NflRedraftProviderLifecycleState | null
}

export type NflRedraftProductionProviderResolution = {
  modelVersion: typeof NFL_REDRAFT_PRODUCTION_PROVIDER_WIRING_MODEL_VERSION
  capability: NflRedraftProviderOrchestratorCapability
  selectedProvider: NflRedraftProviderNodeId | null
  fallbackChain: NflRedraftProviderNodeId[]
  attempts: NflRedraftProductionProviderAttempt[]
  canonicalData: Record<string, unknown> | null
  mergedCanonicalData: Record<string, unknown>
  conflicts: ReturnType<typeof mergeNflRedraftCanonicalProviderResults>['conflicts']
  trace: NflRedraftProductionProviderTrace
  warnings: string[]
  providerPayloadExposed: false
  providerIdsExposedToCanonicalData: false
}

export type NflRedraftProductionProviderAdapter = (
  request: NflRedraftProductionProviderRequest,
) => Promise<NflRedraftProductionProviderAdapterResult | null>

export type NflRedraftProductionProviderAdapterRegistry = Partial<
  Record<NflRedraftProviderNodeId, Partial<Record<NflRedraftProviderOrchestratorCapability, NflRedraftProductionProviderAdapter>>>
>

export type NflRedraftExistingProviderIntegration = {
  providerId: NflRedraftProviderNodeId
  integrationName: string
  capabilities: NflRedraftProviderOrchestratorCapability[]
  existingWrapper: string
  realProductionIntegration: boolean
  deferredReason: string | null
}

type PrismaLike = {
  sportsPlayer?: {
    findFirst?: (args: unknown) => Promise<Record<string, unknown> | null>
  }
  sportsDataCache?: {
    findUnique?: (args: unknown) => Promise<{ data: unknown; expiresAt?: Date; createdAt?: Date } | null>
  }
}

export type NflRedraftProductionProviderDependencies = {
  now?: () => Date
  env?: Record<string, string | undefined>
  prisma?: PrismaLike
  adapters?: NflRedraftProductionProviderAdapterRegistry
}

const ENHANCEMENT_PROVIDERS = new Set<NflRedraftProviderNodeId>([
  'api_sports',
  'clearsports',
  'fantasycalc',
  'openweather',
  'thesportsdb',
])

const PROVIDER_ENV_ALIASES: Partial<Record<NflRedraftProviderNodeId, string[]>> = {
  api_sports: ['API_SPORTS_KEY', 'APISPORTS_API_KEY', 'API_SPORTS_API_KEY'],
  clearsports: ['CLEARSPORTS_API_KEY', 'CLEAR_SPORTS_API_KEY'],
  openweather: ['OPENWEATHER_API_KEY', 'OPENWEATHERMAP_API_KEY', 'OPEN_WEATHER_API_KEY'],
  rolling_insights: ['ROLLING_INSIGHTS_RSC_TOKEN', 'ROLLING_INSIGHTS_API_KEY', 'ROLLING_INSIGHTS_CLIENT_SECRET'],
  thesportsdb: ['THESPORTSDB_API_KEY', 'SPORTSDB_API_KEY', 'THE_SPORTS_DB_API_KEY'],
}

export function listNflRedraftExistingProviderIntegrations(): NflRedraftExistingProviderIntegration[] {
  return [
    {
      providerId: 'rolling_insights',
      integrationName: 'Rolling Insights DB/cache and live/schedule wrappers',
      capabilities: ['player_identity', 'schedule', 'live_stats', 'standings', 'headshots', 'logos'],
      existingWrapper: 'lib/sports-live-scores-service.ts, lib/providers/rollingInsightsNflFieldMap.ts, SportsPlayer/SportsGame cache',
      realProductionIntegration: true,
      deferredReason: null,
    },
    {
      providerId: 'api_sports',
      integrationName: 'API-Sports NFL client',
      capabilities: ['player_identity', 'schedule', 'standings', 'headshots', 'logos', 'news'],
      existingWrapper: 'lib/api-sports.ts',
      realProductionIntegration: true,
      deferredReason: null,
    },
    {
      providerId: 'thesportsdb',
      integrationName: 'TheSportsDB URL and field-map helpers',
      capabilities: ['headshots', 'logos'],
      existingWrapper: 'lib/providers/theSportsDbUrls.ts, lib/providers/theSportsDbFieldMaps.ts',
      realProductionIntegration: true,
      deferredReason: null,
    },
    {
      providerId: 'fantasycalc',
      integrationName: 'FantasyCalc DB-first valuation wrapper',
      capabilities: ['fantasy_valuations'],
      existingWrapper: 'lib/fantasycalc.ts, lib/fantasycalc-db.ts',
      realProductionIntegration: true,
      deferredReason: null,
    },
    {
      providerId: 'clearsports',
      integrationName: 'ClearSports normalized client',
      capabilities: ['player_identity', 'schedule', 'headshots', 'logos'],
      existingWrapper: 'lib/clear-sports/index.ts',
      realProductionIntegration: true,
      deferredReason: null,
    },
    {
      providerId: 'openweather',
      integrationName: 'OpenWeather stadium weather service',
      capabilities: ['weather'],
      existingWrapper: 'lib/openweathermap.ts, lib/weather/weatherService.ts',
      realProductionIntegration: true,
      deferredReason: null,
    },
    {
      providerId: 'sleeper',
      integrationName: 'Sleeper import client',
      capabilities: ['league_import', 'player_identity'],
      existingWrapper: 'lib/sleeper-client.ts',
      realProductionIntegration: true,
      deferredReason: null,
    },
    {
      providerId: 'espn',
      integrationName: 'ESPN fantasy import client',
      capabilities: ['league_import'],
      existingWrapper: 'lib/espn-client.ts',
      realProductionIntegration: true,
      deferredReason: null,
    },
    {
      providerId: 'canonical_cache',
      integrationName: 'Canonical SportsDataCache fallback',
      capabilities: ['player_identity', 'schedule', 'live_stats', 'standings', 'fantasy_valuations', 'weather', 'news'],
      existingWrapper: 'SportsDataCache',
      realProductionIntegration: true,
      deferredReason: null,
    },
    {
      providerId: 'runtime',
      integrationName: 'AllFantasy runtime fallback',
      capabilities: ['live_stats', 'standings'],
      existingWrapper: 'NFL Redraft runtime state',
      realProductionIntegration: true,
      deferredReason: null,
    },
    {
      providerId: 'internal_historical_model',
      integrationName: 'Internal historical value model',
      capabilities: ['fantasy_valuations'],
      existingWrapper: 'lib/fantasycalc.ts historical pick-value helpers',
      realProductionIntegration: true,
      deferredReason: null,
    },
  ]
}

function envHasAny(env: Record<string, string | undefined>, providerId: NflRedraftProviderNodeId): boolean {
  const keys = PROVIDER_ENV_ALIASES[providerId] ?? []
  return keys.some((key) => Boolean(env[key]?.trim()))
}

export function buildNflRedraftProductionProviderConfigOverrides(
  env: Record<string, string | undefined> = process.env,
): Partial<Record<NflRedraftProviderNodeId, Partial<NflRedraftProviderNodeConfig>>> {
  const overrides: Partial<Record<NflRedraftProviderNodeId, Partial<NflRedraftProviderNodeConfig>>> = {
    rolling_insights: {
      state: 'ACTIVE',
      healthReason: 'Rolling Insights is the operational backbone; use imported/cache data when live credentials are absent.',
    },
  }

  for (const providerId of ENHANCEMENT_PROVIDERS) {
    if (providerId === 'fantasycalc') {
      overrides[providerId] = {
        state: 'ACTIVE',
        healthReason: 'FantasyCalc public valuation wrapper is available through DB-first cache.',
      }
      continue
    }
    const configured = envHasAny(env, providerId)
    overrides[providerId] = configured
      ? { state: 'ACTIVE', healthReason: null }
      : {
          state: 'EXPIRED',
          healthReason: 'Enhancement provider credentials are not configured; fallback chain must continue.',
        }
  }

  return overrides
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function requestSeason(request: NflRedraftProductionProviderRequest): string {
  return String(request.season ?? new Date().getFullYear())
}

function requestWeek(request: NflRedraftProductionProviderRequest): string | null {
  return request.week == null ? null : String(request.week)
}

function requestTeam(request: NflRedraftProductionProviderRequest): string | null {
  return normalizeTeamAbbrev(request.teamAbbr) ?? normalizeTeamAbbrev(request.opponentTeamAbbr)
}

function isEmptyCanonicalData(value: Record<string, unknown> | null): boolean {
  return !value || Object.keys(value).length === 0
}

function hasRawProviderLeak(value: unknown): boolean {
  const text = JSON.stringify(value ?? {}).toLowerCase()
  return (
    text.includes('rawproviderpayload') ||
    text.includes('providerpayload') ||
    text.includes('providerplayerid') ||
    text.includes('api_key') ||
    text.includes('secret')
  )
}

function makeResult(input: {
  providerId: NflRedraftProviderNodeId
  capability: NflRedraftProviderOrchestratorCapability
  canonicalData: Record<string, unknown> | null
  sourceTimestampIso?: string | null
  fetchedAtIso: string
  freshnessStatus?: 'available' | 'missing' | 'stale' | 'unknown'
  fallbackUsed?: boolean
  cacheUsed?: boolean
  healthStatus?: NflRedraftProviderLifecycleState
  warnings?: string[]
  terminal?: boolean
  realIntegration?: boolean
  integrationName: string
}): NflRedraftProductionProviderAdapterResult {
  return {
    providerId: input.providerId,
    capability: input.capability,
    canonicalData: input.canonicalData ? sanitizeNflRedraftCanonicalProviderData(input.canonicalData) : null,
    sourceTimestampIso: input.sourceTimestampIso ?? null,
    fetchedAtIso: input.fetchedAtIso,
    freshnessStatus: input.freshnessStatus ?? (input.canonicalData ? 'available' : 'missing'),
    fallbackUsed: input.fallbackUsed ?? false,
    cacheUsed: input.cacheUsed ?? false,
    healthStatus: input.healthStatus ?? 'ACTIVE',
    warnings: input.warnings ?? [],
    terminal: input.terminal,
    realIntegration: input.realIntegration ?? true,
    integrationName: input.integrationName,
  }
}

async function defaultPrisma(): Promise<PrismaLike> {
  const { prisma } = await import('@/lib/prisma')
  return prisma as unknown as PrismaLike
}

async function readSportsPlayerIdentity(request: NflRedraftProductionProviderRequest, source: string, providerId: NflRedraftPlayerIdentityProviderId) {
  const prisma = await defaultPrisma()
  const playerName = request.playerName?.trim()
  const team = requestTeam(request)
  if (!prisma.sportsPlayer?.findFirst || (!playerName && !request.allFantasyPlayerId)) return null
  const row = await prisma.sportsPlayer.findFirst({
    where: {
      sport: 'NFL',
      source,
      ...(playerName ? { name: { equals: playerName, mode: 'insensitive' } } : {}),
      ...(team ? { team } : {}),
    },
    orderBy: { fetchedAt: 'desc' },
  })
  if (!row) return null
  const canonical = normalizeNflRedraftProviderPlayerIdentity({
    providerId,
    payload: row,
    fetchedAtIso: row.fetchedAt instanceof Date ? row.fetchedAt.toISOString() : null,
    sourceUpdatedAtIso: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
  })
  return canonical as unknown as Record<string, unknown>
}

function findMatchingRow<T extends Record<string, unknown>>(
  rows: T[],
  request: NflRedraftProductionProviderRequest,
): T | null {
  if (rows.length === 0) return null
  const team = requestTeam(request)
  const player = request.playerName?.trim().toLowerCase()
  const gameId = request.gameId?.trim()
  return rows.find((row) => {
    if (gameId && String(row.gameId ?? row.id ?? row.externalId ?? '') === gameId) return true
    const rowName = String(row.name ?? row.playerName ?? row.player ?? '').trim().toLowerCase()
    const rowTeam = normalizeTeamAbbrev(String(row.teamAbbrev ?? row.team ?? row.homeTeam ?? row.awayTeam ?? ''))
    const nameOk = !player || rowName === player
    const teamOk = !team
      || rowTeam === team
      || normalizeTeamAbbrev(String(row.homeTeam ?? '')) === team
      || normalizeTeamAbbrev(String(row.awayTeam ?? '')) === team
    return nameOk && teamOk
  }) ?? rows[0] ?? null
}

function canonicalCacheKey(request: NflRedraftProductionProviderRequest): string {
  return request.cacheKey ?? [
    'nfl-redraft-provider',
    request.capability,
    request.season ?? 'season',
    request.week ?? 'week',
    request.playerName ?? request.allFantasyPlayerId ?? request.teamAbbr ?? request.leagueImportId ?? 'global',
  ].join(':')
}

export function buildNflRedraftProductionProviderAdapters(): NflRedraftProductionProviderAdapterRegistry {
  const adapters: NflRedraftProductionProviderAdapterRegistry = {
    rolling_insights: {
      player_identity: async (request) => {
        const canonical = await readSportsPlayerIdentity(request, 'rolling_insights', 'rolling_insights')
        if (!canonical) return null
        return makeResult({
          providerId: 'rolling_insights',
          capability: request.capability,
          canonicalData: canonical,
          fetchedAtIso: new Date().toISOString(),
          integrationName: 'SportsPlayer rolling_insights cache',
        })
      },
      schedule: async (request) => {
        const { fetchRollingInsightsScheduleSeason } = await import('@/lib/sports-live-scores-service')
        const rows = await fetchRollingInsightsScheduleSeason('NFL', Number(requestSeason(request)))
        const row = findMatchingRow(rows as unknown as Record<string, unknown>[], request)
        if (!row) return null
        const canonical = normalizeNflRedraftProviderGameContext('rolling_insights', row, {
          playerTeamAbbr: request.teamAbbr,
        })
        return makeResult({
          providerId: 'rolling_insights',
          capability: request.capability,
          canonicalData: canonical as unknown as Record<string, unknown>,
          fetchedAtIso: new Date().toISOString(),
          integrationName: 'fetchRollingInsightsScheduleSeason',
        })
      },
      live_stats: async (request) => {
        const { fetchRollingInsightsScoreboard } = await import('@/lib/sports-live-scores-service')
        const rows = await fetchRollingInsightsScoreboard('NFL')
        const row = findMatchingRow(rows as unknown as Record<string, unknown>[], request)
        if (!row) return null
        const canonical = normalizeNflRedraftProviderLiveScoringContext('rolling_insights', row, {
          allFantasyPlayerId: request.allFantasyPlayerId,
        })
        return makeResult({
          providerId: 'rolling_insights',
          capability: request.capability,
          canonicalData: canonical as unknown as Record<string, unknown>,
          fetchedAtIso: new Date().toISOString(),
          integrationName: 'fetchRollingInsightsScoreboard',
        })
      },
    },
    api_sports: {
      player_identity: async (request) => {
        if (!request.playerName) return null
        const { fetchAPISportsPlayerBySearch } = await import('@/lib/api-sports')
        const rows = await fetchAPISportsPlayerBySearch(request.playerName, requestSeason(request), { sport: 'NFL' })
        const row = findMatchingRow(rows as unknown as Record<string, unknown>[], request)
        if (!row) return null
        const canonical = normalizeNflRedraftProviderPlayerIdentity({
          providerId: 'api_sports',
          payload: row,
        })
        return makeResult({
          providerId: 'api_sports',
          capability: request.capability,
          canonicalData: canonical as unknown as Record<string, unknown>,
          fetchedAtIso: new Date().toISOString(),
          integrationName: 'fetchAPISportsPlayerBySearch',
        })
      },
      schedule: async (request) => {
        const { fetchAPISportsGamesByWeek, fetchAPISportsGames } = await import('@/lib/api-sports')
        const week = requestWeek(request)
        const rows = week
          ? await fetchAPISportsGamesByWeek(requestSeason(request), week, { sport: 'NFL' })
          : await fetchAPISportsGames(requestSeason(request), { sport: 'NFL' })
        const row = findMatchingRow(rows as unknown as Record<string, unknown>[], request)
        if (!row) return null
        const canonical = normalizeNflRedraftProviderGameContext('api_sports', row, {
          playerTeamAbbr: request.teamAbbr,
        })
        return makeResult({
          providerId: 'api_sports',
          capability: request.capability,
          canonicalData: canonical as unknown as Record<string, unknown>,
          fetchedAtIso: new Date().toISOString(),
          integrationName: week ? 'fetchAPISportsGamesByWeek' : 'fetchAPISportsGames',
        })
      },
      standings: async (request) => {
        const { fetchAPISportsStandings } = await import('@/lib/api-sports')
        const rows = await fetchAPISportsStandings(requestSeason(request), { sport: 'NFL' })
        return makeResult({
          providerId: 'api_sports',
          capability: request.capability,
          canonicalData: { standings: rows },
          fetchedAtIso: new Date().toISOString(),
          integrationName: 'fetchAPISportsStandings',
        })
      },
      news: async (request) => {
        const { getAPISportsDiagnostics } = await import('@/lib/api-sports')
        return makeResult({
          providerId: 'api_sports',
          capability: request.capability,
          canonicalData: { diagnostics: getAPISportsDiagnostics().slice(-5), newsUnavailable: true },
          fetchedAtIso: new Date().toISOString(),
          warnings: ['API-Sports news feed is not exposed as a dedicated reusable client in this repo yet.'],
          terminal: false,
          integrationName: 'getAPISportsDiagnostics',
        })
      },
    },
    thesportsdb: {
      headshots: async (request) => {
        if (!request.playerName) return null
        const { buildTheSportsDbV1Url } = await import('@/lib/providers/theSportsDbUrls')
        const { extractTheSportsDbPlayerImages } = await import('@/lib/providers/theSportsDbFieldMaps')
        const apiKey = process.env.THESPORTSDB_API_KEY || process.env.SPORTSDB_API_KEY || '123'
        const url = buildTheSportsDbV1Url('searchPlayers', { apiKey, params: { p: request.playerName } })
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) return null
        const payload = await res.json()
        const images = extractTheSportsDbPlayerImages(payload)
        if (!images.primary) return null
        return makeResult({
          providerId: 'thesportsdb',
          capability: request.capability,
          canonicalData: { headshotUrl: images.primary },
          fetchedAtIso: new Date().toISOString(),
          integrationName: 'TheSportsDB searchPlayers via URL helper',
        })
      },
      logos: async (request) => {
        const team = requestTeam(request)
        if (!team) return null
        const { buildTheSportsDbV1Url } = await import('@/lib/providers/theSportsDbUrls')
        const { extractTheSportsDbTeamImages } = await import('@/lib/providers/theSportsDbFieldMaps')
        const apiKey = process.env.THESPORTSDB_API_KEY || process.env.SPORTSDB_API_KEY || '123'
        const url = buildTheSportsDbV1Url('searchTeams', { apiKey, params: { t: team } })
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) return null
        const payload = await res.json()
        const images = extractTheSportsDbTeamImages(payload)
        if (!images.primary) return null
        return makeResult({
          providerId: 'thesportsdb',
          capability: request.capability,
          canonicalData: { teamLogoUrl: images.primary },
          fetchedAtIso: new Date().toISOString(),
          integrationName: 'TheSportsDB searchTeams via URL helper',
        })
      },
    },
    clearsports: {
      player_identity: async (request) => {
        const { fetchClearSportsPlayers } = await import('@/lib/clear-sports')
        const rows = await fetchClearSportsPlayers('NFL')
        const row = findMatchingRow(rows as unknown as Record<string, unknown>[], request)
        if (!row) return null
        const canonical = normalizeNflRedraftProviderPlayerIdentity({
          providerId: 'clearsports',
          payload: row,
        })
        return makeResult({
          providerId: 'clearsports',
          capability: request.capability,
          canonicalData: canonical as unknown as Record<string, unknown>,
          fetchedAtIso: new Date().toISOString(),
          integrationName: 'fetchClearSportsPlayers',
        })
      },
      schedule: async (request) => {
        const { fetchClearSportsGames } = await import('@/lib/clear-sports')
        const rows = await fetchClearSportsGames('NFL', requestSeason(request))
        const row = findMatchingRow(rows as unknown as Record<string, unknown>[], request)
        if (!row) return null
        const canonical = normalizeNflRedraftProviderGameContext('clearsports', row, {
          playerTeamAbbr: request.teamAbbr,
        })
        return makeResult({
          providerId: 'clearsports',
          capability: request.capability,
          canonicalData: canonical as unknown as Record<string, unknown>,
          fetchedAtIso: new Date().toISOString(),
          integrationName: 'fetchClearSportsGames',
        })
      },
    },
    fantasycalc: {
      fantasy_valuations: async (request) => {
        const { getFantasyCalcValuesDbFirst } = await import('@/lib/fantasycalc-db')
        const { findPlayerByName, findPlayerBySleeperId } = await import('@/lib/fantasycalc')
        const settings = request.valuationSettings ?? { isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1 } as const
        const players = await getFantasyCalcValuesDbFirst(settings)
        if (!request.allFantasyPlayerId && !request.playerName) {
          return makeResult({
            providerId: 'fantasycalc',
            capability: request.capability,
            canonicalData: { valuationRecords: players },
            fetchedAtIso: new Date().toISOString(),
            integrationName: 'getFantasyCalcValuesDbFirst',
          })
        }
        const player = request.allFantasyPlayerId
          ? findPlayerBySleeperId(players, request.allFantasyPlayerId)
          : request.playerName
            ? findPlayerByName(players, request.playerName)
            : null
        if (!player) return null
        const canonical = normalizeNflRedraftProviderPlayerIntelligence('fantasycalc', {
          overallRank: player.overallRank,
          positionRank: player.positionRank,
          adp: player.maybeAdp,
          trendLabel: player.trend30Day > 0 ? 'rising' : player.trend30Day < 0 ? 'falling' : 'stable',
          updatedAt: new Date().toISOString(),
        })
        return makeResult({
          providerId: 'fantasycalc',
          capability: request.capability,
          canonicalData: {
            fantasyValuation: {
              value: player.value,
              redraftValue: player.redraftValue,
              dynastyValue: player.value,
              combinedValue: player.combinedValue,
              trend30Day: player.trend30Day,
            },
            intelligence: canonical,
          },
          fetchedAtIso: new Date().toISOString(),
          integrationName: 'getFantasyCalcValuesDbFirst',
        })
      },
    },
    openweather: {
      weather: async (request) => {
        const team = requestTeam(request)
        if (!team) return null
        const { fetchGameWeather } = await import('@/lib/openweathermap')
        const gameWeather = await fetchGameWeather(team)
        if (!gameWeather) return null
        const canonical = normalizeNflRedraftProviderGameContext('openweather', {
          team,
          stadium: gameWeather.venue,
          roofType: gameWeather.isDome ? 'dome' : 'outdoor',
          weatherCondition: gameWeather.weather.condition,
          temperatureF: gameWeather.weather.temp,
          windSpeedMph: gameWeather.weather.windSpeed,
          precipitationType: gameWeather.weather.rain1h ? 'rain' : gameWeather.weather.snow1h ? 'snow' : 'none',
          updatedAt: new Date().toISOString(),
        }, {
          playerTeamAbbr: team,
        })
        return makeResult({
          providerId: 'openweather',
          capability: request.capability,
          canonicalData: canonical as unknown as Record<string, unknown>,
          fetchedAtIso: new Date().toISOString(),
          integrationName: 'fetchGameWeather',
        })
      },
    },
    sleeper: {
      league_import: async (request) => {
        if (!request.leagueImportId) return null
        const { getLeagueInfo, getLeagueRosters, getLeagueUsers } = await import('@/lib/sleeper-client')
        const leagueId = String(request.leagueImportId)
        const [league, rosters, users] = await Promise.all([
          getLeagueInfo(leagueId),
          getLeagueRosters(leagueId),
          getLeagueUsers(leagueId),
        ])
        if (!league) return null
        return makeResult({
          providerId: 'sleeper',
          capability: request.capability,
          canonicalData: {
            importProvider: 'sleeper',
            leagueName: league.name,
            season: numberOrNull(league.season),
            teams: rosters.length,
            managers: users.length,
            status: league.status,
          },
          fetchedAtIso: new Date().toISOString(),
          integrationName: 'sleeper-client league import bundle',
        })
      },
    },
    espn: {
      league_import: async (request) => {
        if (!request.leagueImportId) return null
        const { fetchEspnLeague } = await import('@/lib/espn-client')
        const league = await fetchEspnLeague(request.leagueImportId, numberOrNull(request.season) ?? undefined)
        return makeResult({
          providerId: 'espn',
          capability: request.capability,
          canonicalData: {
            importProvider: 'espn',
            leagueName: league.leagueName,
            season: league.seasonId,
            teams: league.numTeams,
            scoringType: league.scoringType,
          },
          fetchedAtIso: new Date().toISOString(),
          integrationName: 'fetchEspnLeague',
        })
      },
    },
    canonical_cache: {
      player_identity: async (request) => readCanonicalCache(request),
      schedule: async (request) => readCanonicalCache(request),
      live_stats: async (request) => readCanonicalCache(request),
      standings: async (request) => readCanonicalCache(request),
      fantasy_valuations: async (request) => readCanonicalCache(request),
      weather: async (request) => readCanonicalCache(request),
      news: async (request) => readCanonicalCache(request),
    },
    default_avatar: {
      headshots: async (request) => makeResult({
        providerId: 'default_avatar',
        capability: request.capability,
        canonicalData: { headshotUrl: null, fallbackKind: 'generic-player' },
        fetchedAtIso: new Date().toISOString(),
        fallbackUsed: true,
        terminal: true,
        realIntegration: true,
        integrationName: 'AllFantasy default avatar',
      }),
    },
    af_default_logo: {
      logos: async (request) => makeResult({
        providerId: 'af_default_logo',
        capability: request.capability,
        canonicalData: { teamLogoUrl: null, fallbackKind: 'team-text-badge' },
        fetchedAtIso: new Date().toISOString(),
        fallbackUsed: true,
        terminal: true,
        realIntegration: true,
        integrationName: 'AllFantasy default team logo',
      }),
    },
    hidden: {
      fantasy_valuations: async (request) => hiddenResult(request),
      weather: async (request) => hiddenResult(request),
      news: async (request) => hiddenResult(request),
    },
    runtime: {
      live_stats: async (request) => makeResult({
        providerId: 'runtime',
        capability: request.capability,
        canonicalData: { preservedRuntime: true, unavailableProviderData: true },
        fetchedAtIso: new Date().toISOString(),
        fallbackUsed: true,
        terminal: true,
        integrationName: 'AllFantasy runtime fallback',
      }),
      standings: async (request) => makeResult({
        providerId: 'runtime',
        capability: request.capability,
        canonicalData: { preservedRuntime: true, unavailableProviderData: true },
        fetchedAtIso: new Date().toISOString(),
        fallbackUsed: true,
        terminal: true,
        integrationName: 'AllFantasy runtime fallback',
      }),
    },
  }

  return adapters
}

async function readCanonicalCache(
  request: NflRedraftProductionProviderRequest,
): Promise<NflRedraftProductionProviderAdapterResult | null> {
  const prisma = await defaultPrisma()
  if (!prisma.sportsDataCache?.findUnique) return null
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: canonicalCacheKey(request) } })
  if (!row) return null
  const stale = row.expiresAt ? row.expiresAt.getTime() <= Date.now() : false
  return makeResult({
    providerId: 'canonical_cache',
    capability: request.capability,
    canonicalData: asRecord(row.data),
    fetchedAtIso: row.createdAt?.toISOString() ?? new Date().toISOString(),
    sourceTimestampIso: row.createdAt?.toISOString() ?? null,
    freshnessStatus: stale ? 'stale' : 'available',
    cacheUsed: true,
    fallbackUsed: true,
    healthStatus: stale ? 'DEGRADED' : 'ACTIVE',
    warnings: stale ? ['Canonical cache data is stale.'] : [],
    integrationName: 'SportsDataCache',
  })
}

function hiddenResult(request: NflRedraftProductionProviderRequest): NflRedraftProductionProviderAdapterResult {
  return makeResult({
    providerId: 'hidden',
    capability: request.capability,
    canonicalData: null,
    fetchedAtIso: new Date().toISOString(),
    freshnessStatus: 'missing',
    fallbackUsed: true,
    terminal: true,
    integrationName: 'Hidden optional field',
  })
}

function mergeAdapters(
  defaults: NflRedraftProductionProviderAdapterRegistry,
  overrides: NflRedraftProductionProviderAdapterRegistry | undefined,
): NflRedraftProductionProviderAdapterRegistry {
  if (!overrides) return defaults
  const merged: NflRedraftProductionProviderAdapterRegistry = { ...defaults }
  for (const [providerId, providerAdapters] of Object.entries(overrides) as Array<
    [NflRedraftProviderNodeId, Partial<Record<NflRedraftProviderOrchestratorCapability, NflRedraftProductionProviderAdapter>>]
  >) {
    merged[providerId] = { ...(merged[providerId] ?? {}), ...providerAdapters }
  }
  return merged
}

function mergedConfigOverrides(
  request: NflRedraftProductionProviderRequest,
  deps: NflRedraftProductionProviderDependencies,
) {
  return {
    ...buildNflRedraftProductionProviderConfigOverrides(deps.env),
    ...(request.configOverrides ?? {}),
  }
}

function stateForProvider(
  providerId: NflRedraftProviderNodeId,
  overrides: Partial<Record<NflRedraftProviderNodeId, Partial<NflRedraftProviderNodeConfig>>>,
): NflRedraftProviderLifecycleState {
  const override = overrides[providerId]
  if (override?.enabled === false) return 'DISABLED'
  return override?.state ?? 'UNKNOWN'
}

function isProviderSelectable(state: NflRedraftProviderLifecycleState): boolean {
  return state === 'ACTIVE' || state === 'DEGRADED' || state === 'UNKNOWN'
}

function policyForRequest(request: NflRedraftProductionProviderRequest): NflRedraftProviderCapabilityPolicy {
  return {
    ...NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES[request.capability],
    ...(request.policyOverrides?.[request.capability] ?? {}),
  }
}

export async function resolveNflRedraftProductionProviderCapability(
  request: NflRedraftProductionProviderRequest,
  deps: NflRedraftProductionProviderDependencies = {},
): Promise<NflRedraftProductionProviderResolution> {
  const timestampIso = (deps.now?.() ?? new Date()).toISOString()
  const policy = policyForRequest(request)
  const fallbackChain = getNflRedraftProviderFallbackOrder(policy)
  const configOverrides = mergedConfigOverrides(request, deps)
  const adapters = mergeAdapters(buildNflRedraftProductionProviderAdapters(), deps.adapters)
  const attempts: NflRedraftProductionProviderAttempt[] = []
  const warnings: string[] = []
  const canonicalResults: Array<{ providerId: NflRedraftProviderNodeId; canonicalData: Record<string, unknown> | null }> = []
  let selected: NflRedraftProductionProviderAdapterResult | null = null

  for (const providerId of fallbackChain) {
    const state = stateForProvider(providerId, configOverrides)
    const attemptBase = {
      providerId,
      state,
      attempted: false,
      selected: false,
      cacheUsed: false,
      fallbackUsed: providerId !== policy.preferredProvider,
      realIntegration: false,
      error: null as string | null,
    }

    if (!isProviderSelectable(state)) {
      attempts.push({ ...attemptBase, reason: `state_${state.toLowerCase()}` })
      continue
    }

    const adapter = adapters[providerId]?.[request.capability]
    if (!adapter) {
      attempts.push({ ...attemptBase, reason: 'no_adapter' })
      continue
    }

    try {
      const result = await adapter(request)
      const canonicalData = result?.canonicalData ? sanitizeNflRedraftCanonicalProviderData(result.canonicalData) : null
      if (canonicalData && hasRawProviderLeak(canonicalData)) {
        attempts.push({ ...attemptBase, attempted: true, reason: 'canonical_leak_blocked' })
        warnings.push(`${providerId}:canonical_leak_blocked`)
        continue
      }

      if (result && canonicalData) {
        canonicalResults.push({ providerId, canonicalData })
      }

      const usable = Boolean(result && (!isEmptyCanonicalData(canonicalData) || result.terminal))
      attempts.push({
        ...attemptBase,
        attempted: true,
        selected: usable,
        cacheUsed: result?.cacheUsed ?? false,
        fallbackUsed: result?.fallbackUsed ?? providerId !== policy.preferredProvider,
        realIntegration: result?.realIntegration ?? false,
        reason: usable ? 'selected' : 'no_canonical_data',
      })

      if (usable && result) {
        selected = { ...result, canonicalData }
        warnings.push(...result.warnings)
        break
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      attempts.push({ ...attemptBase, attempted: true, reason: 'adapter_error', error: message })
      warnings.push(`${providerId}:adapter_error`)
    }
  }

  const merged = mergeNflRedraftCanonicalProviderResults({
    capability: request.capability,
    results: canonicalResults,
    policyOverrides: request.policyOverrides,
  })

  return {
    modelVersion: NFL_REDRAFT_PRODUCTION_PROVIDER_WIRING_MODEL_VERSION,
    capability: request.capability,
    selectedProvider: selected?.providerId ?? null,
    fallbackChain,
    attempts,
    canonicalData: selected?.canonicalData ?? null,
    mergedCanonicalData: merged.canonicalData,
    conflicts: merged.conflicts,
    trace: {
      canonicalPlayerId: request.allFantasyPlayerId ?? null,
      providerUsed: selected?.providerId ?? null,
      timestampIso,
      sourceTimestampIso: selected?.sourceTimestampIso ?? null,
      freshnessStatus: selected?.freshnessStatus ?? 'missing',
      fallbackUsed: selected?.fallbackUsed ?? false,
      cacheUsed: selected?.cacheUsed ?? false,
      healthStatus: selected?.healthStatus ?? null,
    },
    warnings,
    providerPayloadExposed: false,
    providerIdsExposedToCanonicalData: false,
  }
}

export function assertNoMonthToMonthProviderRequiredForRuntime(): {
  ok: true
  checkedCapabilities: NflRedraftProviderOrchestratorCapability[]
} {
  const runtimeCapabilities: NflRedraftProviderOrchestratorCapability[] = [
    'player_identity',
    'schedule',
    'live_stats',
    'standings',
    'league_import',
  ]

  for (const capability of runtimeCapabilities) {
    const chain = getNflRedraftProviderFallbackOrder(NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES[capability])
    const firstNonEnhancement = chain.find((providerId) => !ENHANCEMENT_PROVIDERS.has(providerId))
    if (!firstNonEnhancement) {
      throw new Error(`Runtime capability ${capability} requires a month-to-month provider.`)
    }
  }

  return { ok: true, checkedCapabilities: runtimeCapabilities }
}
