import { prisma } from '@/lib/prisma'
import type { NflRedraftProviderEvidencePacket } from '@/lib/player-data/nflRedraftProviderEvidencePackets'
import { resolveNflRedraftPremiumEvidence } from '@/lib/redraft-premium/nflRedraftPremiumEvidenceResolver'
import { loadNflRedraftPremiumProductionEvidence } from '@/lib/redraft-premium/nflRedraftPremiumProductionEvidenceSource'
import type { NflRedraftPremiumApiCanonicalIds } from '@/lib/redraft-premium/nflRedraftPremiumApiContracts'
import type {
  NflRedraftPremiumServiceId,
  NflRedraftPremiumServiceVariant,
} from '@/lib/redraft-premium/nflRedraftPremiumServices'

type PrismaLike = typeof prisma

const SNAPSHOT_SCHEMA_VERSION = 'nfl-redraft-premium-evidence-snapshot-v1' as const
const DIAGNOSTICS_SCHEMA_VERSION = 'nfl-redraft-premium-diagnostics-v1' as const

const PREMIUM_SERVICE_IDS: readonly NflRedraftPremiumServiceId[] = [
  'basic_runtime_facts',
  'war_room',
  'commissioner_digest',
  'manager_brief',
  'matchup_prep',
  'waiver_report',
  'trade_review',
  'draft_prep',
] as const

export type NflRedraftPremiumEvidenceHealth = {
  totalPackets: number
  stalePackets: number
  fallbackPackets: number
  missingPackets: number
  freshPackets: number
  unknownFreshnessPackets: number
  byEvidenceType: Record<string, number>
  byProvider: Record<string, number>
  providerHealth: Array<{
    provider: string
    packetCount: number
    stale: number
    fallback: number
    missing: number
  }>
}

export type NflRedraftPremiumEvidenceSnapshotPersistenceResult =
  | {
      status: 'persisted'
      evidenceSnapshotId: string
      storage: 'api_usage_event'
      rawPayloadStored: false
    }
  | {
      status: 'unavailable'
      reason: string
      evidenceSnapshotId: null
      rawPayloadStored: false
    }
  | {
      status: 'failed'
      reason: string
      evidenceSnapshotId: null
      rawPayloadStored: false
    }

export type NflRedraftPremiumBackfillStatus = {
  status: 'not_requested' | 'completed' | 'unavailable' | 'failed'
  leagueId: string | null
  season: number | null
  servicesProcessed: number
  snapshotsPersisted: number
  evidencePacketsSeen: number
  messages: string[]
}

export type NflRedraftPremiumDiagnostics = {
  schemaVersion: typeof DIAGNOSTICS_SCHEMA_VERSION
  generatedAt: string
  resolverDurationMs: number
  productionEvidenceDurationMs: number
  totalDurationMs: number
  evidenceSnapshotId: string | null
  persistenceStatus: NflRedraftPremiumEvidenceSnapshotPersistenceResult['status']
  accessDeniedReason: string | null
  evidenceSource: 'production_canonical' | 'request_context' | 'unavailable'
  safeLogging: {
    rawPayloadLogged: false
    credentialValuesLogged: false
  }
}

export type NflRedraftPremiumEvidenceSnapshotInput = {
  serviceId: NflRedraftPremiumServiceId
  serviceVariant?: NflRedraftPremiumServiceVariant
  canonicalIds: NflRedraftPremiumApiCanonicalIds
  userId?: string | null
  status?: number | null
  durationMs?: number | null
  evidencePackets: NflRedraftProviderEvidencePacket[]
  evidenceHealth: NflRedraftPremiumEvidenceHealth
  resolverStatus: { status: string; source: string; messages: string[] }
  evidenceCounts: {
    totalAvailable: number
    selected: number
    stale: number
    fallback: number
    missing: number
    byType: Record<string, number>
  }
  generatedAtIso: string
  enabled?: boolean
}

export type NflRedraftPremiumEvidenceSnapshotDeps = {
  prismaClient?: PrismaLike
}

function increment(map: Record<string, number>, key: string | null | undefined): void {
  const normalized = key?.trim() || 'unknown'
  map[normalized] = (map[normalized] ?? 0) + 1
}

function safeErrorReason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 160)
  return 'unknown_error'
}

