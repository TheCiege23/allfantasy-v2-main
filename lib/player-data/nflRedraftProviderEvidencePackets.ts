import type {
  NflRedraftProviderDomain,
  NflRedraftProviderError,
  NflRedraftProviderId,
  NflRedraftProviderRateLimitPolicy,
} from '@/lib/nfl-provider/nflRedraftProviderFoundation'
import type { NflRedraftCanonicalPlayerIdentity } from '@/lib/nfl-provider/nflRedraftPlayerIdentity'
import type { NflRedraftCanonicalPlayer, NflRedraftDataState } from '@/lib/player-data/nflRedraftCanonicalPlayer'
import type {
  NflRedraftPlayerDisplayMetadata,
  NflRedraftProviderFallbackMetadata,
  NflRedraftProviderFreshnessMetadata,
} from '@/lib/player-data/nflRedraftPlayerMetadata'
import type {
  NflRedraftInjuryIntelligence,
  NflRedraftNewsIntelligence,
  NflRedraftPlayerIntelligence,
  NflRedraftProjectionIntelligence,
  NflRedraftRankingIntelligence,
} from '@/lib/player-data/nflRedraftPlayerIntelligence'
import type { NflRedraftGameContext, NflRedraftWeatherContext } from '@/lib/player-data/nflRedraftGameContext'
import type {
  NflRedraftLiveScoringContext,
  NflRedraftStatCorrectionRecord,
} from '@/lib/player-data/nflRedraftLiveScoringContext'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import { buildNflRedraftPlayerMetadataFromWire } from '@/lib/player-data/nflRedraftPlayerMetadata'
import { buildNflRedraftPlayerIntelligenceFromWire } from '@/lib/player-data/nflRedraftPlayerIntelligence'
import { buildNflRedraftGameContextFromWire } from '@/lib/player-data/nflRedraftGameContext'
import { buildNflRedraftLiveScoringContextFromWire } from '@/lib/player-data/nflRedraftLiveScoringContext'

export const NFL_REDRAFT_PROVIDER_EVIDENCE_PACKET_MODEL_VERSION = 'nfl-redraft-provider-evidence-packet-v1' as const

export type NflRedraftEvidenceType =
  | 'player_identity'
  | 'player_metadata_media'
  | 'projection'
  | 'injury'
  | 'news'
  | 'ranking_adp'
  | 'schedule_game_context'
  | 'weather'
  | 'live_stats'
  | 'fantasy_scoring'
  | 'stat_correction'
  | 'roster_context'
  | 'matchup_context'
  | 'waiver_context'
  | 'trade_context'
  | 'draft_context'

export type NflRedraftEvidenceSurface =
  | 'draft'
  | 'mock_draft'
  | 'roster'
  | 'waiver'
  | 'trade'
  | 'matchup'
  | 'team'
  | 'player_card'
  | 'live_scoring'
  | 'standings'
  | 'audit'
  | 'debug'

export type NflRedraftEvidenceConfidence = 'high' | 'medium' | 'low' | 'unknown'

export type NflRedraftEvidenceErrorMetadata = {
  code: NflRedraftProviderError['code'] | string
  retryable: boolean
  message: string
  retryAfterMs: number | null
}

export type NflRedraftEvidenceRateLimitMetadata = {
  maxRequestsPerMinute: number
  burst: number
  retryBackoffMs: number
}

export type NflRedraftProviderEvidencePacket = {
  modelVersion: typeof NFL_REDRAFT_PROVIDER_EVIDENCE_PACKET_MODEL_VERSION
  evidenceId: string
  evidenceType: NflRedraftEvidenceType
  canonicalLeagueId: string | null
  canonicalTeamId: string | null
  canonicalPlayerId: string | null
  canonicalGameId: string | null
  canonicalMatchupId: string | null
  sourceProvider: NflRedraftProviderId | 'allfantasy' | 'unknown'
  providerCapabilityDomain: NflRedraftProviderDomain
  sourceTimestampIso: string | null
  ingestedTimestampIso: string
  freshnessStatus: NflRedraftDataState
  stale: boolean
  missing: boolean
  fallback: boolean
  confidenceLevel: NflRedraftEvidenceConfidence
  affectedSurfaces: NflRedraftEvidenceSurface[]
  canonicalFieldNamesIncluded: string[]
  facts: Record<string, unknown>
  errorMetadata: NflRedraftEvidenceErrorMetadata | null
  retryRateLimitMetadata: NflRedraftEvidenceRateLimitMetadata | null
  internalDebugReference: {
    providerArchiveKey: string
  } | null
}

