import {
  NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES,
  NFL_REDRAFT_PROVIDER_NODE_CONFIG,
  getNflRedraftProviderFallbackOrder,
  type NflRedraftProviderLifecycleState,
  type NflRedraftProviderNodeConfig,
  type NflRedraftProviderNodeId,
  type NflRedraftProviderOrchestratorCapability,
} from '@/lib/nfl-provider/nflRedraftProviderOrchestrator'
import {
  buildNflRedraftProductionProviderConfigOverrides,
  listNflRedraftExistingProviderIntegrations,
  type NflRedraftProductionProviderResolution,
} from '@/lib/nfl-provider/nflRedraftProductionProviderWiring'
import type {
  NflRedraftEvidenceSurface,
  NflRedraftProviderEvidencePacket,
} from '@/lib/player-data/nflRedraftProviderEvidencePackets'

export const NFL_REDRAFT_PROVIDER_VALIDATION_DASHBOARD_MODEL_VERSION =
  'nfl-redraft-provider-validation-dashboard-v1' as const

const DASHBOARD_PROVIDER_IDS: NflRedraftProviderNodeId[] = [
  'rolling_insights',
  'api_sports',
  'thesportsdb',
  'fantasycalc',
  'clearsports',
  'openweather',
  'sleeper',
  'espn',
]

const SECRET_PATTERNS = [
  'api_key',
  'apikey',
  'authorization',
  'bearer ',
  'client_secret',
  'secret',
  'token',
]

export type NflRedraftProviderValidationCounts = {
  evidencePackets: number
  staleEvidence: number
  missingEvidence: number
  fallbackEvidence: number
  cacheUsage: number
  fallbackSelections: number
}

export type NflRedraftProviderValidationHealthRow = {
  providerId: NflRedraftProviderNodeId
  displayName: string
  status: NflRedraftProviderLifecycleState
  enabled: boolean
  required: boolean
  subscriptionType: NflRedraftProviderNodeConfig['subscriptionType']
  supportedCapabilities: NflRedraftProviderOrchestratorCapability[]
  lastSuccessfulSyncIso: string | null
  lastFailedSyncIso: string | null
  healthReason: string | null
  fallbackPolicyCount: number
  counts: NflRedraftProviderValidationCounts
}

export type NflRedraftProviderTraceRow = {
  capability: NflRedraftProviderOrchestratorCapability
  selectedProvider: NflRedraftProviderNodeId | null
  fallbackChain: NflRedraftProviderNodeId[]
  canonicalPlayerId: string | null
  sourceTimestampIso: string | null
  freshnessStatus: string
  fallbackUsed: boolean
  cacheUsed: boolean
  healthState: NflRedraftProviderLifecycleState | null
  warnings: string[]
}

export type NflRedraftCanonicalTraceView = {
  traceType: 'player' | 'game'
  canonicalId: string
  found: boolean
  providerUsed: NflRedraftProviderNodeId | string | null
  sourceTimestampIso: string | null
  freshnessStatus: string
  fallbackUsed: boolean
  cacheUsed: boolean
  healthState: NflRedraftProviderLifecycleState | null
  evidencePacketIds: string[]
  affectedSurfaces: NflRedraftEvidenceSurface[]
  canonicalFieldNamesIncluded: string[]
  warnings: string[]
  rawProviderPayloadExposed: false
  providerSecretsExposed: false
}

export type NflRedraftLegacyDirectProviderAuditEntry = {
  routeOrFile: string
  providerUsed: string
  riskLevel: 'low' | 'medium' | 'high'
  migrateNow: boolean
  suggestedCanonicalReplacement: string
  notes: string
}

export type NflRedraftProviderValidationDashboard = {
  modelVersion: typeof NFL_REDRAFT_PROVIDER_VALIDATION_DASHBOARD_MODEL_VERSION
  generatedAtIso: string
  internalOnly: true
  adminOnly: true
  flow: Array<'provider' | 'orchestrator' | 'canonical_models' | 'evidence' | 'runtime_premium_services' | 'ui'>
  providers: NflRedraftProviderValidationHealthRow[]
  traces: NflRedraftProviderTraceRow[]
  evidenceCounts: {
    total: number
    stale: number
    missing: number
    fallback: number
    byProvider: Record<string, number>
    bySurface: Record<string, number>
  }
  playerTrace: NflRedraftCanonicalTraceView | null
  gameTrace: NflRedraftCanonicalTraceView | null
  legacyDirectProviderAudit: NflRedraftLegacyDirectProviderAuditEntry[]
  safeOutput: {
    rawProviderPayloadExposed: false
    providerSecretsExposed: false
  }
}

