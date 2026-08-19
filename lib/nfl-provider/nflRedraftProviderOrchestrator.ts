import type { NflRedraftProviderId } from '@/lib/nfl-provider/nflRedraftProviderFoundation'

export const NFL_REDRAFT_PROVIDER_ORCHESTRATOR_MODEL_VERSION = 'nfl-redraft-provider-orchestrator-v1' as const

export type NflRedraftProviderOrchestratorCapability =
  | 'fantasy_valuations'
  | 'headshots'
  | 'league_import'
  | 'live_stats'
  | 'logos'
  | 'news'
  | 'player_identity'
  | 'schedule'
  | 'standings'
  | 'weather'

export type NflRedraftProviderLifecycleState =
  | 'ACTIVE'
  | 'DEGRADED'
  | 'DISABLED'
  | 'EXPIRED'
  | 'FAILED'
  | 'UNKNOWN'

export type NflRedraftProviderSubscriptionType =
  | 'backbone'
  | 'cache'
  | 'free'
  | 'internal'
  | 'monthly'
  | 'runtime'

export type NflRedraftProviderNodeId =
  | NflRedraftProviderId
  | 'af_default_logo'
  | 'canonical_cache'
  | 'default_avatar'
  | 'hidden'
  | 'internal_historical_model'
  | 'runtime'

export type NflRedraftProviderUnavailableBehavior =
  | 'hide_optional_field'
  | 'preserve_runtime_without_field'
  | 'show_default_media'
  | 'use_cache_if_available'

export type NflRedraftProviderNodeConfig = {
  providerId: NflRedraftProviderNodeId
  displayName: string
  enabled: boolean
  priority: number
  required: boolean
  subscriptionType: NflRedraftProviderSubscriptionType
  capabilities: NflRedraftProviderOrchestratorCapability[]
  state: NflRedraftProviderLifecycleState
  healthReason: string | null
  lastSuccessfulSyncIso: string | null
  lastFailedSyncIso: string | null
}

export type NflRedraftProviderCapabilityPolicy = {
  capability: NflRedraftProviderOrchestratorCapability
  preferredProvider: NflRedraftProviderNodeId
  secondaryProvider?: NflRedraftProviderNodeId | null
  thirdProvider?: NflRedraftProviderNodeId | null
  cacheFallback?: NflRedraftProviderNodeId | null
  runtimeFallback?: NflRedraftProviderNodeId | null
  unavailableBehavior: NflRedraftProviderUnavailableBehavior
  allowStaleCache: boolean
  userFacing: boolean
}

export type NflRedraftProviderHealthSummary = {
  providerId: NflRedraftProviderNodeId
  displayName: string
  status: NflRedraftProviderLifecycleState
  supportedCapabilities: NflRedraftProviderOrchestratorCapability[]
  lastSuccessfulSyncIso: string | null
  lastFailedSyncIso: string | null
  healthReason: string | null
  activeFallbackCount: number
  enabled: boolean
  required: boolean
  subscriptionType: NflRedraftProviderSubscriptionType
}

export type NflRedraftProviderSelectionResult = {
  modelVersion: typeof NFL_REDRAFT_PROVIDER_ORCHESTRATOR_MODEL_VERSION
  capability: NflRedraftProviderOrchestratorCapability
  selectedProvider: NflRedraftProviderNodeId | null
  selectedState: NflRedraftProviderLifecycleState | null
  fallbackChain: NflRedraftProviderNodeId[]
  attemptedProviders: Array<{
    providerId: NflRedraftProviderNodeId
    state: NflRedraftProviderLifecycleState
    selected: boolean
    reason: string
  }>
  unavailableBehavior: NflRedraftProviderUnavailableBehavior
  freshnessStatus: 'available' | 'missing' | 'stale' | 'unknown'
  degraded: boolean
  warnings: string[]
  canonicalData: Record<string, unknown> | null
  providerPayloadExposed: false
  providerIdsExposedToCanonicalData: false
}

