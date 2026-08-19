/**
 * Decision OS Core — ProviderAdapter factory built from existing fallback policy (Phase 1).
 *
 * Derives adapter metadata (which domains/sports each provider supports) from the
 * existing `lib/providers/providerFallbackPolicy.ts` fallback chains — the source
 * of truth is unchanged, this only exposes it through the registry contract.
 *
 * `fetch()` is intentionally NOT wired to real provider clients in Phase 1 (that
 * would touch live integration code, out of scope per
 * docs/DECISION_OS_CORE_UNIFICATION_PLAN.md §9/§18 step 1). Calling it throws a
 * clear, typed error so any accidental future wiring fails loudly instead of
 * silently returning fabricated data.
 */

import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import {
  getFallbackProvidersForDomain,
  type DataDomain as LegacyDataDomain,
  type ProviderName as LegacyProviderName,
} from '@/lib/providers/providerFallbackPolicy'
import type { DataDomain, ProviderAdapter, ProviderName } from '../types'

const ALL_DOMAINS: LegacyDataDomain[] = [
  'player_profile',
  'player_images',
  'team_profile',
  'team_logos',
  'player_stats',
  'team_stats',
  'projections',
  'live_scoring',
  'injuries',
  'schedules',
  'games',
  'adp',
  'ai_adp',
  'rookie_experience',
  'waiver_value',
  'trade_value',
  'roster_context',
  'lineup_context',
]

export class ProviderFetchNotWiredError extends Error {
  constructor(providerName: string, domain: string) {
    super(
      `ProviderAdapter.fetch() is not wired in Phase 1 (provider=${providerName}, domain=${domain}). ` +
        'This registry only exposes fallback-policy metadata; see docs/DECISION_OS_CORE_UNIFICATION_PLAN.md §9.',
    )
    this.name = 'ProviderFetchNotWiredError'
  }
}

/**
 * Builds a ProviderAdapter for a known ProviderName by deriving supportedDomains
 * from `getFallbackProvidersForDomain` across all known domains (using the
 * default sport, since the current fallback chains do not vary provider
 * membership by sport — only tier order, which this adapter does not need).
 */
export function buildProviderAdapterFromFallbackPolicy(providerName: ProviderName): ProviderAdapter {
  const supportedDomains = ALL_DOMAINS.filter((domain) =>
    getFallbackProvidersForDomain(domain, 'NFL').includes(providerName as LegacyProviderName),
  ) as DataDomain[]

  return {
    providerName,
    supportedSports: [...SUPPORTED_SPORTS],
    supportedDomains,
    async fetch<T>(domain: DataDomain, _sport: string, _params: Record<string, unknown>): Promise<T | null> {
      throw new ProviderFetchNotWiredError(providerName, domain)
    },
  }
}