type PacketContext = {
  leagueId?: string | null
  teamId?: string | null
  playerId?: string | null
  gameId?: string | null
  matchupId?: string | null
  sourceProvider?: NflRedraftProviderId | 'allfantasy' | 'unknown' | string | null
  providerDomain: NflRedraftProviderDomain
  sourceTimestampIso?: string | null
  ingestedAtIso?: string | null
  freshness?: Partial<NflRedraftProviderFreshnessMetadata> | null
  fallback?: Partial<NflRedraftProviderFallbackMetadata> | null
  affectedSurfaces?: NflRedraftEvidenceSurface[]
  canonicalFieldNamesIncluded: string[]
  facts: Record<string, unknown>
  error?: NflRedraftProviderError | null
  rateLimit?: NflRedraftProviderRateLimitPolicy | null
  internalDebugReference?: { providerArchiveKey?: string | null } | null
}

type BuildSpecificPacketOptions = {
  leagueId?: string | null
  teamId?: string | null
  playerId?: string | null
  gameId?: string | null
  matchupId?: string | null
  sourceProvider?: NflRedraftProviderId | 'allfantasy' | 'unknown' | string | null
  ingestedAtIso?: string | null
  affectedSurfaces?: NflRedraftEvidenceSurface[]
  error?: NflRedraftProviderError | null
  rateLimit?: NflRedraftProviderRateLimitPolicy | null
  internalDebugReference?: { providerArchiveKey?: string | null } | null
}

export type BuildSurfaceEvidencePacketOptions = BuildSpecificPacketOptions & {
  evidenceType: Extract<
    NflRedraftEvidenceType,
    'roster_context' | 'matchup_context' | 'waiver_context' | 'trade_context' | 'draft_context'
  >
  providerDomain?: NflRedraftProviderDomain
  canonicalFieldNamesIncluded?: string[]
  facts: Record<string, unknown>
  freshness?: Partial<NflRedraftProviderFreshnessMetadata> | null
  fallback?: Partial<NflRedraftProviderFallbackMetadata> | null
}

const DOMAIN_BY_TYPE: Record<NflRedraftEvidenceType, NflRedraftProviderDomain> = {
  player_identity: 'player_metadata',
  player_metadata_media: 'headshot',
  projection: 'projection',
  injury: 'injury',
  news: 'news',
  ranking_adp: 'mock_draft',
  schedule_game_context: 'schedule',
  weather: 'weather',
  live_stats: 'live_score',
  fantasy_scoring: 'live_score',
  stat_correction: 'live_score',
  roster_context: 'player_metadata',
  matchup_context: 'live_score',
  waiver_context: 'player_metadata',
  trade_context: 'player_metadata',
  draft_context: 'mock_draft',
}

const SURFACES_BY_TYPE: Record<NflRedraftEvidenceType, NflRedraftEvidenceSurface[]> = {
  player_identity: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  player_metadata_media: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  projection: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  injury: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  news: ['draft', 'waiver', 'trade', 'team', 'player_card'],
  ranking_adp: ['draft', 'mock_draft', 'waiver', 'trade', 'player_card'],
  schedule_game_context: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  weather: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  live_stats: ['roster', 'matchup', 'team', 'player_card', 'live_scoring'],
  fantasy_scoring: ['matchup', 'team', 'player_card', 'live_scoring', 'standings'],
  stat_correction: ['matchup', 'live_scoring', 'standings', 'audit'],
  roster_context: ['roster', 'team', 'player_card'],
  matchup_context: ['matchup', 'team', 'player_card'],
  waiver_context: ['waiver', 'player_card'],
  trade_context: ['trade', 'player_card'],
  draft_context: ['draft', 'mock_draft', 'player_card'],
}

