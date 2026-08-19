import type {
  CanonicalNflRedraftProviderRecord,
  NflRedraftProviderFreshness,
  NflRedraftProviderId,
} from '@/lib/nfl-provider/nflRedraftProviderFoundation'
import {
  buildNflRedraftProviderFreshness,
  toCanonicalNflRedraftProviderRecord,
} from '@/lib/nfl-provider/nflRedraftProviderFoundation'
import type { NflRedraftCanonicalPlayer, NflRedraftDataState } from '@/lib/player-data/nflRedraftCanonicalPlayer'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import type {
  NflRedraftProviderFallbackMetadata,
  NflRedraftProviderFreshnessMetadata,
} from '@/lib/player-data/nflRedraftPlayerMetadata'

export const NFL_REDRAFT_PLAYER_INTELLIGENCE_MODEL_VERSION = 'nfl-redraft-player-intelligence-v1' as const

export type NflRedraftProjectionRange = {
  low: number | null
  high: number | null
}

export type NflRedraftProjectionIntelligence = {
  projectedFantasyPoints: number | null
  seasonProjectedPoints: number | null
  restOfSeasonProjectedPoints: number | null
  projectionRange: NflRedraftProjectionRange | null
  scoringFormat: string | null
  source: string | null
  updatedAtIso: string | null
  freshness: NflRedraftDataState
  unavailable: boolean
}

export type NflRedraftRankingIntelligence = {
  fantasyRank: number | null
  positionalRank: number | null
  adp: number | null
  adpSource: string | null
  aiAdp: number | null
  aiAdpSampleSize: number | null
}

export type NflRedraftInjuryIntelligence = {
  injuryStatus: string | null
  practiceStatus: string | null
  gameStatus: string | null
  source: string | null
  updatedAtIso: string | null
  freshness: NflRedraftDataState
}

export type NflRedraftNewsIntelligence = {
  latestNews: string | null
  newsTimestamp: string | null
  source: string | null
  freshness: NflRedraftDataState
}

export type NflRedraftPlayerIntelligence = {
  modelVersion: typeof NFL_REDRAFT_PLAYER_INTELLIGENCE_MODEL_VERSION
  projection: NflRedraftProjectionIntelligence
  ranking: NflRedraftRankingIntelligence
  injury: NflRedraftInjuryIntelligence
  news: NflRedraftNewsIntelligence
  trendLabel: string | null
  providerFreshness: NflRedraftProviderFreshnessMetadata
  providerFallback: NflRedraftProviderFallbackMetadata
}

export type NormalizeNflRedraftProviderIntelligenceOptions = {
  now?: Date
  fetchedAtIso?: string | null
  sourceUpdatedAtIso?: string | null
  lastSuccessfulSyncAtIso?: string | null
  fallback?: boolean
  maxAgeMinutes?: number
}

type BuildIntelligenceInput = {
  projectedFantasyPoints?: number | null
  seasonProjectedPoints?: number | null
  restOfSeasonProjectedPoints?: number | null
  projectionFloor?: number | null
  projectionCeiling?: number | null
  scoringFormat?: string | null
  projectionSource?: string | null
  projectionUpdatedAtIso?: string | null
  projectionFreshness?: NflRedraftDataState
  fantasyRank?: number | null
  positionalRank?: number | null
  adp?: number | null
  adpSource?: string | null
  aiAdp?: number | null
  aiAdpSampleSize?: number | null
  injuryStatus?: string | null
  practiceStatus?: string | null
  gameStatus?: string | null
  injurySource?: string | null
  injuryUpdatedAtIso?: string | null
  injuryFreshness?: NflRedraftDataState
  latestNews?: string | null
  newsTimestamp?: string | null
  newsSource?: string | null
  newsFreshness?: NflRedraftDataState
  trendLabel?: string | null
  providerFreshness?: Partial<NflRedraftProviderFreshnessMetadata>
  providerFallback?: Partial<NflRedraftProviderFallbackMetadata>
}

const PROVIDER_INTELLIGENCE_MAX_AGE_MINUTES: Record<NflRedraftProviderId, number> = {
  api_sports: 180,
  clearsports: 360,
  sportsdataio: 180,
  rolling_insights: 120,
  fantasycalc: 360,
  espn: 180,
  sleeper: 1440,
  thesportsdb: 1440,
  openweather: 120,
  deterministic: 525600,
}

