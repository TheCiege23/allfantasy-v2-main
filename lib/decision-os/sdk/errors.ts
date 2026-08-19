/**
 * Decision OS — Phase 7.4 Widget SDK error contract.
 *
 * Ten deterministic, typed errors. No exceptions thrown across the SDK
 * boundary — every failure mode is a typed SDKError a host app can branch on.
 *
 * ADR: PHASE_7_4_WIDGET_SDK_ADR.md
 */

import type { SDKError, SDKErrorCode } from './types'

interface SDKErrorSpec {
  message: string
  retryable: boolean
}

export const SDK_ERROR_SPECS: Readonly<Record<SDKErrorCode, SDKErrorSpec>> = {
  UNAUTHORIZED: {
    message: 'The provided credentials are not authorized for this widget.',
    retryable: false,
  },
  RATE_LIMITED: {
    message: 'Request rate limit reached for this tenant.',
    retryable: true,
  },
  PRESENTATION_MISSING: {
    message: 'No presentation data is available for this entity.',
    retryable: true,
  },
  INVALID_SCOPE: {
    message: 'The provided credentials do not carry the scope required for this widget mode.',
    retryable: false,
  },
  TENANT_MISMATCH: {
    message: 'The requested entity does not belong to the authenticated tenant.',
    retryable: false,
  },
  UNSUPPORTED_WIDGET: {
    message: 'This widget mode is not supported by the current SDK version.',
    retryable: false,
  },
  NETWORK: {
    message: 'A network error occurred while fetching presentation data.',
    retryable: true,
  },
  VERSION_MISMATCH: {
    message: 'The SDK, widget contract, or presentation version is incompatible.',
    retryable: false,
  },
  DEGRADED_DATA: {
    message: 'Presentation data is available but degraded; some sections may be unavailable.',
    retryable: true,
  },
  INCOMPLETE_PRESENTATION: {
    message: 'Presentation data is incomplete for one or more requested sections.',
    retryable: true,
  },
}

export const ALL_SDK_ERROR_CODES: readonly SDKErrorCode[] = [
  'UNAUTHORIZED', 'RATE_LIMITED', 'PRESENTATION_MISSING', 'INVALID_SCOPE',
  'TENANT_MISMATCH', 'UNSUPPORTED_WIDGET', 'NETWORK', 'VERSION_MISMATCH',
  'DEGRADED_DATA', 'INCOMPLETE_PRESENTATION',
]

/**
 * Builds a typed SDKError from an error code. Message and retryability are
 * deterministic per code; widgetId/timestamp are contextual.
 */
export function buildSDKError(
  code: SDKErrorCode,
  opts: { widgetId?: string; timestamp?: string } = {},
): SDKError {
  const spec = SDK_ERROR_SPECS[code]
  return {
    code,
    message: spec.message,
    retryable: spec.retryable,
    widgetId: opts.widgetId ?? null,
    timestamp: opts.timestamp ?? new Date().toISOString(),
  }
}

/** Whether an error code indicates the caller may retry without changing input. */
export function isRetryableErrorCode(code: SDKErrorCode): boolean {
  return SDK_ERROR_SPECS[code].retryable
}