const PROVIDER_IDS = new Set<NflRedraftProviderId>([
  'api_sports',
  'clearsports',
  'deterministic',
  'espn',
  'fantasycalc',
  'openweather',
  'rolling_insights',
  'sleeper',
  'sportsdataio',
  'thesportsdb',
])

function cleanString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function cleanProvider(value: unknown): NflRedraftProviderId | 'allfantasy' | 'unknown' {
  const text = cleanString(value)?.toLowerCase() ?? null
  if (!text) return 'unknown'
  if (text === 'allfantasy' || text === 'af') return 'allfantasy'
  if (text === 'sportsdata' || text === 'sports_data_io' || text === 'sports-data-io') return 'sportsdataio'
  if (text === 'api-sports' || text === 'apisports') return 'api_sports'
  if (text === 'clear_sports' || text === 'clear-sports') return 'clearsports'
  if (text === 'rollinginsights' || text === 'rolling-insights') return 'rolling_insights'
  if (text === 'the_sports_db' || text === 'sportsdb' || text === 'the-sports-db') return 'thesportsdb'
  if (PROVIDER_IDS.has(text as NflRedraftProviderId)) return text as NflRedraftProviderId
  return 'unknown'
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => cleanString(value)).filter((value): value is string => Boolean(value))))
}

function uniqueSurfaces(values: Array<NflRedraftEvidenceSurface | null | undefined>): NflRedraftEvidenceSurface[] {
  return Array.from(new Set(values.filter((value): value is NflRedraftEvidenceSurface => Boolean(value))))
}

function slugPart(raw: unknown): string {
  return String(raw ?? 'none')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'none'
}

function deterministicEvidenceId(input: {
  evidenceType: NflRedraftEvidenceType
  leagueId: string | null
  teamId: string | null
  playerId: string | null
  gameId: string | null
  matchupId: string | null
  sourceProvider: string
  fields: string[]
}): string {
  const fieldKey = input.fields.slice().sort().map(slugPart).join('-') || 'fields-none'
  return [
    'af',
    'nfl-redraft',
    'evidence',
    input.evidenceType,
    input.leagueId ?? 'league-none',
    input.teamId ?? 'team-none',
    input.playerId ?? 'player-none',
    input.gameId ?? 'game-none',
    input.matchupId ?? 'matchup-none',
    input.sourceProvider,
    fieldKey,
  ].map(slugPart).join(':')
}

function freshnessStatus(freshness: Partial<NflRedraftProviderFreshnessMetadata> | null | undefined): NflRedraftDataState {
  const status = freshness?.status ?? 'unknown'
  return status === 'available' || status === 'missing' || status === 'stale' || status === 'unknown'
    ? status
    : 'unknown'
}

function fallbackStatus(fallback: Partial<NflRedraftProviderFallbackMetadata> | null | undefined): boolean {
  return fallback?.fallback === true || Boolean(fallback?.fields?.length)
}

function confidence(input: {
  freshnessStatus: NflRedraftDataState
  stale: boolean
  missing: boolean
  fallback: boolean
  error: NflRedraftProviderError | null | undefined
}): NflRedraftEvidenceConfidence {
  if (input.error) return input.error.retryable ? 'low' : 'unknown'
  if (input.missing) return 'unknown'
  if (input.fallback || input.stale || input.freshnessStatus === 'unknown') return 'low'
  if (input.freshnessStatus === 'available') return 'high'
  return 'medium'
}

function sanitizeFacts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeFacts)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase()
    if (
      lower.includes('payload') ||
      lower.includes('secret') ||
      lower.includes('apikey') ||
      lower.includes('api_key') ||
      lower.includes('token') ||
      lower.includes('password')
    ) {
      continue
    }
    out[key] = sanitizeFacts(entry)
  }
  return out
}