function cleanString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function finiteInteger(value: unknown): number | null {
  const valueNumber = finiteNumber(value)
  return valueNumber == null ? null : Math.trunc(valueNumber)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readPath(source: unknown, path: string): unknown {
  let current: unknown = source
  for (const part of path.split('.')) {
    const record = asRecord(current)
    if (!(part in record)) return undefined
    current = record[part]
  }
  return current
}

function firstString(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = cleanString(readPath(source, path))
    if (value) return value
  }
  return null
}

function firstNumber(source: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const value = finiteNumber(readPath(source, path))
    if (value != null) return value
  }
  return null
}

function firstInteger(source: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const value = finiteInteger(readPath(source, path))
    if (value != null) return value
  }
  return null
}

function isoFromValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

function firstIso(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = isoFromValue(readPath(source, path))
    if (value) return value
  }
  return null
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => cleanString(value)).filter((value): value is string => Boolean(value))))
}

function dataStateFromFreshness(freshness: NflRedraftProviderFreshness | null | undefined): NflRedraftDataState {
  if (!freshness) return 'unknown'
  if (freshness.status === 'fresh') return 'available'
  if (freshness.status === 'stale') return 'stale'
  return 'missing'
}

function providerFreshnessMetadata(
  freshness: Partial<NflRedraftProviderFreshnessMetadata> | null | undefined,
): NflRedraftProviderFreshnessMetadata {
  const status = freshness?.status ?? 'unknown'
  const warnings = uniqueStrings(freshness?.warnings ?? [])
  return {
    status,
    updatedAtIso: freshness?.updatedAtIso ?? null,
    ageMinutes: freshness?.ageMinutes ?? null,
    maxAgeMinutes: freshness?.maxAgeMinutes ?? null,
    stale: freshness?.stale ?? status === 'stale',
    warnings,
  }
}

function providerFallbackMetadata(
  fallback: Partial<NflRedraftProviderFallbackMetadata> | null | undefined,
): NflRedraftProviderFallbackMetadata {
  const fields = uniqueStrings(fallback?.fields ?? [])
  const labels = uniqueStrings(fallback?.labels ?? fields)
  return {
    fallback: fallback?.fallback ?? fields.length > 0,
    fields,
    labels,
  }
}

function missingFieldsFromInput(input: BuildIntelligenceInput): string[] {
  const missing: string[] = []
  if (input.projectedFantasyPoints == null && input.seasonProjectedPoints == null && input.restOfSeasonProjectedPoints == null) missing.push('projection')
  if (input.adp == null) missing.push('adp')
  if (input.fantasyRank == null && input.positionalRank == null) missing.push('ranking')
  if (!cleanString(input.injuryStatus)) missing.push('injuryStatus')
  if (!cleanString(input.latestNews)) missing.push('news')
  return missing
}

function unavailableProjection(input: BuildIntelligenceInput): boolean {
  return input.projectedFantasyPoints == null &&
    input.seasonProjectedPoints == null &&
    input.restOfSeasonProjectedPoints == null
}

export function buildNflRedraftPlayerIntelligence(input: BuildIntelligenceInput): NflRedraftPlayerIntelligence {
  const range =
    input.projectionFloor != null || input.projectionCeiling != null
      ? { low: finiteNumber(input.projectionFloor), high: finiteNumber(input.projectionCeiling) }
      : null
  const fallbackFields = uniqueStrings([...(input.providerFallback?.fields ?? []), ...missingFieldsFromInput(input)])
  const fallbackLabels = uniqueStrings(input.providerFallback?.labels ?? fallbackFields)
  const providerFreshness = providerFreshnessMetadata(input.providerFreshness)
  const projectionUnavailable = unavailableProjection(input)

  return {
    modelVersion: NFL_REDRAFT_PLAYER_INTELLIGENCE_MODEL_VERSION,
    projection: {
      projectedFantasyPoints: finiteNumber(input.projectedFantasyPoints),
      seasonProjectedPoints: finiteNumber(input.seasonProjectedPoints),
      restOfSeasonProjectedPoints: finiteNumber(input.restOfSeasonProjectedPoints),
      projectionRange: range,
      scoringFormat: cleanString(input.scoringFormat),
      source: projectionUnavailable ? null : cleanString(input.projectionSource),
      updatedAtIso: input.projectionUpdatedAtIso ?? null,
      freshness: input.projectionFreshness ?? (projectionUnavailable ? 'missing' : providerFreshness.status),
      unavailable: projectionUnavailable,
    },
    ranking: {
      fantasyRank: finiteInteger(input.fantasyRank),
      positionalRank: finiteInteger(input.positionalRank),
      adp: finiteNumber(input.adp),
      adpSource: input.adp == null ? null : cleanString(input.adpSource),
      aiAdp: finiteNumber(input.aiAdp),
      aiAdpSampleSize: finiteInteger(input.aiAdpSampleSize),
    },
    injury: {
      injuryStatus: cleanString(input.injuryStatus),
      practiceStatus: cleanString(input.practiceStatus),
      gameStatus: cleanString(input.gameStatus),
      source: cleanString(input.injuryStatus) ? cleanString(input.injurySource) : null,
      updatedAtIso: input.injuryUpdatedAtIso ?? null,
      freshness: input.injuryFreshness ?? (cleanString(input.injuryStatus) ? providerFreshness.status : 'missing'),
    },
    news: {
      latestNews: cleanString(input.latestNews),
      newsTimestamp: input.newsTimestamp ?? null,
      source: cleanString(input.latestNews) ? cleanString(input.newsSource) : null,
      freshness: input.newsFreshness ?? (cleanString(input.latestNews) ? providerFreshness.status : 'missing'),
    },
    trendLabel: cleanString(input.trendLabel),
    providerFreshness,
    providerFallback: providerFallbackMetadata({
      fallback: input.providerFallback?.fallback ?? fallbackFields.length > 0,
      fields: fallbackFields,
      labels: fallbackLabels,
    }),
  }
}

