import type {
  NflRedraftEvidenceSurface,
  NflRedraftEvidenceType,
  NflRedraftProviderEvidencePacket,
} from '@/lib/player-data/nflRedraftProviderEvidencePackets'
import type { NflRedraftDataState } from '@/lib/player-data/nflRedraftCanonicalPlayer'

export const NFL_REDRAFT_PREMIUM_SERVICE_MODEL_VERSION = 'nfl-redraft-premium-service-v1' as const

export type NflRedraftPremiumTier =
  | 'FREE'
  | 'AF_PRO'
  | 'AF_COMMISSIONER'
  | 'AF_SUPREME'
  | 'AF_WAR_ROOM'

export type NflRedraftPremiumServiceId =
  | 'basic_runtime_facts'
  | 'war_room'
  | 'commissioner_digest'
  | 'manager_brief'
  | 'matchup_prep'
  | 'waiver_report'
  | 'trade_review'
  | 'draft_prep'

export type NflRedraftPremiumServiceVariant = 'basic' | 'commissioner' | 'advanced'

export type NflRedraftPremiumActionCategory =
  | 'identity_context'
  | 'metadata_context'
  | 'projection_context'
  | 'injury_context'
  | 'news_context'
  | 'ranking_adp_context'
  | 'schedule_context'
  | 'weather_context'
  | 'live_stats_context'
  | 'fantasy_scoring_context'
  | 'stat_correction_context'
  | 'roster_context'
  | 'matchup_context'
  | 'waiver_context'
  | 'trade_context'
  | 'draft_context'
  | 'freshness_review'
  | 'fallback_review'
  | 'missing_data_review'

export type NflRedraftPremiumCanonicalContext = {
  leagueId?: string | null
  season?: number | null
  week?: number | null
  playerIds?: string[]
  teamIds?: string[]
  matchupIds?: string[]
  gameIds?: string[]
  surfaces?: NflRedraftEvidenceSurface[]
}

export type NflRedraftPremiumServiceInput = {
  serviceId: NflRedraftPremiumServiceId
  serviceVariant?: NflRedraftPremiumServiceVariant
  evidencePackets: NflRedraftProviderEvidencePacket[]
  canonicalContext?: NflRedraftPremiumCanonicalContext | null
  requestedTier?: NflRedraftPremiumTier | null
  generatedAtIso?: string | null
}

export type NflRedraftPremiumServiceSummary = {
  modelVersion: typeof NFL_REDRAFT_PREMIUM_SERVICE_MODEL_VERSION
  serviceId: NflRedraftPremiumServiceId
  serviceName: string
  serviceVariant: NflRedraftPremiumServiceVariant
  requiredTier: NflRedraftPremiumTier
  requestedTier: NflRedraftPremiumTier | null
  accessAllowed: boolean
  leagueId: string | null
  season: number | null
  week: number | null
  relevantPlayerIds: string[]
  affectedTeamIds: string[]
  affectedMatchupIds: string[]
  affectedGameIds: string[]
  evidencePacketIds: string[]
  includedEvidenceTypes: NflRedraftEvidenceType[]
  providerDomains: string[]
  sourceProviders: string[]
  freshnessStatus: {
    overall: NflRedraftDataState
    counts: Record<NflRedraftDataState, number>
  }
  unavailableDataWarnings: string[]
  staleDataWarnings: string[]
  fallbackStatus: {
    hasFallback: boolean
    packetIds: string[]
  }
  confidenceCounts: Record<NflRedraftProviderEvidencePacket['confidenceLevel'], number>
  surfaceEligibility: NflRedraftEvidenceSurface[]
  actionCategoryLabels: NflRedraftPremiumActionCategory[]
  factsOnly: true
  deterministic: true
  generatedAtIso: string
}

type ServiceDefinition = {
  serviceId: NflRedraftPremiumServiceId
  serviceName: string
  defaultTier: NflRedraftPremiumTier
  packetTypes: NflRedraftEvidenceType[]
  surfaces: NflRedraftEvidenceSurface[]
  actionCategories: NflRedraftPremiumActionCategory[]
}

