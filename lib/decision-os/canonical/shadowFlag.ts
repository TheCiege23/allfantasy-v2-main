/**
 * Phase 3A canonical-decision SHADOW activation flag. PURE (reads env, no I/O).
 *
 * OFF BY DEFAULT: the shadow persistence path does nothing unless this env var is EXACTLY the string 'true'
 * (missing / '' / 'false' / '1' / 'yes' / any other value → disabled), matching the reviewed maintenance-cron
 * idiom. This flag is INDEPENDENT of `DECISION_OS_MAINTENANCE_ENABLED` — enabling shadow writes never enables the
 * maintenance runner and vice-versa. Server-side only; never expose on a client-readable env surface.
 */
export const CANONICAL_SHADOW_FLAG = 'DECISION_OS_CANONICAL_SHADOW_ENABLED' as const

/** True only when shadow persistence has been explicitly enabled. Default (absent) is disabled. */
export function canonicalShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CANONICAL_SHADOW_FLAG] === 'true'
}
