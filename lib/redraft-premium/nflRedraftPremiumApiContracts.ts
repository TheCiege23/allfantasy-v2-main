import type { EntitlementStatus, SubscriptionPlanId } from '@/lib/subscription/types'
import { expandPlansWithBundle, isActiveOrGraceStatus } from '@/lib/subscription/feature-access'
import type { NflRedraftEvidenceSurface, NflRedraftProviderEvidencePacket } from '@/lib/player-data/nflRedraftProviderEvidencePackets'
import {
  buildNflRedraftPremiumServiceSummary,
  canAccessNflRedraftPremiumService,
  resolveNflRedraftPremiumServiceRequiredTier,
  type NflRedraftPremiumActionCategory,
  type NflRedraftPremiumServiceId,
  type NflRedraftPremiumServiceVariant,
  type NflRedraftPremiumTier,
} from '@/lib/redraft-premium/nflRedraftPremiumServices'
import type {
  NflRedraftPremiumEvidenceCounts,
  NflRedraftPremiumEvidenceResolverStatus,
} from '@/lib/redraft-premium/nflRedraftPremiumEvidenceResolver'
import type {
  NflRedraftPremiumBackfillStatus,
  NflRedraftPremiumDiagnostics,
  NflRedraftPremiumEvidenceHealth,
} from '@/lib/redraft-premium/nflRedraftPremiumObservability'

export const NFL_REDRAFT_PREMIUM_API_CONTRACT_MODEL_VERSION = 'nfl-redraft-premium-api-contract-v1' as const

const SERVICE_IDS: readonly NflRedraftPremiumServiceId[] = [
  'basic_runtime_facts',
  'war_room',
  'commissioner_digest',
  'manager_brief',
  'matchup_prep',
  'waiver_report',
  'trade_review',
  'draft_prep',
] as const

const SERVICE_VARIANTS: readonly NflRedraftPremiumServiceVariant[] = ['basic', 'commissioner', 'advanced'] as const
const PREMIUM_TIERS: readonly NflRedraftPremiumTier[] = ['FREE', 'AF_PRO', 'AF_COMMISSIONER', 'AF_SUPREME', 'AF_WAR_ROOM'] as const
const CANONICAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const TOP_LEVEL_REQUEST_FIELDS = new Set([
  'serviceType',
  'serviceId',
  'serviceVariant',
  'leagueId',
  'teamId',
  'managerId',
  'matchupId',
  'playerId',
  'week',
  'season',
  'requestedTier',
  'entitlement',
  'generatedAtIso',
])
const ENTITLEMENT_FIELDS = new Set(['status', 'plans'])

export type NflRedraftPremiumServiceContractRequest = {
  serviceType?: string | null
  serviceId?: string | null
  serviceVariant?: string | null
  leagueId?: string | null
  teamId?: string | null
  managerId?: string | null
  matchupId?: string | null
  playerId?: string | null
  week?: number | string | null
  season?: number | string | null
  requestedTier?: string | null
  entitlement?: {
    status?: EntitlementStatus | null
    plans?: SubscriptionPlanId[] | null
  } | null
  generatedAtIso?: string | null
}

export type NflRedraftPremiumApiCanonicalIds = {
  leagueId: string | null
  teamId: string | null
  managerId: string | null
  matchupId: string | null
  playerId: string | null
  week: number | null
  season: number | null
}

export type NflRedraftPremiumApiAccessStatus = {
  allowed: boolean
  requiredTier: NflRedraftPremiumTier
  requestedTier: NflRedraftPremiumTier
  reason: 'allowed' | 'tier_required'
}

export type NflRedraftPremiumProductPacket = {
  modelVersion: typeof NFL_REDRAFT_PREMIUM_API_CONTRACT_MODEL_VERSION
  ok: true
  serviceType: NflRedraftPremiumServiceId
  serviceName: string
  serviceVariant: NflRedraftPremiumServiceVariant
  requiredTier: NflRedraftPremiumTier
  accessStatus: NflRedraftPremiumApiAccessStatus
  canonicalIds: NflRedraftPremiumApiCanonicalIds
  evidencePacketIds: string[]
  freshnessWarnings: {
    overall: string
    counts: Record<string, number>
  }
  staleDataWarnings: string[]
  fallbackWarnings: string[]
  missingDataWarnings: string[]
  eligibleSurfaces: NflRedraftEvidenceSurface[]
  factualCategoryLabels: NflRedraftPremiumActionCategory[]
  unavailableDataMessages: string[]
  resolverStatus: NflRedraftPremiumEvidenceResolverStatus
  evidenceCounts: NflRedraftPremiumEvidenceCounts
  diagnostics?: NflRedraftPremiumDiagnostics
  evidenceSnapshotId?: string | null
  generatedAt?: string
  resolverDurationMs?: number
  evidenceHealth?: NflRedraftPremiumEvidenceHealth
  backfillStatus?: NflRedraftPremiumBackfillStatus
  factsOnly: true
  deterministic: true
  generatedAtIso: string
}