function buildPacket(
  evidenceType: NflRedraftEvidenceType,
  context: PacketContext,
): NflRedraftProviderEvidencePacket {
  const fields = uniqueStrings(context.canonicalFieldNamesIncluded)
  const freshness = freshnessStatus(context.freshness)
  const stale = context.freshness?.stale === true || freshness === 'stale'
  const fallback = fallbackStatus(context.fallback)
  const missing = freshness === 'missing' || fields.length === 0 || fallbackStatus({
    fallback: false,
    fields: context.fallback?.fields?.filter((field) => field.toLowerCase().includes('missing')) ?? [],
  })
  const sourceProvider = cleanProvider(context.sourceProvider)
  const packet: NflRedraftProviderEvidencePacket = {
    modelVersion: NFL_REDRAFT_PROVIDER_EVIDENCE_PACKET_MODEL_VERSION,
    evidenceId: deterministicEvidenceId({
      evidenceType,
      leagueId: context.leagueId ?? null,
      teamId: context.teamId ?? null,
      playerId: context.playerId ?? null,
      gameId: context.gameId ?? null,
      matchupId: context.matchupId ?? null,
      sourceProvider,
      fields,
    }),
    evidenceType,
    canonicalLeagueId: context.leagueId ?? null,
    canonicalTeamId: context.teamId ?? null,
    canonicalPlayerId: context.playerId ?? null,
    canonicalGameId: context.gameId ?? null,
    canonicalMatchupId: context.matchupId ?? null,
    sourceProvider,
    providerCapabilityDomain: context.providerDomain,
    sourceTimestampIso: context.sourceTimestampIso ?? context.freshness?.updatedAtIso ?? null,
    ingestedTimestampIso: context.ingestedAtIso ?? new Date(0).toISOString(),
    freshnessStatus: freshness,
    stale,
    missing,
    fallback,
    confidenceLevel: confidence({ freshnessStatus: freshness, stale, missing, fallback, error: context.error }),
    affectedSurfaces: uniqueSurfaces([...(context.affectedSurfaces ?? []), ...SURFACES_BY_TYPE[evidenceType]]),
    canonicalFieldNamesIncluded: fields,
    facts: sanitizeFacts(context.facts) as Record<string, unknown>,
    errorMetadata: context.error
      ? {
          code: context.error.code,
          retryable: context.error.retryable,
          message: context.error.message,
          retryAfterMs: context.error.retryAfterMs,
        }
      : null,
    retryRateLimitMetadata: context.rateLimit
      ? {
          maxRequestsPerMinute: context.rateLimit.maxRequestsPerMinute,
          burst: context.rateLimit.burst,
          retryBackoffMs: context.rateLimit.retryBackoffMs,
        }
      : null,
    internalDebugReference: context.internalDebugReference?.providerArchiveKey
      ? { providerArchiveKey: context.internalDebugReference.providerArchiveKey }
      : null,
  }
  return packet
}

function freshnessFromState(status: NflRedraftDataState, updatedAtIso?: string | null): NflRedraftProviderFreshnessMetadata {
  return {
    status,
    updatedAtIso: updatedAtIso ?? null,
    ageMinutes: null,
    maxAgeMinutes: null,
    stale: status === 'stale',
    warnings: status === 'stale' ? ['Canonical evidence source is stale.'] : [],
  }
}

function fallbackFromFields(fields: string[]): NflRedraftProviderFallbackMetadata {
  return {
    fallback: fields.length > 0,
    fields,
    labels: fields,
  }
}