export type BuildNflRedraftProviderValidationDashboardInput = {
  now?: Date
  env?: Record<string, string | undefined>
  evidencePackets?: NflRedraftProviderEvidencePacket[]
  recentResolutions?: NflRedraftProductionProviderResolution[]
  playerId?: string | null
  gameId?: string | null
}

function mergedProviderConfig(
  env: Record<string, string | undefined> | undefined,
): Record<NflRedraftProviderNodeId, NflRedraftProviderNodeConfig> {
  const overrides = buildNflRedraftProductionProviderConfigOverrides(env)
  const merged = { ...NFL_REDRAFT_PROVIDER_NODE_CONFIG }
  for (const providerId of Object.keys(overrides) as NflRedraftProviderNodeId[]) {
    merged[providerId] = {
      ...merged[providerId],
      ...overrides[providerId],
    }
  }
  return merged
}

function increment(map: Record<string, number>, key: string | null | undefined): void {
  const safeKey = key?.trim() || 'unknown'
  map[safeKey] = (map[safeKey] ?? 0) + 1
}

function fallbackPolicyCount(providerId: NflRedraftProviderNodeId): number {
  return Object.values(NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES).filter((policy) => {
    const chain = getNflRedraftProviderFallbackOrder(policy)
    return chain.includes(providerId) && policy.preferredProvider !== providerId
  }).length
}

function providerEvidenceCounts(
  providerId: NflRedraftProviderNodeId,
  evidencePackets: NflRedraftProviderEvidencePacket[],
  recentResolutions: NflRedraftProductionProviderResolution[],
): NflRedraftProviderValidationCounts {
  const providerEvidence = evidencePackets.filter((packet) => packet.sourceProvider === providerId)
  const selectedResolutions = recentResolutions.filter((resolution) => resolution.selectedProvider === providerId)
  return {
    evidencePackets: providerEvidence.length,
    staleEvidence: providerEvidence.filter((packet) => packet.stale).length,
    missingEvidence: providerEvidence.filter((packet) => packet.missing).length,
    fallbackEvidence: providerEvidence.filter((packet) => packet.fallback).length,
    cacheUsage: selectedResolutions.filter((resolution) => resolution.trace.cacheUsed).length,
    fallbackSelections: selectedResolutions.filter((resolution) => resolution.trace.fallbackUsed).length,
  }
}

function evidenceCounts(evidencePackets: NflRedraftProviderEvidencePacket[]) {
  const byProvider: Record<string, number> = {}
  const bySurface: Record<string, number> = {}
  for (const packet of evidencePackets) {
    increment(byProvider, packet.sourceProvider)
    for (const surface of packet.affectedSurfaces) increment(bySurface, surface)
  }
  return {
    total: evidencePackets.length,
    stale: evidencePackets.filter((packet) => packet.stale).length,
    missing: evidencePackets.filter((packet) => packet.missing).length,
    fallback: evidencePackets.filter((packet) => packet.fallback).length,
    byProvider,
    bySurface,
  }
}

function traceRows(recentResolutions: NflRedraftProductionProviderResolution[]): NflRedraftProviderTraceRow[] {
  return recentResolutions.map((resolution) => ({
    capability: resolution.capability,
    selectedProvider: resolution.selectedProvider,
    fallbackChain: resolution.fallbackChain,
    canonicalPlayerId: resolution.trace.canonicalPlayerId,
    sourceTimestampIso: resolution.trace.sourceTimestampIso,
    freshnessStatus: resolution.trace.freshnessStatus,
    fallbackUsed: resolution.trace.fallbackUsed,
    cacheUsed: resolution.trace.cacheUsed,
    healthState: resolution.trace.healthStatus,
    warnings: resolution.warnings,
  }))
}

function packetMatchesTrace(
  packet: NflRedraftProviderEvidencePacket,
  traceType: 'player' | 'game',
  canonicalId: string,
): boolean {
  return traceType === 'player'
    ? packet.canonicalPlayerId === canonicalId
    : packet.canonicalGameId === canonicalId
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))))
}

