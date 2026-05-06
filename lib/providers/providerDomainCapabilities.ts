/**
 * Explains which provider tier applies per domain — complements static vendor maps in
 * `clearSportsFieldMaps`, `theSportsDbCapabilities`, etc.
 */

import type { DataDomain, ProviderName } from '@/lib/providers/providerFallbackPolicy'
import {
  getFallbackProvidersForDomain,
  getPrimaryProviderForDomain,
  isProviderAllowedForDomain,
} from '@/lib/providers/providerFallbackPolicy'

export type ProviderDomainRole = 'primary' | 'fallback' | 'not_in_chain'

/** Role of `provider` for each domain on this sport (rollup view). */
export function getProviderCapabilityRoles(
  provider: ProviderName,
  sport: string,
): Partial<Record<DataDomain, ProviderDomainRole>> {
  const domains: DataDomain[] = [
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
  const out: Partial<Record<DataDomain, ProviderDomainRole>> = {}
  for (const d of domains) {
    const chain = getFallbackProvidersForDomain(d, sport)
    const idx = chain.indexOf(provider)
    if (idx < 0) out[d] = 'not_in_chain'
    else if (idx === 0) out[d] = 'primary'
    else out[d] = 'fallback'
  }
  return out
}

/** Human-readable single-domain explanation for docs/diagnostics. */
export function explainProviderCapability(provider: ProviderName, domain: DataDomain, sport: string): string {
  if (!isProviderAllowedForDomain(provider, domain, sport)) {
    return `${provider} is not in the fallback chain for ${domain} (${sport}).`
  }
  const primary = getPrimaryProviderForDomain(domain, sport)
  if (provider === primary) return `${provider} is primary for ${domain} (${sport}).`
  return `${provider} is a fallback for ${domain} (${sport}) after higher-tier sources.`
}

export function providerSupportsDomain(provider: ProviderName, domain: DataDomain, sport: string): boolean {
  return isProviderAllowedForDomain(provider, domain, sport)
}
