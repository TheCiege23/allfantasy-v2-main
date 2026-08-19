/**
 * Decision OS — Phase 7.6 Widget Runtime Core: error mapper.
 *
 * Classifies runtime/HTTP failure reasons into the deterministic SDKErrorCode
 * taxonomy (Phase 7.4), then delegates to the frozen `buildSDKError()` for
 * the actual SDKError object — this module never invents a message or
 * retryability value; those live only in `lib/decision-os/sdk/errors.ts`.
 */

import { buildSDKError } from '../../../lib/decision-os/sdk/errors'
import type { SDKError, SDKErrorCode } from '../../../lib/decision-os/sdk/types'

export type HttpFailureReason =
  | { kind: 'network'; detail: string }
  | { kind: 'http_status'; status: number }
  | { kind: 'parse_error'; detail: string }
  | { kind: 'malformed_body' }
  | { kind: 'tenant_mismatch'; expectedEntityId: string; actualEntityId: string }

/**
 * HTTP status → SDKErrorCode. Statuses not in this map (including the
 * generic 5xx family beyond 503) classify as 'NETWORK' — a transport-level
 * failure from the caller's perspective.
 */
const STATUS_CODE_MAP: Readonly<Record<number, SDKErrorCode>> = {
  401: 'UNAUTHORIZED',
  403: 'INVALID_SCOPE',
  404: 'PRESENTATION_MISSING',
  429: 'RATE_LIMITED',
  503: 'PRESENTATION_MISSING',
}

/** Deterministically classifies an HTTP status code into an SDKErrorCode. */
export function classifyHttpStatus(status: number): SDKErrorCode {
  return STATUS_CODE_MAP[status] ?? 'NETWORK'
}

/**
 * Deterministically classifies a failure reason into an SDKErrorCode.
 * 'network' and 'parse_error' both classify as NETWORK today — kept as
 * distinct reason kinds so the classification can diverge later without
 * changing the HttpFailureReason contract.
 */
export function classifyFailureReason(reason: HttpFailureReason): SDKErrorCode {
  switch (reason.kind) {
    case 'network':
      return 'NETWORK'
    case 'http_status':
      return classifyHttpStatus(reason.status)
    case 'parse_error':
      return 'NETWORK'
    case 'malformed_body':
      return 'INCOMPLETE_PRESENTATION'
    case 'tenant_mismatch':
      return 'TENANT_MISMATCH'
  }
}

/**
 * Maps a runtime/HTTP failure reason to a typed SDKError, using the frozen
 * Phase 7.4 `buildSDKError()` for message/retryability — this function only
 * decides WHICH code applies; it never sets message/retryable itself.
 */
export function mapHttpFailureToSDKError(
  reason: HttpFailureReason,
  opts: { widgetId?: string; timestamp?: string } = {},
): SDKError {
  const code = classifyFailureReason(reason)
  return buildSDKError(code, opts)
}