function uniqueSurfaces(values: NflRedraftEvidenceSurface[][]): NflRedraftEvidenceSurface[] {
  return Array.from(new Set(values.flat()))
}

export function buildNflRedraftCanonicalTraceView(input: {
  traceType: 'player' | 'game'
  canonicalId: string
  evidencePackets?: NflRedraftProviderEvidencePacket[]
  recentResolutions?: NflRedraftProductionProviderResolution[]
}): NflRedraftCanonicalTraceView {
  const packets = (input.evidencePackets ?? []).filter((packet) =>
    packetMatchesTrace(packet, input.traceType, input.canonicalId),
  )
  const resolution = (input.recentResolutions ?? []).find((candidate) => {
    if (input.traceType === 'player') return candidate.trace.canonicalPlayerId === input.canonicalId
    return candidate.canonicalData?.gameId === input.canonicalId || candidate.canonicalData?.canonicalGameId === input.canonicalId
  })
  const latestPacket = packets[0] ?? null

  return {
    traceType: input.traceType,
    canonicalId: input.canonicalId,
    found: Boolean(latestPacket || resolution),
    providerUsed: resolution?.trace.providerUsed ?? latestPacket?.sourceProvider ?? null,
    sourceTimestampIso: resolution?.trace.sourceTimestampIso ?? latestPacket?.sourceTimestampIso ?? null,
    freshnessStatus: resolution?.trace.freshnessStatus ?? latestPacket?.freshnessStatus ?? 'missing',
    fallbackUsed: resolution?.trace.fallbackUsed ?? Boolean(latestPacket?.fallback),
    cacheUsed: resolution?.trace.cacheUsed ?? false,
    healthState: resolution?.trace.healthStatus ?? null,
    evidencePacketIds: packets.map((packet) => packet.evidenceId),
    affectedSurfaces: uniqueSurfaces(packets.map((packet) => packet.affectedSurfaces)),
    canonicalFieldNamesIncluded: uniqueStrings(packets.flatMap((packet) => packet.canonicalFieldNamesIncluded)),
    warnings: resolution?.warnings ?? [],
    rawProviderPayloadExposed: false,
    providerSecretsExposed: false,
  }
}

export function listNflRedraftLegacyDirectProviderAudit(): NflRedraftLegacyDirectProviderAuditEntry[] {
  return [
    {
      routeOrFile: 'app/api/cron/import-scores/route.ts',
      providerUsed: 'API-Sports',
      riskLevel: 'medium',
      migrateNow: false,
      suggestedCanonicalReplacement: 'Use G49H live_stats resolver or a provider-sync job that writes canonical cache first.',
      notes: 'Cron/import path is not customer UI, but it bypasses the orchestrator as a sync entry point.',
    },
    {
      routeOrFile: 'app/api/cron/import-schedules/route.ts',
      providerUsed: 'API-Sports',
      riskLevel: 'medium',
      migrateNow: false,
      suggestedCanonicalReplacement: 'Use G49H schedule resolver and canonical SportsDataCache handoff.',
      notes: 'Safe to defer until import jobs are migrated as a group.',
    },
    {
      routeOrFile: 'app/api/cron/import-standings/route.ts',
      providerUsed: 'API-Sports',
      riskLevel: 'medium',
      migrateNow: false,
      suggestedCanonicalReplacement: 'Use G49H standings resolver with runtime fallback preserved.',
      notes: 'Do not make API-Sports load-bearing for redraft standings.',
    },
    {
      routeOrFile: 'app/api/cron/import-injuries/route.ts',
      providerUsed: 'API-Sports',
      riskLevel: 'medium',
      migrateNow: false,
      suggestedCanonicalReplacement: 'Route provider injury import through G49H canonical player intelligence cache.',
      notes: 'Enhancement data should remain optional and stale-aware.',
    },
    {
      routeOrFile: 'app/api/sports/sync/route.ts',
      providerUsed: 'API-Sports, ClearSports',
      riskLevel: 'medium',
      migrateNow: false,
      suggestedCanonicalReplacement: 'Split sync into provider adapters that feed the G49H canonical cache path.',
      notes: 'Broad admin sync surface; migrate after redraft-specific callers are settled.',
    },
    {
      routeOrFile: 'app/api/sports/weather/route.ts',
      providerUsed: 'OpenWeather',
      riskLevel: 'low',
      migrateNow: false,
      suggestedCanonicalReplacement: 'Use G49H weather resolver with hidden optional fallback.',
      notes: 'G49J migrated team-based NFL weather lookups; lat/lon/city utility modes remain legacy and non-redraft-specific.',
    },
    {
      routeOrFile: 'lib/player-assets/resolvePlayerHeadshot.ts',
      providerUsed: 'API-Sports, ClearSports',
      riskLevel: 'high',
      migrateNow: false,
      suggestedCanonicalReplacement: 'Use G49H headshots resolver and canonical metadata/media path.',
      notes: 'G49J migrated NFL headshots to the canonical media resolver; non-NFL legacy fallback remains unchanged.',
    },
    {
      routeOrFile: 'app/api/fantasycalc/route.ts',
      providerUsed: 'FantasyCalc',
      riskLevel: 'medium',
      migrateNow: false,
      suggestedCanonicalReplacement: 'Use G49H fantasy_valuations resolver with canonical cache before hidden fallback.',
      notes: 'G49J migrated single-player valuation lookup; list, trending, and trade comparison legacy shapes remain deferred.',
    },
    {
      routeOrFile: 'app/api/redraft/*',
      providerUsed: 'none found in focused G49I search',
      riskLevel: 'low',
      migrateNow: false,
      suggestedCanonicalReplacement: 'Keep new redraft provider-backed work behind the G49H resolveNflRedraftProductionProviderCapability entry point.',
      notes: 'Focused redraft route search did not find direct provider imports in app/api/redraft.',
    },
  ]
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .toLowerCase()
    .replace(/"providersecretsexposed":false/g, '')
    .replace(/"rawproviderpayloadexposed":false/g, '')
}