export function buildNflRedraftPlayerIntelligenceFromCanonicalPlayer(
  player: NflRedraftCanonicalPlayer,
  augment?: {
    adpSource?: string | null
    aiAdp?: number | null
    aiAdpSampleSize?: number | null
    trendLabel?: string | null
  },
): NflRedraftPlayerIntelligence {
  return buildNflRedraftPlayerIntelligence({
    projectedFantasyPoints: player.currentProjection.weeklyProjectedPoints,
    seasonProjectedPoints: player.currentProjection.seasonProjectedPoints,
    restOfSeasonProjectedPoints: player.currentProjection.restOfSeasonProjectedPoints,
    projectionFloor: player.currentProjection.floor,
    projectionCeiling: player.currentProjection.ceiling,
    scoringFormat: player.currentProjection.scoringFormat,
    projectionSource: player.currentProjection.source,
    projectionUpdatedAtIso: player.currentProjection.updatedAt,
    projectionFreshness: player.dataFreshness.projections,
    fantasyRank: player.rank,
    positionalRank: player.positionalRank,
    adp: player.adp,
    adpSource: augment?.adpSource ?? null,
    aiAdp: augment?.aiAdp ?? null,
    aiAdpSampleSize: augment?.aiAdpSampleSize ?? null,
    injuryStatus: player.injury.designation,
    practiceStatus: player.injury.practiceStatus,
    gameStatus: player.injury.gameStatus,
    injurySource: player.injury.source,
    injuryUpdatedAtIso: player.injury.updatedAt,
    injuryFreshness: player.injury.freshness,
    latestNews: player.news.summary,
    newsTimestamp: player.news.updatedAt,
    newsSource: player.news.source,
    newsFreshness: player.news.freshness,
    trendLabel: augment?.trendLabel ?? null,
    providerFreshness: {
      status: player.dataFreshness.staleWarnings.length ? 'stale' : 'available',
      updatedAtIso: player.lastUpdatedAt,
      stale: player.dataFreshness.staleWarnings.length > 0,
      warnings: player.dataFreshness.staleWarnings,
    },
    providerFallback: {
      fallback: player.fallbacks.length > 0,
      fields: player.fallbacks.map((fallback) => fallback.field),
      labels: player.fallbacks.map((fallback) => `${fallback.field}: ${fallback.reason}`),
    },
  })
}

