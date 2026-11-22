/**
 * Opt-in runtime checks for production/cron paths (set ENGINE_INVARIANT_CHECKS=1).
 * Logs violations; does not throw (avoid breaking user flows unless callers choose to).
 */

import type { InvariantResult } from '@/lib/engine-testing/hardening/engineInvariants'

function isEngineInvariantRuntimeChecksEnabled(): boolean {
  const v = process.env.ENGINE_INVARIANT_CHECKS?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * When enabled and the invariant fails, logs a structured warning (Sentry/console).
 * Callers may still enforce errors separately (API validation, etc.).
 */
export function logEngineInvariantOptional(
  result: InvariantResult,
  context: string,
  meta?: Record<string, unknown>,
): void {
  if (!isEngineInvariantRuntimeChecksEnabled()) return
  if (result.ok) return
  const payload = {
    context,
    code: result.code,
    message: result.message,
    ...meta,
  }
  console.warn('[engine-invariant]', JSON.stringify(payload))
}
