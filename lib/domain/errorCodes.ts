/**
 * Commissioner OS · error code literals.
 *
 * A definition site holding constants and nothing else, so that `errors.ts`
 * (the union and its HTTP mapping) and `db.ts` (which throws across a
 * transaction boundary) can both name `TENANT_MISMATCH` without importing each
 * other. Without the split, `db.ts` → `errors.ts` → `db.ts` is a cycle that
 * resolves at type level and bites at runtime under some bundlers.
 */

export const TENANT_MISMATCH = 'TENANT_MISMATCH' as const