export const NFL_REDRAFT_PREMIUM_SERVICE_TIER_ORDER: readonly NflRedraftPremiumTier[] = [
  'FREE',
  'AF_PRO',
  'AF_COMMISSIONER',
  'AF_SUPREME',
  'AF_WAR_ROOM',
] as const

export const NFL_REDRAFT_PREMIUM_SERVICE_DEFINITIONS: Record<NflRedraftPremiumServiceId, ServiceDefinition> = {
  basic_runtime_facts: {
    serviceId: 'basic_runtime_facts',
    serviceName: 'Basic Runtime Facts',
    defaultTier: 'FREE',
    packetTypes: [
      'player_identity',
      'player_metadata_media',
      'schedule_game_context',
      'weather',
      'live_stats',
      'fantasy_scoring',
      'roster_context',
      'matchup_context',
    ],
    surfaces: ['roster', 'matchup', 'team', 'player_card'],
    actionCategories: ['identity_context', 'metadata_context', 'schedule_context', 'live_stats_context'],
  },
  war_room: {
    serviceId: 'war_room',
    serviceName: 'AF Legacy Service',
    defaultTier: 'AF_WAR_ROOM',
    packetTypes: [
      'projection',
      'injury',
      'news',
      'schedule_game_context',
      'weather',
      'live_stats',
      'fantasy_scoring',
      'stat_correction',
      'roster_context',
      'matchup_context',
    ],
    surfaces: ['roster', 'matchup', 'team', 'player_card', 'live_scoring', 'standings'],
    actionCategories: [
      'projection_context',
      'injury_context',
      'news_context',
      'schedule_context',
      'weather_context',
      'live_stats_context',
      'fantasy_scoring_context',
      'stat_correction_context',
    ],
  },
  commissioner_digest: {
    serviceId: 'commissioner_digest',
    serviceName: 'Commissioner Digest Service',
    defaultTier: 'AF_COMMISSIONER',
    packetTypes: [
      'roster_context',
      'matchup_context',
      'trade_context',
      'fantasy_scoring',
      'stat_correction',
      'schedule_game_context',
      'weather',
    ],
    surfaces: ['matchup', 'standings', 'audit', 'trade'],
    actionCategories: [
      'roster_context',
      'matchup_context',
      'trade_context',
      'fantasy_scoring_context',
      'stat_correction_context',
      'freshness_review',
    ],
  },
  manager_brief: {
    serviceId: 'manager_brief',
    serviceName: 'Manager Brief Service',
    defaultTier: 'AF_PRO',
    packetTypes: [
      'player_identity',
      'player_metadata_media',
      'projection',
      'injury',
      'news',
      'ranking_adp',
      'schedule_game_context',
      'weather',
      'live_stats',
      'fantasy_scoring',
      'roster_context',
    ],
    surfaces: ['roster', 'team', 'player_card'],
    actionCategories: [
      'identity_context',
      'metadata_context',
      'projection_context',
      'injury_context',
      'news_context',
      'ranking_adp_context',
      'schedule_context',
      'weather_context',
      'live_stats_context',
      'roster_context',
    ],
  },
  matchup_prep: {
    serviceId: 'matchup_prep',
    serviceName: 'Matchup Prep Service',
    defaultTier: 'AF_PRO',
    packetTypes: [
      'projection',
      'injury',
      'schedule_game_context',
      'weather',
      'live_stats',
      'fantasy_scoring',
      'matchup_context',
    ],
    surfaces: ['matchup', 'team', 'player_card', 'live_scoring'],
    actionCategories: [
      'projection_context',
      'injury_context',
      'schedule_context',
      'weather_context',
      'live_stats_context',
      'fantasy_scoring_context',
      'matchup_context',
    ],
  },
  waiver_report: {
    serviceId: 'waiver_report',
    serviceName: 'Waiver Report Service',
    defaultTier: 'AF_PRO',
    packetTypes: [
      'player_identity',
      'player_metadata_media',
      'projection',
      'injury',
      'news',
      'ranking_adp',
      'schedule_game_context',
      'weather',
      'waiver_context',
    ],
    surfaces: ['waiver', 'player_card'],
    actionCategories: [
      'identity_context',
      'metadata_context',
      'projection_context',
      'injury_context',
      'news_context',
      'ranking_adp_context',
      'schedule_context',
      'weather_context',
      'waiver_context',
    ],
  },
  trade_review: {
    serviceId: 'trade_review',
    serviceName: 'Trade Review Service',
    defaultTier: 'AF_PRO',
    packetTypes: [
      'player_identity',
      'player_metadata_media',
      'projection',
      'injury',
      'news',
      'ranking_adp',
      'schedule_game_context',
      'weather',
      'trade_context',
    ],
    surfaces: ['trade', 'player_card'],
    actionCategories: [
      'identity_context',
      'metadata_context',
      'projection_context',
      'injury_context',
      'news_context',
      'ranking_adp_context',
      'schedule_context',
      'weather_context',
      'trade_context',
    ],
  },
  draft_prep: {
    serviceId: 'draft_prep',
    serviceName: 'Draft Prep Service',
    defaultTier: 'AF_PRO',
    packetTypes: [
      'player_identity',
      'player_metadata_media',
      'projection',
      'injury',
      'news',
      'ranking_adp',
      'schedule_game_context',
      'weather',
      'draft_context',
    ],
    surfaces: ['draft', 'mock_draft', 'player_card'],
    actionCategories: [
      'identity_context',
      'metadata_context',
      'projection_context',
      'injury_context',
      'news_context',
      'ranking_adp_context',
      'schedule_context',
      'weather_context',
      'draft_context',
    ],
  },
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)))
}

