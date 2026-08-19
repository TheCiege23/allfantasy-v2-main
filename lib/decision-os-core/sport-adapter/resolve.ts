/**
 * Decision OS Core — SportAdapter resolution helper (Phase 1 follow-up).
 *
 * Checks the shared registry first (so a caller that explicitly registered a
 * custom/overriding adapter wins), falling back to the stateless
 * `buildSportAdapterFromConfig` factory when nothing has been registered —
 * which is the default, real-world state today, since nothing calls
 * `registerDefaultSportAdapters()` yet. This makes resolution correct
 * regardless of registration order/timing, which matters for the first real
 * consumer (`lib/decision-os/commissioner-health/dco.ts`).
 */

import type { SportAdapter } from './types'
import type { SportAdapterRegistry } from './registry'
import { sportAdapterRegistry as defaultRegistry } from './registry'
import { buildSportAdapterFromConfig } from './adapters/fromSportConfig'

/** Never throws — returns null when the sport is unknown to both the registry and the config factory. */
export function resolveSportAdapter(
  sport: string,
  registry: SportAdapterRegistry = defaultRegistry,
): SportAdapter | null {
  return registry.tryResolve(sport) ?? buildSportAdapterFromConfig(sport)
}
