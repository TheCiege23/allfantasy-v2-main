/**
 * Kill switches for the read-side cost fixes (P4/P5 stage A of the 2026-10-24 database audit).
 *
 * Each optimisation returns exactly what the code returned before, with fewer queries or fewer
 * bytes. If one misbehaves in production it can be turned back into its previous behaviour on its
 * own, without a code change:
 *
 *   AF_READ_OPTIMIZATIONS_OFF=value-combos                    one path
 *   AF_READ_OPTIMIZATIONS_OFF=draft-facts,injury-alerts       several
 *   AF_READ_OPTIMIZATIONS_OFF=all                             every one
 *
 *   value-combos   domain-os-refresh: SELECT DISTINCT in Postgres instead of Prisma's in-memory distinct
 *   draft-facts    psych profiles: one league draft-facts read per league refresh, not one per manager
 *   injury-alerts  injury alerts: batched observation/receipt reads, no `raw` column, no recipient
 *                  lookup for a row that has no team
 *
 * Unset (the default) means every optimisation is ON. The value is read on every call.
 *
 * ⚠ SET IT ON THE SERVICE THAT RUNS THE PATH. All three run in crons on `allfantasy-v2-worker`
 * (the profile refresh can also be started from the web service). Setting a Railway variable
 * redeploys that service. An unrecognised name is ignored, so read the value back after setting it.
 */
export const READ_OPTIMIZATIONS = ['value-combos', 'draft-facts', 'injury-alerts'] as const
export type ReadOptimization = (typeof READ_OPTIMIZATIONS)[number]

export function readOptimizationEnabled(
  name: ReadOptimization,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = String(env.AF_READ_OPTIMIZATIONS_OFF ?? '').trim().toLowerCase()
  if (!raw) return true
  const off = new Set(raw.split(/[\s,]+/).filter(Boolean))
  return !(off.has('all') || off.has(name))
}