export function normalizeNflRedraftProviderPlayerIntelligence(
  providerId: NflRedraftProviderId,
  payload: unknown,
  options?: NormalizeNflRedraftProviderIntelligenceOptions,
): NflRedraftPlayerIntelligence {
  const source = asRecord(payload)
  const maxAgeMinutes = options?.maxAgeMinutes ?? PROVIDER_INTELLIGENCE_MAX_AGE_MINUTES[providerId]
  const updatedAtIso =
    options?.sourceUpdatedAtIso ??
    firstIso(source, [
      'updatedAt',
      'Updated',
      'lastUpdated',
      'LastUpdated',
      'fetchedAt',
      'timestamp',
      'Timestamp',
      'news.updatedAt',
      'news.publishedAt',
    ]) ??
    options?.lastSuccessfulSyncAtIso ??
    options?.fetchedAtIso ??
    null
  const freshness = buildNflRedraftProviderFreshness({
    updatedAtIso,
    maxAgeMinutes,
    now: options?.now,
  })
  const state = dataStateFromFreshness(freshness)
  const weeklyProjection = firstNumber(source, [
    'projectedFantasyPoints',
    'ProjectedFantasyPoints',
    'fantasyPoints',
    'FantasyPoints',
    'projectedPoints',
    'ProjectedPoints',
    'weeklyProjectedPoints',
    'projectedPointsPerGame',
    'PlayerGameProjection.FantasyPoints',
  ])
  const floor = firstNumber(source, ['projectionFloor', 'floor', 'Floor', 'low', 'Low'])
  const ceiling = firstNumber(source, ['projectionCeiling', 'ceiling', 'Ceiling', 'high', 'High'])
  const injuryStatus = firstString(source, ['injuryStatus', 'InjuryStatus', 'status', 'Status', 'injury.designation'])
  const latestNews = firstString(source, ['latestNews', 'newsSummary', 'headline', 'Headline', 'news.headline', 'news.summary'])

  return buildNflRedraftPlayerIntelligence({
    projectedFantasyPoints: weeklyProjection,
    seasonProjectedPoints: firstNumber(source, ['seasonProjectedPoints', 'SeasonProjectedPoints', 'projectedSeasonPoints']),
    restOfSeasonProjectedPoints: firstNumber(source, ['restOfSeasonProjectedPoints', 'rosProjection', 'remainingProjectedPoints']),
    projectionFloor: floor,
    projectionCeiling: ceiling,
    scoringFormat: firstString(source, ['scoringFormat', 'ScoringFormat']),
    projectionSource: weeklyProjection == null ? null : providerId,
    projectionUpdatedAtIso: updatedAtIso,
    projectionFreshness: weeklyProjection == null ? 'missing' : state,
    fantasyRank: firstInteger(source, ['fantasyRank', 'rank', 'Rank', 'overallRank']),
    positionalRank: firstInteger(source, ['positionalRank', 'positionRank', 'PositionRank', 'posRank']),
    adp: firstNumber(source, ['adp', 'ADP', 'averageDraftPosition', 'AverageDraftPosition']),
    adpSource: firstNumber(source, ['adp', 'ADP', 'averageDraftPosition', 'AverageDraftPosition']) == null ? null : providerId,
    injuryStatus,
    practiceStatus: firstString(source, ['practiceStatus', 'PracticeStatus', 'practice']),
    gameStatus: firstString(source, ['gameStatus', 'GameStatus', 'game_status']),
    injurySource: injuryStatus ? providerId : null,
    injuryUpdatedAtIso: firstIso(source, ['injuryUpdatedAt', 'InjuryUpdatedAt']) ?? updatedAtIso,
    injuryFreshness: injuryStatus ? state : 'missing',
    latestNews,
    newsTimestamp: firstIso(source, ['newsTimestamp', 'newsUpdatedAt', 'publishedAt', 'PublishedAt', 'news.publishedAt']) ?? (latestNews ? updatedAtIso : null),
    newsSource: latestNews ? providerId : null,
    newsFreshness: latestNews ? state : 'missing',
    trendLabel: firstString(source, ['trendLabel', 'playerTrendLabel', 'trend', 'trendingDirection']),
    providerFreshness: {
      status: state,
      updatedAtIso: freshness.updatedAtIso,
      ageMinutes: freshness.ageMinutes,
      maxAgeMinutes: freshness.maxAgeMinutes,
      stale: state === 'stale',
      warnings: state === 'stale' ? ['Provider player intelligence data is stale.'] : [],
    },
    providerFallback: {
      fallback: options?.fallback === true,
      fields: options?.fallback ? ['providerIntelligence'] : [],
      labels: options?.fallback ? ['Using fallback player intelligence source.'] : [],
    },
  })
}