export type NflRedraftCanonicalProviderResult = {
  providerId: NflRedraftProviderNodeId
  canonicalData: Record<string, unknown> | null
  updatedAtIso?: string | null
  confidence?: number | null
}

export type NflRedraftProviderMergeResult = {
  modelVersion: typeof NFL_REDRAFT_PROVIDER_ORCHESTRATOR_MODEL_VERSION
  capability: NflRedraftProviderOrchestratorCapability
  canonicalData: Record<string, unknown>
  fieldOwners: Record<string, NflRedraftProviderNodeId>
  conflicts: Array<{
    field: string
    keptProvider: NflRedraftProviderNodeId
    skippedProvider: NflRedraftProviderNodeId
  }>
  providerPayloadExposed: false
  providerIdsExposedToCanonicalData: false
}

export const NFL_REDRAFT_PROVIDER_NODE_CONFIG: Record<NflRedraftProviderNodeId, NflRedraftProviderNodeConfig> = {
  rolling_insights: {
    providerId: 'rolling_insights',
    displayName: 'Rolling Insights',
    enabled: true,
    priority: 1,
    required: true,
    subscriptionType: 'backbone',
    capabilities: ['player_identity', 'schedule', 'live_stats', 'standings', 'headshots', 'logos'],
    state: 'ACTIVE',
    healthReason: null,
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
  api_sports: {
    providerId: 'api_sports',
    displayName: 'API-Sports',
    enabled: true,
    priority: 20,
    required: false,
    subscriptionType: 'monthly',
    capabilities: ['player_identity', 'schedule', 'standings', 'headshots', 'logos', 'news'],
    state: 'UNKNOWN',
    healthReason: 'Monthly enhancement provider; availability is subscription-dependent.',
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
  thesportsdb: {
    providerId: 'thesportsdb',
    displayName: 'TheSportsDB',
    enabled: true,
    priority: 30,
    required: false,
    subscriptionType: 'monthly',
    capabilities: ['headshots', 'logos'],
    state: 'UNKNOWN',
    healthReason: 'Monthly enhancement provider; availability is subscription-dependent.',
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
  fantasycalc: {
    providerId: 'fantasycalc',
    displayName: 'FantasyCalc',
    enabled: true,
    priority: 40,
    required: false,
    subscriptionType: 'monthly',
    capabilities: ['fantasy_valuations'],
    state: 'UNKNOWN',
    healthReason: 'Monthly enhancement provider; valuations are optional.',
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
  clearsports: {
    providerId: 'clearsports',
    displayName: 'ClearSports',
    enabled: true,
    priority: 50,
    required: false,
    subscriptionType: 'monthly',
    capabilities: ['player_identity', 'schedule', 'headshots', 'logos'],
    state: 'UNKNOWN',
    healthReason: 'Monthly enhancement provider; fallback only.',
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
  openweather: {
    providerId: 'openweather',
    displayName: 'OpenWeather',
    enabled: true,
    priority: 60,
    required: false,
    subscriptionType: 'monthly',
    capabilities: ['weather'],
    state: 'UNKNOWN',
    healthReason: 'Monthly weather provider; weather is optional context.',
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
  sleeper: {
    providerId: 'sleeper',
    displayName: 'Sleeper',
    enabled: true,
    priority: 70,
    required: false,
    subscriptionType: 'free',
    capabilities: ['league_import', 'player_identity'],
    state: 'ACTIVE',
    healthReason: null,
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
  espn: {
    providerId: 'espn',
    displayName: 'ESPN',
    enabled: true,
    priority: 80,
    required: false,
    subscriptionType: 'free',
    capabilities: ['league_import'],
    state: 'UNKNOWN',
    healthReason: 'Import provider depends on user-provided credentials.',
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
  sportsdataio: {
    providerId: 'sportsdataio',
    displayName: 'SportsDataIO',
    enabled: false,
    priority: 90,
    required: false,
    subscriptionType: 'monthly',
    capabilities: ['live_stats', 'news', 'schedule', 'headshots'],
    state: 'DISABLED',
    healthReason: 'Legacy licensed provider slot retained for compatibility.',
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
  canonical_cache: {
    providerId: 'canonical_cache',
    displayName: 'Canonical Cache',
    enabled: true,
    priority: 900,
    required: false,
    subscriptionType: 'cache',
    capabilities: ['player_identity', 'schedule', 'live_stats', 'standings', 'fantasy_valuations', 'weather', 'news'],
    state: 'ACTIVE',
    healthReason: null,
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
  runtime: {
    providerId: 'runtime',
    displayName: 'AllFantasy Runtime',
    enabled: true,
    priority: 910,
    required: false,
    subscriptionType: 'runtime',
    capabilities: ['live_stats', 'standings'],
    state: 'ACTIVE',
    healthReason: null,
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
  internal_historical_model: {
    providerId: 'internal_historical_model',
    displayName: 'Internal Historical Models',
    enabled: true,
    priority: 920,
    required: false,
    subscriptionType: 'internal',
    capabilities: ['fantasy_valuations'],
    state: 'ACTIVE',
    healthReason: null,
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
  default_avatar: {
    providerId: 'default_avatar',
    displayName: 'Default Avatar',
    enabled: true,
    priority: 930,
    required: false,
    subscriptionType: 'runtime',
    capabilities: ['headshots'],
    state: 'ACTIVE',
    healthReason: null,
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
  af_default_logo: {
    providerId: 'af_default_logo',
    displayName: 'AF Default Logo',
    enabled: true,
    priority: 940,
    required: false,
    subscriptionType: 'runtime',
    capabilities: ['logos'],
    state: 'ACTIVE',
    healthReason: null,
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
  hidden: {
    providerId: 'hidden',
    displayName: 'Hidden Optional Field',
    enabled: true,
    priority: 950,
    required: false,
    subscriptionType: 'runtime',
    capabilities: ['fantasy_valuations', 'weather', 'news'],
    state: 'ACTIVE',
    healthReason: null,
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
  deterministic: {
    providerId: 'deterministic',
    displayName: 'Deterministic Fixtures',
    enabled: false,
    priority: 999,
    required: false,
    subscriptionType: 'internal',
    capabilities: ['player_identity', 'live_stats', 'weather', 'news'],
    state: 'DISABLED',
    healthReason: 'Test-only fixture provider, not production truth.',
    lastSuccessfulSyncIso: null,
    lastFailedSyncIso: null,
  },
}

export const NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES: Record<
  NflRedraftProviderOrchestratorCapability,
  NflRedraftProviderCapabilityPolicy
> = {
  player_identity: {
    capability: 'player_identity',
    preferredProvider: 'rolling_insights',
    secondaryProvider: 'api_sports',
    thirdProvider: 'clearsports',
    cacheFallback: 'canonical_cache',
    runtimeFallback: null,
    unavailableBehavior: 'use_cache_if_available',
    allowStaleCache: true,
    userFacing: true,
  },
  schedule: {
    capability: 'schedule',
    preferredProvider: 'rolling_insights',
    secondaryProvider: 'api_sports',
    thirdProvider: null,
    cacheFallback: 'canonical_cache',
    runtimeFallback: null,
    unavailableBehavior: 'use_cache_if_available',
    allowStaleCache: true,
    userFacing: true,
  },
  live_stats: {
    capability: 'live_stats',
    preferredProvider: 'rolling_insights',
    secondaryProvider: null,
    thirdProvider: null,
    cacheFallback: 'canonical_cache',
    runtimeFallback: 'runtime',
    unavailableBehavior: 'preserve_runtime_without_field',
    allowStaleCache: true,
    userFacing: true,
  },
  standings: {
    capability: 'standings',
    preferredProvider: 'rolling_insights',
    secondaryProvider: 'api_sports',
    thirdProvider: null,
    cacheFallback: 'canonical_cache',
    runtimeFallback: 'runtime',
    unavailableBehavior: 'preserve_runtime_without_field',
    allowStaleCache: true,
    userFacing: true,
  },
  headshots: {
    capability: 'headshots',
    preferredProvider: 'thesportsdb',
    secondaryProvider: 'api_sports',
    thirdProvider: 'rolling_insights',
    cacheFallback: null,
    runtimeFallback: 'default_avatar',
    unavailableBehavior: 'show_default_media',
    allowStaleCache: false,
    userFacing: true,
  },
  logos: {
    capability: 'logos',
    preferredProvider: 'thesportsdb',
    secondaryProvider: 'api_sports',
    thirdProvider: 'rolling_insights',
    cacheFallback: null,
    runtimeFallback: 'af_default_logo',
    unavailableBehavior: 'show_default_media',
    allowStaleCache: false,
    userFacing: true,
  },
  fantasy_valuations: {
    capability: 'fantasy_valuations',
    preferredProvider: 'fantasycalc',
    secondaryProvider: 'internal_historical_model',
    thirdProvider: null,
    cacheFallback: 'canonical_cache',
    runtimeFallback: 'hidden',
    unavailableBehavior: 'hide_optional_field',
    allowStaleCache: true,
    userFacing: false,
  },
  weather: {
    capability: 'weather',
    preferredProvider: 'openweather',
    secondaryProvider: null,
    thirdProvider: null,
    cacheFallback: 'canonical_cache',
    runtimeFallback: 'hidden',
    unavailableBehavior: 'hide_optional_field',
    allowStaleCache: true,
    userFacing: false,
  },
  news: {
    capability: 'news',
    preferredProvider: 'api_sports',
    secondaryProvider: null,
    thirdProvider: null,
    cacheFallback: 'canonical_cache',
    runtimeFallback: 'hidden',
    unavailableBehavior: 'hide_optional_field',
    allowStaleCache: true,
    userFacing: false,
  },
  league_import: {
    capability: 'league_import',
    preferredProvider: 'sleeper',
    secondaryProvider: 'espn',
    thirdProvider: null,
    cacheFallback: null,
    runtimeFallback: null,
    unavailableBehavior: 'preserve_runtime_without_field',
    allowStaleCache: false,
    userFacing: false,
  },
}

function uniqueProviders(values: Array<NflRedraftProviderNodeId | null | undefined>): NflRedraftProviderNodeId[] {
  return Array.from(new Set(values.filter((value): value is NflRedraftProviderNodeId => Boolean(value))))
}

export function getNflRedraftProviderFallbackOrder(
  policy: NflRedraftProviderCapabilityPolicy,
): NflRedraftProviderNodeId[] {
  return uniqueProviders([
    policy.preferredProvider,
    policy.secondaryProvider,
    policy.thirdProvider,
    policy.cacheFallback,
    policy.runtimeFallback,
  ])
}

function isSelectableState(state: NflRedraftProviderLifecycleState): boolean {
  return state === 'ACTIVE' || state === 'DEGRADED' || state === 'UNKNOWN'
}

function mergedConfig(
  overrides: Partial<Record<NflRedraftProviderNodeId, Partial<NflRedraftProviderNodeConfig>>> = {},
): Record<NflRedraftProviderNodeId, NflRedraftProviderNodeConfig> {
  const result = { ...NFL_REDRAFT_PROVIDER_NODE_CONFIG }
  for (const [providerId, override] of Object.entries(overrides) as Array<
    [NflRedraftProviderNodeId, Partial<NflRedraftProviderNodeConfig>]
  >) {
    result[providerId] = { ...result[providerId], ...override, providerId }
  }
  return result
}

export function buildNflRedraftProviderHealthSummaries(input: {
  configOverrides?: Partial<Record<NflRedraftProviderNodeId, Partial<NflRedraftProviderNodeConfig>>>
  policies?: Record<NflRedraftProviderOrchestratorCapability, NflRedraftProviderCapabilityPolicy>
} = {}): NflRedraftProviderHealthSummary[] {
  const config = mergedConfig(input.configOverrides)
  const policies = input.policies ?? NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES
  const fallbackCount: Record<NflRedraftProviderNodeId, number> = Object.fromEntries(
    Object.keys(config).map((providerId) => [providerId, 0]),
  ) as Record<NflRedraftProviderNodeId, number>

  for (const policy of Object.values(policies)) {
    for (const providerId of getNflRedraftProviderFallbackOrder(policy).slice(1)) {
      fallbackCount[providerId] = (fallbackCount[providerId] ?? 0) + 1
    }
  }

  return Object.values(config)
    .sort((a, b) => a.priority - b.priority)
    .map((provider): NflRedraftProviderHealthSummary => ({
      providerId: provider.providerId,
      displayName: provider.displayName,
      status: provider.enabled ? provider.state : 'DISABLED',
      supportedCapabilities: provider.capabilities,
      lastSuccessfulSyncIso: provider.lastSuccessfulSyncIso,
      lastFailedSyncIso: provider.lastFailedSyncIso,
      healthReason: provider.enabled ? provider.healthReason : 'Provider disabled by configuration.',
      activeFallbackCount: fallbackCount[provider.providerId] ?? 0,
      enabled: provider.enabled,
      required: provider.required,
      subscriptionType: provider.subscriptionType,
    }))
}

function sanitizeCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizeCanonicalValue(entry))
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase()
    if (
      lower === 'payload' ||
      lower.includes('provider') ||
      lower.includes('raw') ||
      lower.includes('secret') ||
      lower.includes('apikey') ||
      lower.includes('api_key')
    ) {
      continue
    }
    output[key] = sanitizeCanonicalValue(entry)
  }
  return output
}

export function sanitizeNflRedraftCanonicalProviderData(value: unknown): Record<string, unknown> | null {
  const sanitized = sanitizeCanonicalValue(value)
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : null
}

export function selectNflRedraftProviderForCapability(input: {
  capability: NflRedraftProviderOrchestratorCapability
  canonicalDataByProvider?: Partial<Record<NflRedraftProviderNodeId, Record<string, unknown> | null>>
  configOverrides?: Partial<Record<NflRedraftProviderNodeId, Partial<NflRedraftProviderNodeConfig>>>
  policyOverrides?: Partial<Record<NflRedraftProviderOrchestratorCapability, Partial<NflRedraftProviderCapabilityPolicy>>>
  cacheFreshness?: 'available' | 'missing' | 'stale' | 'unknown'
}): NflRedraftProviderSelectionResult {
  const basePolicy = NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES[input.capability]
  const policy = { ...basePolicy, ...(input.policyOverrides?.[input.capability] ?? {}) }
  const config = mergedConfig(input.configOverrides)
  const fallbackChain = getNflRedraftProviderFallbackOrder(policy)
  const attemptedProviders: NflRedraftProviderSelectionResult['attemptedProviders'] = []
  const warnings: string[] = []
  const cacheFreshness = input.cacheFreshness ?? 'unknown'
  let selectedProvider: NflRedraftProviderNodeId | null = null

  for (const providerId of fallbackChain) {
    const provider = config[providerId]
    const state = provider?.enabled ? provider.state : 'DISABLED'
    const selected = provider?.enabled === true && isSelectableState(state)
    const isStaleCache = providerId === 'canonical_cache' && cacheFreshness === 'stale'
    const staleCacheAllowed = isStaleCache && policy.allowStaleCache
    const effectiveSelected = selected && (!isStaleCache || staleCacheAllowed)
    const reason = !provider
      ? 'provider_not_configured'
      : !provider.enabled
        ? 'provider_disabled'
        : state === 'EXPIRED'
          ? 'subscription_expired'
          : state === 'FAILED'
            ? 'provider_failed'
            : isStaleCache && !policy.allowStaleCache
              ? 'stale_cache_not_allowed'
              : effectiveSelected
                ? 'selected'
                : `state_${state.toLowerCase()}`
    attemptedProviders.push({ providerId, state, selected: effectiveSelected, reason })
    if (effectiveSelected && !selectedProvider) {
      selectedProvider = providerId
      if (state === 'DEGRADED' || state === 'UNKNOWN') warnings.push(`${providerId}:${state.toLowerCase()}`)
      if (staleCacheAllowed) warnings.push('canonical_cache:stale')
      break
    }
  }

  const selectedState = selectedProvider ? config[selectedProvider].state : null
  const canonicalData =
    selectedProvider && input.canonicalDataByProvider
      ? sanitizeNflRedraftCanonicalProviderData(input.canonicalDataByProvider[selectedProvider])
      : null

  if (!selectedProvider) warnings.push(`${input.capability}:unavailable`)

  return {
    modelVersion: NFL_REDRAFT_PROVIDER_ORCHESTRATOR_MODEL_VERSION,
    capability: input.capability,
    selectedProvider,
    selectedState,
    fallbackChain,
    attemptedProviders,
    unavailableBehavior: policy.unavailableBehavior,
    freshnessStatus: selectedProvider === 'canonical_cache' ? cacheFreshness : selectedProvider ? 'available' : 'missing',
    degraded: selectedState === 'DEGRADED' || selectedState === 'UNKNOWN' || selectedProvider === 'canonical_cache',
    warnings,
    canonicalData,
    providerPayloadExposed: false,
    providerIdsExposedToCanonicalData: false,
  }
}

export function mergeNflRedraftCanonicalProviderResults(input: {
  capability: NflRedraftProviderOrchestratorCapability
  results: NflRedraftCanonicalProviderResult[]
  policyOverrides?: Partial<Record<NflRedraftProviderOrchestratorCapability, Partial<NflRedraftProviderCapabilityPolicy>>>
}): NflRedraftProviderMergeResult {
  const basePolicy = NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES[input.capability]
  const policy = { ...basePolicy, ...(input.policyOverrides?.[input.capability] ?? {}) }
  const order = getNflRedraftProviderFallbackOrder(policy)
  const sorted = [...input.results]
    .filter((result) => result.canonicalData)
    .sort((a, b) => {
      const left = order.indexOf(a.providerId)
      const right = order.indexOf(b.providerId)
      return (left === -1 ? Number.MAX_SAFE_INTEGER : left) - (right === -1 ? Number.MAX_SAFE_INTEGER : right)
    })

  const canonicalData: Record<string, unknown> = {}
  const fieldOwners: Record<string, NflRedraftProviderNodeId> = {}
  const conflicts: NflRedraftProviderMergeResult['conflicts'] = []

  for (const result of sorted) {
    const sanitized = sanitizeNflRedraftCanonicalProviderData(result.canonicalData)
    if (!sanitized) continue
    for (const [field, value] of Object.entries(sanitized)) {
      if (value == null) continue
      if (!(field in canonicalData)) {
        canonicalData[field] = value
        fieldOwners[field] = result.providerId
        continue
      }
      if (JSON.stringify(canonicalData[field]) !== JSON.stringify(value)) {
        conflicts.push({
          field,
          keptProvider: fieldOwners[field],
          skippedProvider: result.providerId,
        })
      }
    }
  }

  return {
    modelVersion: NFL_REDRAFT_PROVIDER_ORCHESTRATOR_MODEL_VERSION,
    capability: input.capability,
    canonicalData,
    fieldOwners,
    conflicts,
    providerPayloadExposed: false,
    providerIdsExposedToCanonicalData: false,
  }
}