export function assertNflRedraftProviderValidationOutputSafe(value: unknown): {
  ok: boolean
  leakedTerms: string[]
} {
  const text = safeJson(value)
  const leakedTerms = SECRET_PATTERNS.filter((term) => text.includes(term))
  return {
    ok: leakedTerms.length === 0,
    leakedTerms,
  }
}

export function buildNflRedraftProviderValidationDashboard(
  input: BuildNflRedraftProviderValidationDashboardInput = {},
): NflRedraftProviderValidationDashboard {
  const now = input.now ?? new Date()
  const evidencePackets = input.evidencePackets ?? []
  const recentResolutions = input.recentResolutions ?? []
  const config = mergedProviderConfig(input.env)
  const integrations = listNflRedraftExistingProviderIntegrations()

  const providers = DASHBOARD_PROVIDER_IDS.map((providerId) => {
    const row = config[providerId]
    const integration = integrations.find((candidate) => candidate.providerId === providerId)
    return {
      providerId,
      displayName: row.displayName,
      status: row.state,
      enabled: row.enabled,
      required: row.required,
      subscriptionType: row.subscriptionType,
      supportedCapabilities: integration?.capabilities ?? row.capabilities,
      lastSuccessfulSyncIso: row.lastSuccessfulSyncIso,
      lastFailedSyncIso: row.lastFailedSyncIso,
      healthReason: row.healthReason,
      fallbackPolicyCount: fallbackPolicyCount(providerId),
      counts: providerEvidenceCounts(providerId, evidencePackets, recentResolutions),
    }
  })

  return {
    modelVersion: NFL_REDRAFT_PROVIDER_VALIDATION_DASHBOARD_MODEL_VERSION,
    generatedAtIso: now.toISOString(),
    internalOnly: true,
    adminOnly: true,
    flow: ['provider', 'orchestrator', 'canonical_models', 'evidence', 'runtime_premium_services', 'ui'],
    providers,
    traces: traceRows(recentResolutions),
    evidenceCounts: evidenceCounts(evidencePackets),
    playerTrace: input.playerId
      ? buildNflRedraftCanonicalTraceView({
          traceType: 'player',
          canonicalId: input.playerId,
          evidencePackets,
          recentResolutions,
        })
      : null,
    gameTrace: input.gameId
      ? buildNflRedraftCanonicalTraceView({
          traceType: 'game',
          canonicalId: input.gameId,
          evidencePackets,
          recentResolutions,
        })
      : null,
    legacyDirectProviderAudit: listNflRedraftLegacyDirectProviderAudit(),
    safeOutput: {
      rawProviderPayloadExposed: false,
      providerSecretsExposed: false,
    },
  }
}