export function buildNflRedraftPremiumEvidenceHealth(
  evidencePackets: NflRedraftProviderEvidencePacket[],
): NflRedraftPremiumEvidenceHealth {
  const byEvidenceType: Record<string, number> = {}
  const byProvider: Record<string, number> = {}
  const providerRollup: Record<string, { provider: string; packetCount: number; stale: number; fallback: number; missing: number }> = {}

  for (const packet of evidencePackets) {
    increment(byEvidenceType, packet.evidenceType)
    increment(byProvider, packet.sourceProvider)
    const provider = packet.sourceProvider || 'unknown'
    providerRollup[provider] ??= { provider, packetCount: 0, stale: 0, fallback: 0, missing: 0 }
    providerRollup[provider].packetCount += 1
    if (packet.stale) providerRollup[provider].stale += 1
    if (packet.fallback) providerRollup[provider].fallback += 1
    if (packet.missing) providerRollup[provider].missing += 1
  }

  return {
    totalPackets: evidencePackets.length,
    stalePackets: evidencePackets.filter((packet) => packet.stale).length,
    fallbackPackets: evidencePackets.filter((packet) => packet.fallback).length,
    missingPackets: evidencePackets.filter((packet) => packet.missing).length,
    freshPackets: evidencePackets.filter((packet) => packet.freshnessStatus === 'available').length,
    unknownFreshnessPackets: evidencePackets.filter((packet) => packet.freshnessStatus === 'unknown').length,
    byEvidenceType,
    byProvider,
    providerHealth: Object.values(providerRollup),
  }
}

function sanitizedSnapshotMeta(input: NflRedraftPremiumEvidenceSnapshotInput) {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    serviceId: input.serviceId,
    serviceVariant: input.serviceVariant ?? 'basic',
    canonicalIds: input.canonicalIds,
    evidencePacketIds: input.evidencePackets.map((packet) => packet.evidenceId),
    evidenceTypes: input.evidencePackets.map((packet) => packet.evidenceType),
    evidenceCounts: input.evidenceCounts,
    evidenceHealth: input.evidenceHealth,
    resolverStatus: input.resolverStatus,
    factsOnly: true,
    rawPayloadStored: false,
  }
}

export async function persistNflRedraftPremiumEvidenceSnapshot(
  input: NflRedraftPremiumEvidenceSnapshotInput,
  deps: NflRedraftPremiumEvidenceSnapshotDeps = {},
): Promise<NflRedraftPremiumEvidenceSnapshotPersistenceResult> {
  const client = deps.prismaClient ?? prisma
  if (!input.enabled && deps.prismaClient == null) {
    return {
      status: 'unavailable',
      reason: 'persistence_not_enabled',
      evidenceSnapshotId: null,
      rawPayloadStored: false,
    }
  }

  const create = (client as any).apiUsageEvent?.create
  if (typeof create !== 'function') {
    return {
      status: 'unavailable',
      reason: 'api_usage_event_storage_unavailable',
      evidenceSnapshotId: null,
      rawPayloadStored: false,
    }
  }

  try {
    const row = await create({
      data: {
        userId: input.userId ?? null,
        leagueId: input.canonicalIds.leagueId,
        scope: 'nfl_redraft_premium',
        tool: input.serviceId,
        endpoint: '/api/redraft/premium-services',
        method: 'POST',
        status: input.status ?? 200,
        ok: (input.status ?? 200) < 400,
        durationMs: input.durationMs ?? 0,
        meta: sanitizedSnapshotMeta(input),
      },
    })
    return {
      status: 'persisted',
      evidenceSnapshotId: String(row.id),
      storage: 'api_usage_event',
      rawPayloadStored: false,
    }
  } catch (error) {
    return {
      status: 'failed',
      reason: safeErrorReason(error),
      evidenceSnapshotId: null,
      rawPayloadStored: false,
    }
  }
}

export function buildNflRedraftPremiumDiagnostics(input: {
  generatedAtIso: string
  resolverDurationMs?: number | null
  productionEvidenceDurationMs?: number | null
  totalDurationMs?: number | null
  persistence: NflRedraftPremiumEvidenceSnapshotPersistenceResult
  accessDeniedReason?: string | null
  evidenceSource?: NflRedraftPremiumDiagnostics['evidenceSource']
}): NflRedraftPremiumDiagnostics {
  return {
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    generatedAt: input.generatedAtIso,
    resolverDurationMs: Math.max(0, Math.round(input.resolverDurationMs ?? 0)),
    productionEvidenceDurationMs: Math.max(0, Math.round(input.productionEvidenceDurationMs ?? 0)),
    totalDurationMs: Math.max(0, Math.round(input.totalDurationMs ?? 0)),
    evidenceSnapshotId: input.persistence.evidenceSnapshotId,
    persistenceStatus: input.persistence.status,
    accessDeniedReason: input.accessDeniedReason ?? null,
    evidenceSource: input.evidenceSource ?? 'production_canonical',
    safeLogging: {
      rawPayloadLogged: false,
      credentialValuesLogged: false,
    },
  }
}

