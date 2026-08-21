/**
 * Canonical Decision OS contract — PURE barrel (Phase 3A). Re-exports the provider-agnostic contract, taxonomy,
 * identity, validation, priority, shadow flag, adapters, and connected-franchise types. It deliberately does NOT
 * re-export `prismaDecisionStore` (server-only, DB-touching), mirroring the Phase 2 `phase2/index.ts` convention
 * so importing this barrel stays inert (no DB, no provider, no token/freshness work). Import the Prisma store
 * directly from `./prismaDecisionStore` on the server only.
 */
export * from './contract'
export * from './taxonomy'
export * from './identity'
export * from './validate'
export * from './priority'
export * from './shadowFlag'
export * from './decisionStore'
export * from './adapters'
export * from './connectedFranchise'