function uniqueSurfaces(values: Array<NflRedraftEvidenceSurface | null | undefined>): NflRedraftEvidenceSurface[] {
  return Array.from(new Set(values.filter((value): value is NflRedraftEvidenceSurface => Boolean(value))))
}

function uniqueEvidenceTypes(values: Array<NflRedraftEvidenceType | null | undefined>): NflRedraftEvidenceType[] {
  return Array.from(new Set(values.filter((value): value is NflRedraftEvidenceType => Boolean(value))))
}

function uniqueActionCategories(
  values: Array<NflRedraftPremiumActionCategory | null | undefined>,
): NflRedraftPremiumActionCategory[] {
  return Array.from(new Set(values.filter((value): value is NflRedraftPremiumActionCategory => Boolean(value))))
}

export function resolveNflRedraftPremiumServiceRequiredTier(
  serviceId: NflRedraftPremiumServiceId,
  variant: NflRedraftPremiumServiceVariant = 'basic',
): NflRedraftPremiumTier {
  if (serviceId === 'basic_runtime_facts') return 'FREE'
  if (serviceId === 'war_room') return 'AF_WAR_ROOM'
  if (variant === 'advanced') return 'AF_SUPREME'
  if (serviceId === 'trade_review' && variant === 'commissioner') return 'AF_COMMISSIONER'
  return NFL_REDRAFT_PREMIUM_SERVICE_DEFINITIONS[serviceId].defaultTier
}

export function canAccessNflRedraftPremiumService(input: {
  tier: NflRedraftPremiumTier | null | undefined
  serviceId: NflRedraftPremiumServiceId
  variant?: NflRedraftPremiumServiceVariant
}): boolean {
  const tier = input.tier ?? 'FREE'
  const required = resolveNflRedraftPremiumServiceRequiredTier(input.serviceId, input.variant ?? 'basic')
  if (required === 'FREE') return true
  if (required === 'AF_PRO') return tier === 'AF_PRO' || tier === 'AF_SUPREME'
  if (required === 'AF_COMMISSIONER') return tier === 'AF_COMMISSIONER' || tier === 'AF_SUPREME'
  if (required === 'AF_SUPREME') return tier === 'AF_SUPREME'
  if (required === 'AF_WAR_ROOM') return tier === 'AF_WAR_ROOM'
  return false
}

