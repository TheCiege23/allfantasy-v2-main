/**
 * Fantasy OS Phase 5 — deterministic provider selection + capability-specific fallback (Part 6).
 *
 * Priority is by (sport, capability): a provider good for team logos may be unsuitable for injuries or live
 * scoring, so fallback is capability-specific. Selection preserves the requested vs selected provider + reason.
 */
import type { SportsDataCapability } from './capabilities'
import type { CapabilityRegistry } from './capabilities'

export type ProviderPriorityRule = {
  sport: string
  capability: SportsDataCapability
  primary: string
  fallbacks: string[]
  minimumFreshnessMinutes: number
}

export type ProviderHealthState =
  | 'healthy'
  | 'degraded'
  | 'rate_limited'
  | 'authentication_failed'
  | 'schema_mismatch'
  | 'unavailable'
  | 'not_configured'

export type SelectionInput = {
  sport: string
  capability: SportsDataCapability
  registry: CapabilityRegistry
  rules: ProviderPriorityRule[]
  /** Provider → current health; unhealthy providers are skipped unless nothing else is available. */
  health?: Record<string, ProviderHealthState>
}

export type SelectionResult =
  | {
      selected: true
      requestedProvider: string
      selectedProvider: string
      fallbackUsed: boolean
      fallbackReason: string | null
      order: string[]
    }
  | { selected: false; reason: string; order: string[] }

const UNHEALTHY: ReadonlySet<ProviderHealthState> = new Set([
  'authentication_failed',
  'unavailable',
  'not_configured',
  'schema_mismatch',
])

/**
 * Select a provider for (sport, capability): the rule's primary first, then its fallbacks, skipping providers
 * that don't declare the capability or are currently unhealthy. Deterministic and explicit — never silent.
 */
export function selectProvider(input: SelectionInput): SelectionResult {
  const rule = input.rules.find((r) => r.sport.toUpperCase() === input.sport.toUpperCase() && r.capability === input.capability)
  const declared = input.registry.providersFor(input.sport, input.capability)
  const candidates = rule ? [rule.primary, ...rule.fallbacks] : declared
  const order = candidates.filter((p, i) => candidates.indexOf(p) === i)

  if (order.length === 0) {
    return { selected: false, reason: `no provider supports ${input.sport}/${input.capability}`, order }
  }

  const requested = order[0]
  const health = input.health ?? {}
  for (const provider of order) {
    if (!input.registry.supports(provider, input.sport, input.capability)) continue
    if (UNHEALTHY.has(health[provider] ?? 'healthy')) continue
    const fallbackUsed = provider !== requested
    return {
      selected: true,
      requestedProvider: requested,
      selectedProvider: provider,
      fallbackUsed,
      fallbackReason: fallbackUsed ? `primary "${requested}" unavailable (${health[requested] ?? 'unsupported'})` : null,
      order,
    }
  }
  return { selected: false, reason: `all providers for ${input.sport}/${input.capability} are unhealthy or unsupported`, order }
}
