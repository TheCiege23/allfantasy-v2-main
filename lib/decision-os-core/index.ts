/**
 * Decision OS Core (Phase 1) — barrel export.
 *
 * IMPORTANT: nothing in the existing app imports this barrel (or any file under
 * `lib/decision-os-core/`) yet. This is intentional — see
 * docs/DECISION_OS_CORE_UNIFICATION_PLAN.md §18. A test
 * (`__tests__/no-live-imports.test.ts`) enforces that invariant.
 */

export * from './primitives/types'
export * from './events/types'
export * from './context/types'
export * from './results/types'

export type { SportAdapter } from './sport-adapter/types'
export { UnknownSportAdapterError } from './sport-adapter/types'
export { SportAdapterRegistry, sportAdapterRegistry } from './sport-adapter/registry'
export { registerDefaultSportAdapters, buildSportAdapterFromConfig } from './sport-adapter/adapters'
export { resolveSportAdapter } from './sport-adapter/resolve'

export type { ProviderAdapter, DataDomain, ProviderName } from './provider-adapter/types'
export { UnknownProviderAdapterError } from './provider-adapter/types'
export { ProviderAdapterRegistry, providerAdapterRegistry } from './provider-adapter/registry'
export {
  registerDefaultProviderAdapters,
  buildProviderAdapterFromFallbackPolicy,
} from './provider-adapter/adapters'