function packetMatchesService(packet: NflRedraftProviderEvidencePacket, definition: ServiceDefinition): boolean {
  return definition.packetTypes.includes(packet.evidenceType)
}

function statusCounts(packets: NflRedraftProviderEvidencePacket[]): Record<NflRedraftDataState, number> {
  return {
    available: packets.filter((packet) => packet.freshnessStatus === 'available').length,
    stale: packets.filter((packet) => packet.freshnessStatus === 'stale').length,
    missing: packets.filter((packet) => packet.freshnessStatus === 'missing').length,
    unknown: packets.filter((packet) => packet.freshnessStatus === 'unknown').length,
  }
}

function confidenceCounts(
  packets: NflRedraftProviderEvidencePacket[],
): Record<NflRedraftProviderEvidencePacket['confidenceLevel'], number> {
  return {
    high: packets.filter((packet) => packet.confidenceLevel === 'high').length,
    medium: packets.filter((packet) => packet.confidenceLevel === 'medium').length,
    low: packets.filter((packet) => packet.confidenceLevel === 'low').length,
    unknown: packets.filter((packet) => packet.confidenceLevel === 'unknown').length,
  }
}

function overallFreshness(counts: Record<NflRedraftDataState, number>): NflRedraftDataState {
  if (counts.missing > 0) return 'missing'
  if (counts.stale > 0) return 'stale'
  if (counts.unknown > 0) return 'unknown'
  return 'available'
}

function serviceActionCategories(
  definition: ServiceDefinition,
  packets: NflRedraftProviderEvidencePacket[],
): NflRedraftPremiumActionCategory[] {
  const labels: NflRedraftPremiumActionCategory[] = [...definition.actionCategories]
  if (packets.some((packet) => packet.stale)) labels.push('freshness_review')
  if (packets.some((packet) => packet.fallback)) labels.push('fallback_review')
  if (packets.some((packet) => packet.missing)) labels.push('missing_data_review')
  return uniqueActionCategories(labels)
}

function packetWarningId(packet: NflRedraftProviderEvidencePacket): string {
  return `${packet.evidenceType}:${packet.evidenceId}`
}

