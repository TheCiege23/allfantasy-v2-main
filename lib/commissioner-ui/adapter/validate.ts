import type { CommissionerErrorContract, CommissionerPlatformResponse } from '../contracts'

const VALID_SOURCES = new Set(['stub', 'demo', 'live'])
const VALID_ERROR_CATEGORIES = new Set([
  'validation',
  'not_found',
  'unauthorized',
  'forbidden',
  'conflict',
  'upstream_unavailable',
  'unknown',
])

function isWellFormedError(value: unknown): value is CommissionerErrorContract {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.category === 'string' &&
    VALID_ERROR_CATEGORIES.has(candidate.category) &&
    typeof candidate.message === 'string' &&
    typeof candidate.retryable === 'boolean' &&
    typeof candidate.timestamp === 'string'
  )
}

/**
 * A structural guard, not a schema library — consistent with this
 * program's existing hand-rolled style (`isCommissionerResponseOk` in
 * Platform Contracts' response.ts), rather than introducing a new
 * validation dependency for a subsystem that has never used one.
 */
export function isWellFormedResponse<T>(value: unknown): value is CommissionerPlatformResponse<T> {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (!('data' in candidate) || !('error' in candidate) || !('source' in candidate) || !('timestamp' in candidate)) return false
  if (typeof candidate.source !== 'string' || !VALID_SOURCES.has(candidate.source)) return false
  if (typeof candidate.timestamp !== 'string' || Number.isNaN(Date.parse(candidate.timestamp))) return false
  if (candidate.error !== null && !isWellFormedError(candidate.error)) return false
  return true
}
