/**
 * Decision OS three-brain — Phase 2 managed-intelligence layer (DB-first persistence, freshness, single-flight
 * coalescing, entitlement gating, idempotent token safety). STANDALONE — not wired to any live Decision OS
 * route or Chimmy (Phase 3/4).
 *
 * This barrel exports the PURE contracts + service. The production adapters live in `./realAdapters` (marked
 * `server-only`) and are imported directly by the Phase 3 wiring — intentionally NOT re-exported here so this
 * barrel stays importable in non-server contexts and tests.
 */
export * from './types'
export * from './requestIdentity'
export * from './freshnessPolicy'
export * from './failureClassification'
export * from './entitlementPolicy'
export * from './tokenGuard'
export * from './resultStore'
export * from './observability'
export * from './intelligenceService'
