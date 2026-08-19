/**
 * Decision OS — Phase 7.9 Iframe Adapter: origin validation helpers.
 *
 * Pure functions only — no `window.postMessage` calls, no `window.location`
 * reads. A future runtime calls these before trusting an inbound message or
 * before sending an outbound one.
 */

/**
 * Origin format: `scheme://host[:port]` — no path, no query, no hash, no
 * trailing slash. Matches the WHATWG origin serialization.
 */
const ORIGIN_FORMAT_RE = /^https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/

export function isValidOriginFormat(origin: string): boolean {
  return ORIGIN_FORMAT_RE.test(origin)
}

export interface OriginValidationResult {
  valid: boolean
  errors: string[]
}

export function validateOriginFormat(origin: string): OriginValidationResult {
  const errors: string[] = []
  if (origin === '*') {
    errors.push("origin must not be the wildcard '*'")
  } else if (!isValidOriginFormat(origin)) {
    errors.push(`origin '${origin}' is not a valid scheme://host[:port] origin`)
  }
  return { valid: errors.length === 0, errors }
}

/**
 * Exact-match allowlist check — NEVER a substring/prefix check. A naive
 * `.includes()` or `.startsWith()` check would let
 * 'https://evil.example.com.attacker.com' bypass an allowlist entry for
 * 'https://example.com'.
 */
export function isOriginAllowed(origin: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.includes(origin)
}

/**
 * Throws if `targetOrigin` is the wildcard `'*'`. A future runtime calls
 * this immediately before every `window.postMessage(data, targetOrigin)` —
 * outbound messages must always specify an explicit origin
 * (PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md §2).
 */
export function assertExplicitTargetOrigin(targetOrigin: string): void {
  if (targetOrigin === '*') {
    throw new Error('postMessage targetOrigin must never be "*" — always specify an explicit origin.')
  }
}