export function toCanonicalNflRedraftPlayerIntelligenceRecord(input: {
  providerId: NflRedraftProviderId
  providerRecordId: string
  payload: unknown
  fetchedAtIso?: string | null
  sourceUpdatedAtIso?: string | null
  lastSuccessfulSyncAtIso?: string | null
  fallback?: boolean
  maxAgeMinutes?: number
  now?: Date
}): CanonicalNflRedraftProviderRecord<NflRedraftPlayerIntelligence> {
  const data = normalizeNflRedraftProviderPlayerIntelligence(input.providerId, input.payload, {
    now: input.now,
    fetchedAtIso: input.fetchedAtIso,
    sourceUpdatedAtIso: input.sourceUpdatedAtIso,
    lastSuccessfulSyncAtIso: input.lastSuccessfulSyncAtIso,
    fallback: input.fallback,
    maxAgeMinutes: input.maxAgeMinutes,
  })
  return toCanonicalNflRedraftProviderRecord({
    providerId: input.providerId,
    providerRecordId: input.providerRecordId,
    data,
    fetchedAtIso: input.fetchedAtIso,
    sourceUpdatedAtIso: input.sourceUpdatedAtIso ?? data.providerFreshness.updatedAtIso,
    maxAgeMinutes: input.maxAgeMinutes ?? PROVIDER_INTELLIGENCE_MAX_AGE_MINUTES[input.providerId],
    fallback: input.fallback,
    warnings: data.providerFreshness.warnings,
    now: input.now,
  })
}

export function buildNflRedraftPlayerIntelligenceFromWire(
  row: UnifiedPlayerWireDto,
): NflRedraftPlayerIntelligence | null {
  if (row.nflRedraftPlayerIntelligence) return row.nflRedraftPlayerIntelligence
  if (row.nflRedraft) return buildNflRedraftPlayerIntelligenceFromCanonicalPlayer(row.nflRedraft)
  if (String(row.sport).toUpperCase() !== 'NFL') return null
  const source = asRecord(row.product?.unified)
  const projections = row.normalizedProjections ?? {}
  const stats = row.normalizedStats ?? {}
  const merged = { ...stats, ...projections, ...source }
  return buildNflRedraftPlayerIntelligence({
    projectedFantasyPoints: row.projectedPoints,
    seasonProjectedPoints: firstNumber(merged, ['seasonProjectedPoints', 'seasonProjection', 'projectedSeasonPoints']),
    restOfSeasonProjectedPoints: firstNumber(merged, ['restOfSeasonProjectedPoints', 'rosProjection']),
    projectionFloor: firstNumber(merged, ['floor', 'floorProjection']),
    projectionCeiling: firstNumber(merged, ['ceiling', 'ceilingProjection']),
    scoringFormat: firstString(merged, ['scoringFormat', 'scoring']),
    projectionSource: row.projectedPoints == null ? null : row.projectionsSource,
    projectionUpdatedAtIso: firstIso(merged, ['projectionUpdatedAt', 'updatedAt', 'fetchedAt']),
    fantasyRank: firstInteger(merged, ['rank', 'overallRank']),
    positionalRank: firstInteger(merged, ['positionalRank', 'positionRank', 'posRank']),
    adp: row.adp,
    adpSource: row.adp == null ? null : firstString(source, ['adpSource']) ?? row.profileSource,
    aiAdp: row.aiAdp,
    aiAdpSampleSize: row.aiAdpSampleSize,
    injuryStatus: row.injuryStatus,
    practiceStatus: firstString(merged, ['practiceStatus']),
    gameStatus: firstString(merged, ['gameStatus']),
    injurySource: row.injuryStatus ? row.profileSource ?? row.statsSource : null,
    injuryUpdatedAtIso: firstIso(merged, ['injuryUpdatedAt', 'updatedAt', 'fetchedAt']),
    latestNews: firstString(merged, ['latestNews', 'newsSummary', 'headline', 'news']),
    newsTimestamp: firstIso(merged, ['newsUpdatedAt', 'publishedAt', 'timestamp', 'updatedAt']),
    newsSource: firstString(merged, ['newsSource', 'source', 'provider']) ?? row.profileSource,
    trendLabel: firstString(merged, ['trendLabel', 'playerTrendLabel', 'trend', 'trendingDirection']),
    providerFreshness: {
      status: row.lowConfidence ? 'unknown' : 'available',
      updatedAtIso: firstIso(merged, ['updatedAt', 'fetchedAt']),
      warnings: row.lowConfidence ? ['Limited confidence player intelligence.'] : [],
    },
    providerFallback: {
      fallback: row.lowConfidence,
      fields: row.lowConfidence ? ['playerIntelligence'] : [],
      labels: row.lowConfidence ? ['Limited confidence player intelligence.'] : [],
    },
  })
}