export function buildPlayerIdentityEvidencePacket(
  identity: NflRedraftCanonicalPlayerIdentity,
  options: BuildSpecificPacketOptions = {},
): NflRedraftProviderEvidencePacket {
  return buildPacket('player_identity', {
    ...options,
    playerId: options.playerId ?? identity.allFantasyPlayerId,
    teamId: options.teamId ?? identity.team,
    sourceProvider: options.sourceProvider ?? identity.sourceProviderId,
    providerDomain: 'player_metadata',
    sourceTimestampIso: identity.cache.providerTimestampIso,
    freshness: {
      status: identity.cache.freshness.status === 'fresh' ? 'available' : identity.cache.freshness.status,
      updatedAtIso: identity.cache.freshness.updatedAtIso,
      ageMinutes: identity.cache.freshness.ageMinutes,
      maxAgeMinutes: identity.cache.freshness.maxAgeMinutes,
      stale: identity.cache.stale,
      warnings: identity.cache.warnings,
    },
    fallback: fallbackFromFields(identity.cache.fallback ? ['playerIdentity'] : []),
    canonicalFieldNamesIncluded: [
      'allFantasyPlayerId',
      'playerName',
      'preferredDisplayName',
      'team',
      'position',
      'fantasyPositions',
      'activeStatus',
    ],
    facts: {
      allFantasyPlayerId: identity.allFantasyPlayerId,
      playerName: identity.playerName,
      preferredDisplayName: identity.preferredDisplayName,
      team: identity.team,
      position: identity.position,
      fantasyPositions: identity.fantasyPositions,
      jerseyNumber: identity.jerseyNumber,
      byeWeek: identity.byeWeek,
      activeStatus: identity.activeStatus,
    },
  })
}

export function buildPlayerMetadataMediaEvidencePacket(
  metadata: NflRedraftPlayerDisplayMetadata,
  options: BuildSpecificPacketOptions = {},
): NflRedraftProviderEvidencePacket {
  return buildPacket('player_metadata_media', {
    ...options,
    sourceProvider: options.sourceProvider ?? 'allfantasy',
    providerDomain: 'headshot',
    freshness: metadata.providerFreshness,
    fallback: metadata.providerFallback,
    canonicalFieldNamesIncluded: [
      'displayName',
      'teamAbbr',
      'position',
      'fantasyPositions',
      'headshot',
      'teamLogo',
      'byeWeek',
      'activeStatus',
    ],
    facts: {
      displayName: metadata.displayName,
      teamAbbr: metadata.teamAbbr,
      position: metadata.position,
      fantasyPositions: metadata.fantasyPositions,
      jerseyNumber: metadata.jerseyNumber,
      headshot: metadata.headshot,
      teamLogo: metadata.teamLogo,
      byeWeek: metadata.byeWeek,
      activeStatus: metadata.activeStatus,
    },
  })
}

export function buildProjectionEvidencePacket(
  projection: NflRedraftProjectionIntelligence,
  options: BuildSpecificPacketOptions = {},
): NflRedraftProviderEvidencePacket {
  return buildPacket('projection', {
    ...options,
    sourceProvider: options.sourceProvider ?? projection.source,
    providerDomain: 'projection',
    sourceTimestampIso: projection.updatedAtIso,
    freshness: freshnessFromState(projection.freshness, projection.updatedAtIso),
    fallback: fallbackFromFields(projection.unavailable ? ['projection'] : []),
    canonicalFieldNamesIncluded: [
      'projectedFantasyPoints',
      'seasonProjectedPoints',
      'restOfSeasonProjectedPoints',
      'projectionRange',
      'scoringFormat',
    ],
    facts: {
      projectedFantasyPoints: projection.projectedFantasyPoints,
      seasonProjectedPoints: projection.seasonProjectedPoints,
      restOfSeasonProjectedPoints: projection.restOfSeasonProjectedPoints,
      projectionRange: projection.projectionRange,
      scoringFormat: projection.scoringFormat,
      unavailable: projection.unavailable,
    },
  })
}

export function buildInjuryEvidencePacket(
  injury: NflRedraftInjuryIntelligence,
  options: BuildSpecificPacketOptions = {},
): NflRedraftProviderEvidencePacket {
  return buildPacket('injury', {
    ...options,
    sourceProvider: options.sourceProvider ?? injury.source,
    providerDomain: 'injury',
    sourceTimestampIso: injury.updatedAtIso,
    freshness: freshnessFromState(injury.freshness, injury.updatedAtIso),
    fallback: fallbackFromFields(injury.injuryStatus ? [] : ['injuryStatus']),
    canonicalFieldNamesIncluded: ['injuryStatus', 'practiceStatus', 'gameStatus'],
    facts: {
      injuryStatus: injury.injuryStatus,
      practiceStatus: injury.practiceStatus,
      gameStatus: injury.gameStatus,
    },
  })
}