export function buildNflRedraftPremiumServiceSummary(
  input: NflRedraftPremiumServiceInput,
): NflRedraftPremiumServiceSummary {
  const definition = NFL_REDRAFT_PREMIUM_SERVICE_DEFINITIONS[input.serviceId]
  const variant = input.serviceVariant ?? 'basic'
  const requiredTier = resolveNflRedraftPremiumServiceRequiredTier(input.serviceId, variant)
  const requestedTier = input.requestedTier ?? null
  const matchingPackets = input.evidencePackets.filter((packet) => packetMatchesService(packet, definition))
  const canonical = input.canonicalContext ?? null
  const freshnessCounts = statusCounts(matchingPackets)
  const fallbackPacketIds = matchingPackets.filter((packet) => packet.fallback).map((packet) => packet.evidenceId)
  const surfaces = uniqueSurfaces([
    ...(canonical?.surfaces ?? []),
    ...definition.surfaces,
    ...matchingPackets.flatMap((packet) => packet.affectedSurfaces),
  ])

  return {
    modelVersion: NFL_REDRAFT_PREMIUM_SERVICE_MODEL_VERSION,
    serviceId: input.serviceId,
    serviceName: definition.serviceName,
    serviceVariant: variant,
    requiredTier,
    requestedTier,
    accessAllowed: canAccessNflRedraftPremiumService({
      tier: requestedTier,
      serviceId: input.serviceId,
      variant,
    }),
    leagueId: canonical?.leagueId ?? matchingPackets.find((packet) => packet.canonicalLeagueId)?.canonicalLeagueId ?? null,
    season: canonical?.season ?? null,
    week: canonical?.week ?? null,
    relevantPlayerIds: uniqueStrings([
      ...(canonical?.playerIds ?? []),
      ...matchingPackets.map((packet) => packet.canonicalPlayerId),
    ]),
    affectedTeamIds: uniqueStrings([
      ...(canonical?.teamIds ?? []),
      ...matchingPackets.map((packet) => packet.canonicalTeamId),
    ]),
    affectedMatchupIds: uniqueStrings([
      ...(canonical?.matchupIds ?? []),
      ...matchingPackets.map((packet) => packet.canonicalMatchupId),
    ]),
    affectedGameIds: uniqueStrings([
      ...(canonical?.gameIds ?? []),
      ...matchingPackets.map((packet) => packet.canonicalGameId),
    ]),
    evidencePacketIds: uniqueStrings(matchingPackets.map((packet) => packet.evidenceId)),
    includedEvidenceTypes: uniqueEvidenceTypes(matchingPackets.map((packet) => packet.evidenceType)),
    providerDomains: uniqueStrings(matchingPackets.map((packet) => packet.providerCapabilityDomain)),
    sourceProviders: uniqueStrings(matchingPackets.map((packet) => packet.sourceProvider)),
    freshnessStatus: {
      overall: overallFreshness(freshnessCounts),
      counts: freshnessCounts,
    },
    unavailableDataWarnings: matchingPackets.filter((packet) => packet.missing).map(packetWarningId),
    staleDataWarnings: matchingPackets.filter((packet) => packet.stale).map(packetWarningId),
    fallbackStatus: {
      hasFallback: fallbackPacketIds.length > 0,
      packetIds: fallbackPacketIds,
    },
    confidenceCounts: confidenceCounts(matchingPackets),
    surfaceEligibility: surfaces,
    actionCategoryLabels: serviceActionCategories(definition, matchingPackets),
    factsOnly: true,
    deterministic: true,
    generatedAtIso: input.generatedAtIso ?? new Date(0).toISOString(),
  }
}

type ServiceWrapperInput = Omit<NflRedraftPremiumServiceInput, 'serviceId'>

export function buildWarRoomServiceSummary(input: ServiceWrapperInput): NflRedraftPremiumServiceSummary {
  return buildNflRedraftPremiumServiceSummary({ ...input, serviceId: 'war_room' })
}

export function buildCommissionerDigestServiceSummary(input: ServiceWrapperInput): NflRedraftPremiumServiceSummary {
  return buildNflRedraftPremiumServiceSummary({ ...input, serviceId: 'commissioner_digest' })
}

export function buildManagerBriefServiceSummary(input: ServiceWrapperInput): NflRedraftPremiumServiceSummary {
  return buildNflRedraftPremiumServiceSummary({ ...input, serviceId: 'manager_brief' })
}

export function buildMatchupPrepServiceSummary(input: ServiceWrapperInput): NflRedraftPremiumServiceSummary {
  return buildNflRedraftPremiumServiceSummary({ ...input, serviceId: 'matchup_prep' })
}

export function buildWaiverReportServiceSummary(input: ServiceWrapperInput): NflRedraftPremiumServiceSummary {
  return buildNflRedraftPremiumServiceSummary({ ...input, serviceId: 'waiver_report' })
}

export function buildTradeReviewServiceSummary(input: ServiceWrapperInput): NflRedraftPremiumServiceSummary {
  return buildNflRedraftPremiumServiceSummary({ ...input, serviceId: 'trade_review' })
}

export function buildDraftPrepServiceSummary(input: ServiceWrapperInput): NflRedraftPremiumServiceSummary {
  return buildNflRedraftPremiumServiceSummary({ ...input, serviceId: 'draft_prep' })
}

export function buildBasicRuntimeFactsSummary(input: ServiceWrapperInput): NflRedraftPremiumServiceSummary {
  return buildNflRedraftPremiumServiceSummary({ ...input, serviceId: 'basic_runtime_facts' })
}
