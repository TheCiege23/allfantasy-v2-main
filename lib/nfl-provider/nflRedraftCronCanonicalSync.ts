import {
  resolveNflRedraftProductionProviderCapability,
  type NflRedraftProductionProviderDependencies,
  type NflRedraftProductionProviderRequest,
  type NflRedraftProductionProviderResolution,
} from '@/lib/nfl-provider/nflRedraftProductionProviderWiring'
import type { NflRedraftProviderOrchestratorCapability } from '@/lib/nfl-provider/nflRedraftProviderOrchestrator'

export const NFL_REDRAFT_CRON_CANONICAL_SYNC_MODEL_VERSION =
  'nfl-redraft-cron-canonical-sync-v1' as const

export type NflRedraftCronCanonicalJob =
  | 'import-scores'
  | 'import-schedules'
  | 'import-standings'
  | 'import-injuries'

export type NflRedraftCronCanonicalSyncStatus =
  | 'synced'
  | 'deferred'
  | 'skipped'
  | 'unavailable'

export type NflRedraftCronCanonicalSyncResult = {
  modelVersion: typeof NFL_REDRAFT_CRON_CANONICAL_SYNC_MODEL_VERSION
  job: NflRedraftCronCanonicalJob
  sport: string
  season: string
  week: string | null
  status: NflRedraftCronCanonicalSyncStatus
  capability: NflRedraftProviderOrchestratorCapability | null
  cacheKey: string | null
  selectedProvider: string | null
  providerFlow: Array<'provider' | 'orchestrator' | 'canonical_cache'>
  freshnessStatus: string
  fallbackUsed: boolean
  cacheUsed: boolean
  expiresAtIso: string | null
  warnings: string[]
  deferredReason: string | null
  rawProviderPayloadExposed: false
  providerSecretsExposed: false
}

export type NflRedraftCronCanonicalSyncInput = {
  job: NflRedraftCronCanonicalJob
  sport?: string | null
  season?: string | number | null
  week?: string | number | null
  teamAbbr?: string | null
  gameId?: string | null
  ttlMs?: number | null
  cacheKey?: string | null
}

type SportsDataCacheLike = {
  upsert: (args: {
    where: { cacheKey: string }
    update: { data: Record<string, unknown>; expiresAt: Date; createdAt: Date }
    create: { cacheKey: string; data: Record<string, unknown>; expiresAt: Date; createdAt: Date }
  }) => Promise<unknown>
}

export type NflRedraftCronCanonicalSyncDeps = {
  now?: () => Date
  prisma?: {
    sportsDataCache?: SportsDataCacheLike
  }
  resolveProviderCapability?: (
    request: NflRedraftProductionProviderRequest,
    deps?: NflRedraftProductionProviderDependencies,
  ) => Promise<NflRedraftProductionProviderResolution>
  providerDeps?: NflRedraftProductionProviderDependencies
}

const DEFAULT_TTL_MS: Record<Exclude<NflRedraftCronCanonicalJob, 'import-injuries'>, number> = {
  'import-scores': 1000 * 60 * 5,
  'import-schedules': 1000 * 60 * 60 * 24,
  'import-standings': 1000 * 60 * 15,
}

const CAPABILITY_BY_JOB: Record<NflRedraftCronCanonicalJob, NflRedraftProviderOrchestratorCapability | null> = {
  'import-scores': 'live_stats',
  'import-schedules': 'schedule',
  'import-standings': 'standings',
  'import-injuries': null,
}

function normalizeSport(value: string | null | undefined): string {
  return String(value ?? 'NFL').trim().toUpperCase() || 'NFL'
}

function normalizeSeason(value: string | number | null | undefined, now: Date): string {
  return String(value ?? now.getFullYear())
}

function normalizeWeek(value: string | number | null | undefined): string | null {
  if (value == null || value === '') return null
  return String(value)
}

export function buildNflRedraftCronCanonicalCacheKey(input: {
  job: Exclude<NflRedraftCronCanonicalJob, 'import-injuries'>
  season: string
  week?: string | null
  teamAbbr?: string | null
  gameId?: string | null
}): string {
  const capability = CAPABILITY_BY_JOB[input.job]
  return [
    'nfl-redraft-provider',
    capability,
    input.season,
    input.week ?? 'week',
    input.gameId ?? input.teamAbbr ?? input.job,
  ].join(':')
}

async function defaultSportsDataCache(): Promise<SportsDataCacheLike | null> {
  const { prisma } = await import('@/lib/prisma')
  return prisma.sportsDataCache as unknown as SportsDataCacheLike
}

function result(input: Omit<NflRedraftCronCanonicalSyncResult, 'modelVersion' | 'providerFlow' | 'rawProviderPayloadExposed' | 'providerSecretsExposed'>): NflRedraftCronCanonicalSyncResult {
  return {
    modelVersion: NFL_REDRAFT_CRON_CANONICAL_SYNC_MODEL_VERSION,
    providerFlow: ['provider', 'orchestrator', 'canonical_cache'],
    rawProviderPayloadExposed: false,
    providerSecretsExposed: false,
    ...input,
  }
}

function sanitizeCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeCanonicalValue)
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase()
    if (
      lower.includes('payload') ||
      lower.includes('providerplayerid') ||
      lower.includes('secret') ||
      lower.includes('token') ||
      lower.includes('api_key') ||
      lower.includes('apikey')
    ) {
      continue
    }
    output[key] = sanitizeCanonicalValue(entry)
  }
  return output
}