export type NflRedraftPremiumProductError = {
  modelVersion: typeof NFL_REDRAFT_PREMIUM_API_CONTRACT_MODEL_VERSION
  ok: false
  error: {
    code:
      | 'invalid_request'
      | 'unknown_service'
      | 'invalid_tier'
      | 'provider_input_rejected'
      | 'unauthenticated'
      | 'league_membership_denied'
      | 'league_not_found'
      | 'commissioner_required'
      | 'auth_boundary_unavailable'
    message: string
    fields: string[]
  }
  diagnostics?: NflRedraftPremiumDiagnostics
}

export type NflRedraftPremiumProductContractResult =
  | NflRedraftPremiumProductPacket
  | NflRedraftPremiumProductError

export type NflRedraftPremiumProductContractDependencies = {
  evidencePackets?: NflRedraftProviderEvidencePacket[]
  resolverStatus?: NflRedraftPremiumEvidenceResolverStatus | null
  evidenceCounts?: NflRedraftPremiumEvidenceCounts | null
  diagnostics?: NflRedraftPremiumDiagnostics | null
  evidenceSnapshotId?: string | null
  resolverDurationMs?: number | null
  evidenceHealth?: NflRedraftPremiumEvidenceHealth | null
  backfillStatus?: NflRedraftPremiumBackfillStatus | null
  generatedAtIso?: string | null
}

function cleanString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function cleanInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim())
  return null
}

function isServiceId(value: unknown): value is NflRedraftPremiumServiceId {
  return typeof value === 'string' && SERVICE_IDS.includes(value as NflRedraftPremiumServiceId)
}

function cleanServiceVariant(value: unknown): NflRedraftPremiumServiceVariant | null {
  if (value == null || value === '') return 'basic'
  return typeof value === 'string' && SERVICE_VARIANTS.includes(value as NflRedraftPremiumServiceVariant)
    ? (value as NflRedraftPremiumServiceVariant)
    : null
}

function cleanTier(value: unknown): NflRedraftPremiumTier | null {
  return typeof value === 'string' && PREMIUM_TIERS.includes(value as NflRedraftPremiumTier)
    ? (value as NflRedraftPremiumTier)
    : null
}

function forbiddenInputFields(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => forbiddenInputFields(entry, `${path}[${index}]`))
  }

  const fields: string[] = []
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const fullPath = path ? `${path}.${key}` : key
    const lower = key.toLowerCase()
    if (
      lower === 'evidencepackets' ||
      lower === 'providerid' ||
      lower === 'providerids' ||
      lower === 'providerplayerid' ||
      lower === 'sourceprovider' ||
      lower === 'providerpayload' ||
      lower === 'rawproviderpayload' ||
      lower === 'payload'
    ) {
      fields.push(fullPath)
    }
    fields.push(...forbiddenInputFields(entry, fullPath))
  }
  return fields
}

function unknownInputFields(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['body']
  const fields: string[] = []
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!TOP_LEVEL_REQUEST_FIELDS.has(key)) fields.push(key)
    if (key === 'entitlement' && entry && typeof entry === 'object' && !Array.isArray(entry)) {
      for (const entitlementKey of Object.keys(entry as Record<string, unknown>)) {
        if (!ENTITLEMENT_FIELDS.has(entitlementKey)) fields.push(`entitlement.${entitlementKey}`)
      }
    }
  }
  return fields
}

function invalidCanonicalIdFields(request: NflRedraftPremiumServiceContractRequest): string[] {
  const fields: Array<keyof Pick<
    NflRedraftPremiumServiceContractRequest,
    'leagueId' | 'teamId' | 'managerId' | 'matchupId' | 'playerId'
  >> = ['leagueId', 'teamId', 'managerId', 'matchupId', 'playerId']
  return fields.filter((field) => {
    const value = request[field]
    if (value == null || value === '') return false
    const cleaned = cleanString(value)
    return !cleaned || !CANONICAL_ID_PATTERN.test(cleaned)
  })
}

function invalidIntegerFields(request: NflRedraftPremiumServiceContractRequest): string[] {
  return (['week', 'season'] as const).filter((field) => {
    const value = request[field]
    if (value == null || value === '') return false
    return cleanInteger(value) == null
  })
}

function error(
  code: NflRedraftPremiumProductError['error']['code'],
  message: string,
  fields: string[],
  diagnostics?: NflRedraftPremiumDiagnostics | null,
): NflRedraftPremiumProductError {
  return {
    modelVersion: NFL_REDRAFT_PREMIUM_API_CONTRACT_MODEL_VERSION,
    ok: false,
    error: { code, message, fields },
    ...(diagnostics ? { diagnostics } : {}),
  }
}