export function defaultNflRedraftPremiumBackfillStatus(
  leagueId: string | null,
  season: number | null,
): NflRedraftPremiumBackfillStatus {
  return {
    status: 'not_requested',
    leagueId,
    season,
    servicesProcessed: 0,
    snapshotsPersisted: 0,
    evidencePacketsSeen: 0,
    messages: ['backfill_not_requested'],
  }
}

export async function rebuildNflRedraftPremiumLeagueEvidenceSnapshots(
  input: {
    leagueId: string
    season?: number | null
    teamId?: string | null
    managerId?: string | null
    matchupId?: string | null
    playerId?: string | null
    week?: number | null
    generatedAtIso?: string | null
    persist?: boolean
  },
  deps: {
    prismaClient?: PrismaLike
    loadEvidence?: typeof loadNflRedraftPremiumProductionEvidence
    persistSnapshot?: typeof persistNflRedraftPremiumEvidenceSnapshot
  } = {},
): Promise<NflRedraftPremiumBackfillStatus> {
  const canonicalIds: NflRedraftPremiumApiCanonicalIds = {
    leagueId: input.leagueId,
    teamId: input.teamId ?? null,
    managerId: input.managerId ?? null,
    matchupId: input.matchupId ?? null,
    playerId: input.playerId ?? null,
    week: input.week ?? null,
    season: input.season ?? null,
  }
  const generatedAtIso = input.generatedAtIso ?? new Date(0).toISOString()
  const loadEvidence = deps.loadEvidence ?? loadNflRedraftPremiumProductionEvidence
  const persistSnapshot = deps.persistSnapshot ?? persistNflRedraftPremiumEvidenceSnapshot
  let snapshotsPersisted = 0
  let evidencePacketsSeen = 0

  try {
    for (const serviceId of PREMIUM_SERVICE_IDS) {
      const evidencePackets = await loadEvidence(
        { serviceId, canonicalIds, ingestedAtIso: generatedAtIso },
        { prismaClient: deps.prismaClient as never },
      )
      const resolved = resolveNflRedraftPremiumEvidence({
        serviceId,
        canonicalIds,
        ingestedAtIso: generatedAtIso,
        availableEvidencePackets: evidencePackets,
      })
      evidencePacketsSeen += evidencePackets.length
      if (input.persist) {
        const persisted = await persistSnapshot(
          {
            serviceId,
            canonicalIds,
            evidencePackets: resolved.evidencePackets,
            evidenceHealth: buildNflRedraftPremiumEvidenceHealth(resolved.evidencePackets),
            resolverStatus: resolved.resolverStatus,
            evidenceCounts: resolved.evidenceCounts,
            generatedAtIso,
            status: 200,
            durationMs: 0,
            enabled: true,
          },
          { prismaClient: deps.prismaClient as never },
        )
        if (persisted.status === 'persisted') snapshotsPersisted += 1
      }
    }

    return {
      status: 'completed',
      leagueId: input.leagueId,
      season: input.season ?? null,
      servicesProcessed: PREMIUM_SERVICE_IDS.length,
      snapshotsPersisted,
      evidencePacketsSeen,
      messages: ['backfill_completed'],
    }
  } catch (error) {
    return {
      status: 'failed',
      leagueId: input.leagueId,
      season: input.season ?? null,
      servicesProcessed: 0,
      snapshotsPersisted,
      evidencePacketsSeen,
      messages: [`backfill_failed:${safeErrorReason(error)}`],
    }
  }
}

export function logNflRedraftPremiumOperationalEvent(
  event: {
    serviceId: NflRedraftPremiumServiceId
    leagueId: string | null
    status: 'resolved' | 'denied' | 'error'
    accessDeniedReason?: string | null
    evidenceSnapshotId?: string | null
    evidenceHealth?: NflRedraftPremiumEvidenceHealth | null
  },
  deps: { logger?: Pick<Console, 'info'> } = {},
): void {
  deps.logger?.info('[nfl-redraft-premium]', {
    serviceId: event.serviceId,
    leagueId: event.leagueId,
    status: event.status,
    accessDeniedReason: event.accessDeniedReason ?? null,
    evidenceSnapshotId: event.evidenceSnapshotId ?? null,
    evidenceHealth: event.evidenceHealth
      ? {
          totalPackets: event.evidenceHealth.totalPackets,
          stalePackets: event.evidenceHealth.stalePackets,
          fallbackPackets: event.evidenceHealth.fallbackPackets,
          missingPackets: event.evidenceHealth.missingPackets,
        }
      : null,
    rawPayloadLogged: false,
    credentialValuesLogged: false,
  })
}
