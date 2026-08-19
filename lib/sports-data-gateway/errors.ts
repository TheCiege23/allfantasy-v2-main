/**
 * Fantasy OS Phase 5 — deterministic error classification + provider result envelope.
 *
 * Every adapter method returns a ProviderResult so failures are structured, never thrown into OS consumers.
 * The gateway classifies failures deterministically and NEVER fabricates data on failure (fails closed).
 */
export type GatewayErrorCode =
  | 'unsupported_capability'
  | 'not_configured'
  | 'authentication_failed'
  | 'rate_limited'
  | 'timeout'
  | 'schema_mismatch'
  | 'not_found'
  | 'partial'
  | 'provider_unavailable'
  | 'unknown'

export type GatewayError = {
  code: GatewayErrorCode
  provider: string
  message: string
  retriable: boolean
}

export type ProviderResult<T> =
  | { ok: true; provider: string; data: T; partial: boolean; fetchedAt: string; snapshotVersion: string }
  | { ok: false; provider: string; error: GatewayError }

export function unsupported(provider: string, detail: string): ProviderResult<never> {
  return { ok: false, provider, error: { code: 'unsupported_capability', provider, message: detail, retriable: false } }
}

export function notConfigured(provider: string, detail: string): ProviderResult<never> {
  return { ok: false, provider, error: { code: 'not_configured', provider, message: detail, retriable: false } }
}

const RETRIABLE: ReadonlySet<GatewayErrorCode> = new Set(['rate_limited', 'timeout', 'provider_unavailable'])

/** Classify a thrown/HTTP failure into a deterministic gateway error. */
export function classifyError(provider: string, err: unknown, httpStatus?: number): GatewayError {
  if (httpStatus === 401 || httpStatus === 403) return mk('authentication_failed', provider, `HTTP ${httpStatus}`)
  if (httpStatus === 429) return mk('rate_limited', provider, 'HTTP 429')
  if (httpStatus === 404) return mk('not_found', provider, 'HTTP 404')
  if (httpStatus && httpStatus >= 500) return mk('provider_unavailable', provider, `HTTP ${httpStatus}`)
  const msg = err instanceof Error ? err.message : String(err ?? 'unknown error')
  if (/abort|timeout/i.test(msg)) return mk('timeout', provider, msg)
  if (/schema|validation|unexpected (shape|field)/i.test(msg)) return mk('schema_mismatch', provider, msg)
  return mk('unknown', provider, msg)
}

function mk(code: GatewayErrorCode, provider: string, message: string): GatewayError {
  return { code, provider, message, retriable: RETRIABLE.has(code) }
}