export function buildNflRedraftPremiumProductError(
  code: NflRedraftPremiumProductError['error']['code'],
  message: string,
  fields: string[],
  diagnostics?: NflRedraftPremiumDiagnostics | null,
): NflRedraftPremiumProductError {
  return error(code, message, fields, diagnostics)
}

export function resolveNflRedraftPremiumTierFromEntitlement(input: {
  serviceId: NflRedraftPremiumServiceId
  variant?: NflRedraftPremiumServiceVariant
  status?: EntitlementStatus | null
  plans?: SubscriptionPlanId[] | null
}): NflRedraftPremiumTier {
  const status = input.status ?? 'none'
  if (!isActiveOrGraceStatus(status)) return 'FREE'

  const rawPlans = input.plans ?? []
  const expanded = expandPlansWithBundle(rawPlans)
  const hasSupreme = rawPlans.includes('supreme')

  if (input.serviceId === 'war_room') {
    return rawPlans.includes('war_room') ? 'AF_WAR_ROOM' : 'FREE'
  }

  if (input.variant === 'advanced') {
    return hasSupreme ? 'AF_SUPREME' : 'FREE'
  }

  const required = resolveNflRedraftPremiumServiceRequiredTier(input.serviceId, input.variant ?? 'basic')
  if (required === 'FREE') return 'FREE'
  if (required === 'AF_COMMISSIONER') {
    if (hasSupreme) return 'AF_SUPREME'
    return expanded.includes('commissioner') ? 'AF_COMMISSIONER' : 'FREE'
  }
  if (required === 'AF_PRO') {
    if (hasSupreme) return 'AF_SUPREME'
    return expanded.includes('pro') ? 'AF_PRO' : 'FREE'
  }
  if (required === 'AF_SUPREME') return hasSupreme ? 'AF_SUPREME' : 'FREE'
  return 'FREE'
}

function unavailableMessages(input: {
  evidencePacketIds: string[]
  missingDataWarnings: string[]
  staleDataWarnings: string[]
  fallbackWarnings: string[]
}): string[] {
  const messages = [
    ...input.missingDataWarnings.map((warning) => `missing:${warning}`),
    ...input.staleDataWarnings.map((warning) => `stale:${warning}`),
    ...input.fallbackWarnings.map((warning) => `fallback:${warning}`),
  ]
  if (input.evidencePacketIds.length === 0) messages.push('unavailable:no_matching_canonical_evidence')
  return Array.from(new Set(messages))
}

function defaultResolverStatus(evidencePacketCount: number): NflRedraftPremiumEvidenceResolverStatus {
  return {
    status: evidencePacketCount > 0 ? 'resolved' : 'empty',
    source: 'canonical_evidence_resolver',
    messages: evidencePacketCount > 0 ? [`selected_${evidencePacketCount}_canonical_evidence_packets`] : ['no_matching_canonical_evidence'],
  }
}

function defaultEvidenceCounts(evidencePackets: NflRedraftProviderEvidencePacket[]): NflRedraftPremiumEvidenceCounts {
  const byType: Record<string, number> = {}
  for (const packet of evidencePackets) {
    byType[packet.evidenceType] = (byType[packet.evidenceType] ?? 0) + 1
  }
  return {
    totalAvailable: evidencePackets.length,
    selected: evidencePackets.length,
    stale: evidencePackets.filter((packet) => packet.stale).length,
    fallback: evidencePackets.filter((packet) => packet.fallback).length,
    missing: evidencePackets.filter((packet) => packet.missing).length,
    byType,
  }
}

