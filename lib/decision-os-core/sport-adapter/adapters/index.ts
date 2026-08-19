/**
 * Decision OS Core — default SportAdapter registration (Phase 1).
 *
 * Explicit, opt-in registration only. Importing this module has no side effects;
 * callers must call `registerDefaultSportAdapters()` themselves. Nothing in the
 * existing app imports this yet.
 */

import { SPORT_CONFIGS } from '@/lib/sportConfig'
import type { SportAdapterRegistry } from '../registry'
import { sportAdapterRegistry as defaultRegistry } from '../registry'
import { buildSportAdapterFromConfig } from './fromSportConfig'

/**
 * Registers a SportAdapter for every sport currently defined in `lib/sportConfig`
 * (NFL, NCAAF, NBA, NCAAB, MLB, NHL, SOCCER, GOLF, NASCAR, WWE, CRICKET,
 * HORSE_RACING, TENNIS) against the given registry (defaults to the shared
 * singleton). Skips any sport that fails to build rather than throwing.
 */
export function registerDefaultSportAdapters(
  registry: SportAdapterRegistry = defaultRegistry,
): void {
  for (const sportKey of Object.keys(SPORT_CONFIGS)) {
    const adapter = buildSportAdapterFromConfig(sportKey)
    if (adapter) registry.register(adapter)
  }
}

export { buildSportAdapterFromConfig } from './fromSportConfig'