export function buildNewsEvidencePacket(
  news: NflRedraftNewsIntelligence,
  options: BuildSpecificPacketOptions = {},
): NflRedraftProviderEvidencePacket {
  return buildPacket('news', {
    ...options,
    sourceProvider: options.sourceProvider ?? news.source,
    providerDomain: 'news',
    sourceTimestampIso: news.newsTimestamp,
    freshness: freshnessFromState(news.freshness, news.newsTimestamp),
    fallback: fallbackFromFields(news.latestNews ? [] : ['news']),
    canonicalFieldNamesIncluded: ['latestNews', 'newsTimestamp'],
    facts: {
      latestNews: news.latestNews,
      newsTimestamp: news.newsTimestamp,
    },
  })
}

export function buildRankingAdpEvidencePacket(
  ranking: NflRedraftRankingIntelligence,
  options: BuildSpecificPacketOptions = {},
): NflRedraftProviderEvidencePacket {
  const missing = [ranking.fantasyRank == null && ranking.positionalRank == null ? 'ranking' : null, ranking.adp == null ? 'adp' : null]
    .filter((field): field is string => Boolean(field))
  return buildPacket('ranking_adp', {
    ...options,
    sourceProvider: options.sourceProvider ?? ranking.adpSource ?? 'allfantasy',
    providerDomain: 'mock_draft',
    freshness: freshnessFromState(missing.length ? 'missing' : 'available'),
    fallback: fallbackFromFields(missing),
    canonicalFieldNamesIncluded: ['fantasyRank', 'positionalRank', 'adp', 'aiAdp', 'aiAdpSampleSize'],
    facts: {
      fantasyRank: ranking.fantasyRank,
      positionalRank: ranking.positionalRank,
      adp: ranking.adp,
      aiAdp: ranking.aiAdp,
      aiAdpSampleSize: ranking.aiAdpSampleSize,
    },
  })
}

export function buildScheduleGameEvidencePacket(
  gameContext: NflRedraftGameContext,
  options: BuildSpecificPacketOptions = {},
): NflRedraftProviderEvidencePacket {
  return buildPacket('schedule_game_context', {
    ...options,
    sourceProvider: options.sourceProvider ?? 'allfantasy',
    providerDomain: 'schedule',
    sourceTimestampIso: gameContext.providerFreshness.updatedAtIso,
    freshness: gameContext.providerFreshness,
    fallback: gameContext.providerFallback,
    canonicalFieldNamesIncluded: [
      'season',
      'week',
      'opponent',
      'homeAway',
      'kickoffTimeIso',
      'gameDateIso',
      'stadium',
      'byeWeek',
      'gameStatus',
    ],
    facts: {
      season: gameContext.season,
      week: gameContext.week,
      opponent: gameContext.opponent,
      homeAway: gameContext.homeAway,
      kickoffTimeIso: gameContext.kickoffTimeIso,
      gameDateIso: gameContext.gameDateIso,
      stadium: gameContext.stadium,
      byeWeek: gameContext.byeWeek,
      isByeWeek: gameContext.isByeWeek,
      gameStatus: gameContext.gameStatus,
    },
  })
}

export function buildWeatherEvidencePacket(
  gameContext: NflRedraftGameContext,
  options: BuildSpecificPacketOptions = {},
): NflRedraftProviderEvidencePacket {
  const weather: NflRedraftWeatherContext = gameContext.weather
  return buildPacket('weather', {
    ...options,
    sourceProvider: options.sourceProvider ?? weather.source,
    providerDomain: 'weather',
    sourceTimestampIso: weather.updatedAtIso,
    freshness: gameContext.weatherFreshness,
    fallback: fallbackFromFields(weather.unavailable ? ['weather'] : []),
    canonicalFieldNamesIncluded: [
      'weather.condition',
      'weather.temperatureF',
      'weather.windSpeedMph',
      'weather.precipitationType',
      'weather.precipitationChancePercent',
    ],
    facts: {
      weather,
      stadium: gameContext.stadium,
      kickoffTimeIso: gameContext.kickoffTimeIso,
    },
  })
}