export function buildNflRedraftPremiumProductContract(
  request: NflRedraftPremiumServiceContractRequest,
  dependencies: NflRedraftPremiumProductContractDependencies = {},
): NflRedraftPremiumProductContractResult {
  const forbiddenFields = forbiddenInputFields(request)
  if (forbiddenFields.length > 0) {
    return error('provider_input_rejected', 'Only canonical identifiers are accepted by this contract.', forbiddenFields)
  }

  const unknownFields = unknownInputFields(request)
  if (unknownFields.length > 0) {
    return error('invalid_request', 'Only documented premium service request fields are accepted.', unknownFields)
  }

  const rawServiceType = cleanString(request.serviceType ?? request.serviceId)
  if (!isServiceId(rawServiceType)) {
    return error('unknown_service', 'Unknown NFL redraft premium service type.', ['serviceType'])
  }

  const leagueId = cleanString(request.leagueId)
  if (!leagueId) return error('invalid_request', 'leagueId is required.', ['leagueId'])
  const invalidCanonicalFields = invalidCanonicalIdFields(request)
  if (invalidCanonicalFields.length > 0) {
    return error('invalid_request', 'Canonical identifiers may only contain letters, numbers, dashes, and underscores.', invalidCanonicalFields)
  }
  const invalidNumberFields = invalidIntegerFields(request)
  if (invalidNumberFields.length > 0) {
    return error('invalid_request', 'week and season must be positive integers when provided.', invalidNumberFields)
  }

  const serviceVariant = cleanServiceVariant(request.serviceVariant)
  if (!serviceVariant) return error('invalid_request', 'Unknown premium service variant.', ['serviceVariant'])

  if (request.requestedTier != null && request.requestedTier !== '' && !cleanTier(request.requestedTier)) {
    return error('invalid_tier', 'Unknown NFL redraft premium tier.', ['requestedTier'])
  }
  const requestedTier =
    cleanTier(request.requestedTier) ??
    resolveNflRedraftPremiumTierFromEntitlement({
      serviceId: rawServiceType,
      variant: serviceVariant,
      status: request.entitlement?.status ?? 'none',
      plans: request.entitlement?.plans ?? [],
    })

  const canonicalIds: NflRedraftPremiumApiCanonicalIds = {
    leagueId,
    teamId: cleanString(request.teamId),
    managerId: cleanString(request.managerId),
    matchupId: cleanString(request.matchupId),
    playerId: cleanString(request.playerId),
    week: cleanInteger(request.week),
    season: cleanInteger(request.season),
  }

  const summary = buildNflRedraftPremiumServiceSummary({
    serviceId: rawServiceType,
    serviceVariant,
    requestedTier,
    evidencePackets: dependencies.evidencePackets ?? [],
    canonicalContext: {
      leagueId,
      season: canonicalIds.season,
      week: canonicalIds.week,
      playerIds: canonicalIds.playerId ? [canonicalIds.playerId] : [],
      teamIds: canonicalIds.teamId ? [canonicalIds.teamId] : [],
      matchupIds: canonicalIds.matchupId ? [canonicalIds.matchupId] : [],
      gameIds: [],
    },
    generatedAtIso: request.generatedAtIso ?? dependencies.generatedAtIso ?? null,
  })

  const fallbackWarnings = summary.fallbackStatus.packetIds.map((packetId) => `fallback:${packetId}`)
  const missingDataWarnings = summary.unavailableDataWarnings
  const staleDataWarnings = summary.staleDataWarnings
  const resolverStatus = dependencies.resolverStatus ?? defaultResolverStatus(summary.evidencePacketIds.length)
  const evidenceCounts = dependencies.evidenceCounts ?? defaultEvidenceCounts(dependencies.evidencePackets ?? [])
  const accessAllowed = canAccessNflRedraftPremiumService({
    tier: requestedTier,
    serviceId: rawServiceType,
    variant: serviceVariant,
  })

  return {
    modelVersion: NFL_REDRAFT_PREMIUM_API_CONTRACT_MODEL_VERSION,
    ok: true,
    serviceType: rawServiceType,
    serviceName: summary.serviceName,
    serviceVariant,
    requiredTier: summary.requiredTier,
    accessStatus: {
      allowed: accessAllowed,
      requiredTier: summary.requiredTier,
      requestedTier,
      reason: accessAllowed ? 'allowed' : 'tier_required',
    },
    canonicalIds,
    evidencePacketIds: summary.evidencePacketIds,
    freshnessWarnings: {
      overall: summary.freshnessStatus.overall,
      counts: summary.freshnessStatus.counts,
    },
    staleDataWarnings,
    fallbackWarnings,
    missingDataWarnings,
    eligibleSurfaces: summary.surfaceEligibility,
    factualCategoryLabels: summary.actionCategoryLabels,
    unavailableDataMessages: unavailableMessages({
      evidencePacketIds: summary.evidencePacketIds,
      missingDataWarnings,
      staleDataWarnings,
      fallbackWarnings,
    }),
    resolverStatus,
    evidenceCounts,
    ...(dependencies.diagnostics ? { diagnostics: dependencies.diagnostics } : {}),
    ...(dependencies.evidenceSnapshotId !== undefined ? { evidenceSnapshotId: dependencies.evidenceSnapshotId } : {}),
    ...(dependencies.generatedAtIso ?? request.generatedAtIso ? { generatedAt: summary.generatedAtIso } : {}),
    ...(dependencies.resolverDurationMs != null ? { resolverDurationMs: dependencies.resolverDurationMs } : {}),
    ...(dependencies.evidenceHealth ? { evidenceHealth: dependencies.evidenceHealth } : {}),
    ...(dependencies.backfillStatus ? { backfillStatus: dependencies.backfillStatus } : {}),
    factsOnly: true,
    deterministic: true,
    generatedAtIso: summary.generatedAtIso,
  }
}