function safeCanonicalPayload(input: {
  job: NflRedraftCronCanonicalJob
  sport: string
  season: string
  week: string | null
  resolution: NflRedraftProductionProviderResolution
  generatedAtIso: string
}): Record<string, unknown> {
  return {
    modelVersion: NFL_REDRAFT_CRON_CANONICAL_SYNC_MODEL_VERSION,
    job: input.job,
    sport: input.sport,
    season: input.season,
    week: input.week,
    capability: input.resolution.capability,
    selectedProvider: input.resolution.selectedProvider,
    generatedAtIso: input.generatedAtIso,
    sourceTimestampIso: input.resolution.trace.sourceTimestampIso,
    freshnessStatus: input.resolution.trace.freshnessStatus,
    fallbackUsed: input.resolution.trace.fallbackUsed,
    cacheUsed: input.resolution.trace.cacheUsed,
    healthStatus: input.resolution.trace.healthStatus,
    canonicalData: sanitizeCanonicalValue(input.resolution.canonicalData),
    mergedCanonicalData: sanitizeCanonicalValue(input.resolution.mergedCanonicalData),
    warnings: input.resolution.warnings,
  }
}

export async function syncNflRedraftCronCanonicalCache(
  input: NflRedraftCronCanonicalSyncInput,
  deps: NflRedraftCronCanonicalSyncDeps = {},
): Promise<NflRedraftCronCanonicalSyncResult> {
  const now = deps.now?.() ?? new Date()
  const sport = normalizeSport(input.sport)
  const season = normalizeSeason(input.season, now)
  const week = normalizeWeek(input.week)
  const capability = CAPABILITY_BY_JOB[input.job]

  if (sport !== 'NFL') {
    return result({
      job: input.job,
      sport,
      season,
      week,
      status: 'skipped',
      capability,
      cacheKey: null,
      selectedProvider: null,
      freshnessStatus: 'missing',
      fallbackUsed: false,
      cacheUsed: false,
      expiresAtIso: null,
      warnings: [`${input.job} canonical cache sync is scoped to NFL Redraft only.`],
      deferredReason: 'non_nfl_sport',
    })
  }

  if (!capability) {
    return result({
      job: input.job,
      sport,
      season,
      week,
      status: 'deferred',
      capability: null,
      cacheKey: null,
      selectedProvider: null,
      freshnessStatus: 'missing',
      fallbackUsed: false,
      cacheUsed: false,
      expiresAtIso: null,
      warnings: ['G49G does not expose a standalone injury capability; do not redesign provider architecture in RC1.'],
      deferredReason: 'missing_orchestrator_injury_capability',
    })
  }

  const cacheKey = input.cacheKey ?? buildNflRedraftCronCanonicalCacheKey({
    job: input.job as Exclude<NflRedraftCronCanonicalJob, 'import-injuries'>,
    season,
    week,
    teamAbbr: input.teamAbbr,
    gameId: input.gameId,
  })
  const resolver = deps.resolveProviderCapability ?? resolveNflRedraftProductionProviderCapability
  const resolution = await resolver({
    capability,
    season,
    week,
    teamAbbr: input.teamAbbr,
    gameId: input.gameId,
    cacheKey,
    policyOverrides: {
      [capability]: { cacheFallback: null },
    },
  }, deps.providerDeps)
  const canonicalAvailable =
    Boolean(resolution.canonicalData && Object.keys(resolution.canonicalData).length) ||
    Object.keys(resolution.mergedCanonicalData).length > 0

  if (!canonicalAvailable) {
    return result({
      job: input.job,
      sport,
      season,
      week,
      status: 'unavailable',
      capability,
      cacheKey,
      selectedProvider: resolution.selectedProvider,
      freshnessStatus: resolution.trace.freshnessStatus,
      fallbackUsed: resolution.trace.fallbackUsed,
      cacheUsed: resolution.trace.cacheUsed,
      expiresAtIso: null,
      warnings: [...resolution.warnings, 'provider_orchestrator_returned_no_canonical_data'],
      deferredReason: 'canonical_data_unavailable',
    })
  }

  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS[input.job as Exclude<NflRedraftCronCanonicalJob, 'import-injuries'>]
  const expiresAt = new Date(now.getTime() + ttlMs)
  const cache = deps.prisma?.sportsDataCache ?? await defaultSportsDataCache()
  if (!cache) {
    return result({
      job: input.job,
      sport,
      season,
      week,
      status: 'unavailable',
      capability,
      cacheKey,
      selectedProvider: resolution.selectedProvider,
      freshnessStatus: resolution.trace.freshnessStatus,
      fallbackUsed: resolution.trace.fallbackUsed,
      cacheUsed: resolution.trace.cacheUsed,
      expiresAtIso: null,
      warnings: [...resolution.warnings, 'sports_data_cache_unavailable'],
      deferredReason: 'sports_data_cache_unavailable',
    })
  }

  await cache.upsert({
    where: { cacheKey },
    update: {
      data: safeCanonicalPayload({ job: input.job, sport, season, week, resolution, generatedAtIso: now.toISOString() }),
      expiresAt,
      createdAt: now,
    },
    create: {
      cacheKey,
      data: safeCanonicalPayload({ job: input.job, sport, season, week, resolution, generatedAtIso: now.toISOString() }),
      expiresAt,
      createdAt: now,
    },
  })

  return result({
    job: input.job,
    sport,
    season,
    week,
    status: 'synced',
    capability,
    cacheKey,
    selectedProvider: resolution.selectedProvider,
    freshnessStatus: resolution.trace.freshnessStatus,
    fallbackUsed: resolution.trace.fallbackUsed,
    cacheUsed: resolution.trace.cacheUsed,
    expiresAtIso: expiresAt.toISOString(),
    warnings: resolution.warnings,
    deferredReason: null,
  })
}