export function buildLiveStatsEvidencePacket(
  live: NflRedraftLiveScoringContext,
  options: BuildSpecificPacketOptions = {},
): NflRedraftProviderEvidencePacket {
  return buildPacket('live_stats', {
    ...options,
    playerId: options.playerId ?? live.playerId,
    gameId: options.gameId ?? live.gameId,
    sourceProvider: options.sourceProvider ?? live.stats.source,
    providerDomain: 'live_score',
    sourceTimestampIso: live.stats.updatedAtIso,
    freshness: live.providerFreshness,
    fallback: live.providerFallback,
    canonicalFieldNamesIncluded: ['gameStatus', 'gameClock', 'stats', 'final'],
    facts: {
      gameStatus: live.gameStatus,
      gameClock: live.gameClock,
      final: live.final,
      stats: live.stats.stats,
      statsFreshness: live.stats.freshness,
      statsUnavailable: live.stats.unavailable,
    },
  })
}

export function buildFantasyScoringEvidencePacket(
  live: NflRedraftLiveScoringContext,
  options: BuildSpecificPacketOptions = {},
): NflRedraftProviderEvidencePacket {
  return buildPacket('fantasy_scoring', {
    ...options,
    playerId: options.playerId ?? live.playerId,
    gameId: options.gameId ?? live.gameId,
    sourceProvider: options.sourceProvider ?? live.stats.source,
    providerDomain: 'live_score',
    sourceTimestampIso: live.refresh.scoringRefreshTimestamp ?? live.stats.updatedAtIso,
    freshness: live.providerFreshness,
    fallback: live.providerFallback,
    canonicalFieldNamesIncluded: [
      'fantasyPoints',
      'projectedFantasyPoints',
      'actualFantasyPoints',
      'refresh.scoringRefreshTimestamp',
      'refresh.matchupRefreshTimestamp',
      'refresh.standingsRefreshRequired',
    ],
    facts: {
      fantasyPoints: live.fantasyPoints,
      projectedFantasyPoints: live.projectedFantasyPoints,
      actualFantasyPoints: live.actualFantasyPoints,
      refresh: live.refresh,
    },
  })
}

export function buildStatCorrectionEvidencePacket(
  correction: NflRedraftStatCorrectionRecord,
  options: BuildSpecificPacketOptions = {},
): NflRedraftProviderEvidencePacket {
  return buildPacket('stat_correction', {
    ...options,
    playerId: options.playerId ?? correction.playerId,
    gameId: options.gameId ?? correction.gameId,
    sourceProvider: options.sourceProvider ?? correction.providerSource,
    providerDomain: 'live_score',
    sourceTimestampIso: correction.timestampIso,
    freshness: freshnessFromState(correction.timestampIso ? 'available' : 'missing', correction.timestampIso),
    fallback: fallbackFromFields(correction.applied ? [] : ['statCorrectionApplied']),
    canonicalFieldNamesIncluded: [
      'correctionId',
      'playerId',
      'gameId',
      'statCategory',
      'oldValue',
      'newValue',
      'fantasyPointDelta',
      'applied',
    ],
    facts: {
      correctionId: correction.correctionId,
      playerId: correction.playerId,
      gameId: correction.gameId,
      statCategory: correction.statCategory,
      oldValue: correction.oldValue,
      newValue: correction.newValue,
      fantasyPointDelta: correction.fantasyPointDelta,
      applied: correction.applied,
    },
  })
}

