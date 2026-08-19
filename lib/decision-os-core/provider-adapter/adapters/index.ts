/**
 * Decision OS Core — default ProviderAdapter registration (Phase 1).
 *
 * Explicit, opt-in registration only — importing this module has no side effects.
 */

import type { ProviderAdapterRegistry } from '../registry'
import { providerAdapterRegistry as defaultRegistry } from '../registry'
import { buildProviderAdapterFromFallbackPolicy } from './fromProviderFallbackPolicy'
import type { ProviderName } from '../types'

const KNOWN_PROVIDERS: ProviderName[] = [
  'rolling_insights',
  'thesportsdb',
  'clearsports',
  'sleeper',
  'allfantasy_internal',
]

export function registerDefaultProviderAdapters(
  registry: ProviderAdapterRegistry = defaultRegistry,
): void {
  for (const providerName of KNOWN_PROVIDERS) {
    registry.register(buildProviderAdapterFromFallbackPolicy(providerName))
  }
}

export { buildProviderAdapterFromFallbackPolicy } from './fromProviderFallbackPolicy'