export function buildSurfaceContextEvidencePacket(
  options: BuildSurfaceEvidencePacketOptions,
): NflRedraftProviderEvidencePacket {
  return buildPacket(options.evidenceType, {
    ...options,
    providerDomain: options.providerDomain ?? DOMAIN_BY_TYPE[options.evidenceType],
    sourceProvider: options.sourceProvider ?? 'allfantasy',
    freshness: options.freshness ?? freshnessFromState('available'),
    fallback: options.fallback ?? fallbackFromFields([]),
    canonicalFieldNamesIncluded: options.canonicalFieldNamesIncluded ?? Object.keys(options.facts),
    facts: options.facts,
  })
}

export function buildNflRedraftProviderEvidencePacketsFromCanonical(input: {
  leagueId?: string | null
  teamId?: string | null
  matchupId?: string | null
  identity?: NflRedraftCanonicalPlayerIdentity | null
  canonicalPlayer?: NflRedraftCanonicalPlayer | null
  metadata?: NflRedraftPlayerDisplayMetadata | null
  intelligence?: NflRedraftPlayerIntelligence | null
  gameContext?: NflRedraftGameContext | null
  liveScoringContext?: NflRedraftLiveScoringContext | null
  affectedSurfaces?: NflRedraftEvidenceSurface[]
  ingestedAtIso?: string | null
}): NflRedraftProviderEvidencePacket[] {
  const playerId =
    input.identity?.allFantasyPlayerId ??
    input.canonicalPlayer?.playerId ??
    input.liveScoringContext?.playerId ??
    null
  const common: BuildSpecificPacketOptions = {
    leagueId: input.leagueId,
    teamId: input.teamId ?? input.canonicalPlayer?.teamAbbr ?? input.metadata?.teamAbbr ?? null,
    playerId,
    matchupId: input.matchupId,
    affectedSurfaces: input.affectedSurfaces,
    ingestedAtIso: input.ingestedAtIso,
  }
  const packets: NflRedraftProviderEvidencePacket[] = []
  if (input.identity) packets.push(buildPlayerIdentityEvidencePacket(input.identity, common))
  if (input.metadata) packets.push(buildPlayerMetadataMediaEvidencePacket(input.metadata, common))
  if (input.intelligence) {
    packets.push(
      buildProjectionEvidencePacket(input.intelligence.projection, common),
      buildInjuryEvidencePacket(input.intelligence.injury, common),
      buildNewsEvidencePacket(input.intelligence.news, common),
      buildRankingAdpEvidencePacket(input.intelligence.ranking, common),
    )
  }
  if (input.gameContext) {
    packets.push(
      buildScheduleGameEvidencePacket(input.gameContext, common),
      buildWeatherEvidencePacket(input.gameContext, common),
    )
  }
  if (input.liveScoringContext) {
    const liveCommon = { ...common, gameId: input.liveScoringContext.gameId }
    packets.push(
      buildLiveStatsEvidencePacket(input.liveScoringContext, liveCommon),
      buildFantasyScoringEvidencePacket(input.liveScoringContext, liveCommon),
      ...input.liveScoringContext.statCorrections.map((correction) =>
        buildStatCorrectionEvidencePacket(correction, liveCommon),
      ),
    )
  }
  return packets
}

export function buildNflRedraftProviderEvidencePacketsFromWire(
  row: UnifiedPlayerWireDto,
  options: {
    leagueId?: string | null
    teamId?: string | null
    matchupId?: string | null
    affectedSurfaces?: NflRedraftEvidenceSurface[]
    ingestedAtIso?: string | null
  } = {},
): NflRedraftProviderEvidencePacket[] {
  return buildNflRedraftProviderEvidencePacketsFromCanonical({
    leagueId: options.leagueId,
    teamId: options.teamId ?? row.team,
    matchupId: options.matchupId,
    canonicalPlayer: row.nflRedraft ?? null,
    metadata: buildNflRedraftPlayerMetadataFromWire(row),
    intelligence: buildNflRedraftPlayerIntelligenceFromWire(row),
    gameContext: buildNflRedraftGameContextFromWire(row),
    liveScoringContext: buildNflRedraftLiveScoringContextFromWire(row),
    affectedSurfaces: options.affectedSurfaces,
    ingestedAtIso: options.ingestedAtIso,
  })
}
