/**
 * Shared AI error handling — unified error codes, user-facing messages, HTTP status.
 * No provider secrets or stack traces in client responses.
 */

import type { AIModelRole } from '@/lib/unified-ai/types'
import type { AIErrorCode, UnifiedAIError } from './types'

const USER_MESSAGES: Record<AIErrorCode, string> = {
  provider_unavailable: 'Chimmy is temporarily unavailable. Please try again in a moment.',
  timeout: 'The request took too long. Please try again.',
  invalid_response: 'We received an unexpected response. Please try again.',
  rate_limited: 'Too many requests. Please wait a minute and try again.',
  fact_guard_rejected: 'This response was held back for quality. You can still use the data-only result.',
  quality_gate_failed: 'Confidence was too low to show a full recommendation. See the explanation below.',
  envelope_validation_failed: 'Invalid request. Check that all required fields are present.',
  unauthorized: 'You need to sign in to use this feature.',
  unknown: 'Something went wrong. Please try again.',
}

/**
 * Map error or string to AIErrorCode.
 */
export function toAIErrorCode(error: unknown): AIErrorCode {
  const str = String(error ?? '').toLowerCase()
  if (str.includes('timeout') || str.includes('timed out') || str.includes('abort')) return 'timeout'
  if (str.includes('rate') || str.includes('429') || str.includes('too many')) return 'rate_limited'
  if (str.includes('invalid') || str.includes('parse') || str.includes('schema') || str.includes('json')) return 'invalid_response'
  if (str.includes('unauthorized') || str.includes('401')) return 'unauthorized'
  if (str.includes('envelope') || str.includes('validation')) return 'envelope_validation_failed'
  if (str.includes('provider') || str.includes('unavailable')) return 'provider_unavailable'
  return 'unknown'
}

/**
 * Build UnifiedAIError for client. userMessage is safe to display; message may be technical.
 */
export function toUnifiedAIError(
  code: AIErrorCode,
  options?: { message?: string; provider?: AIModelRole; traceId?: string; details?: Record<string, unknown> }
): UnifiedAIError {
  return {
    code,
    message: options?.message ?? code,
    userMessage: USER_MESSAGES[code],
    provider: options?.provider,
    traceId: options?.traceId,
    details: options?.details,
  }
}

/**
 * HTTP status for error code. 400 validation, 401 auth, 429 rate limit, 503 provider/timeout.
 */
export function toHttpStatus(code: AIErrorCode): number {
  switch (code) {
    case 'envelope_validation_failed':
    case 'fact_guard_rejected':
    case 'quality_gate_failed':
      return 400
    case 'unauthorized':
      return 401
    case 'rate_limited':
      return 429
    case 'provider_unavailable':
    case 'timeout':
    case 'invalid_response':
      return 503
    default:
      return 500
  }
}

/**
 * Create error from thrown unknown. Uses toAIErrorCode and toUnifiedAIError.
 */
export function fromThrown(error: unknown, traceId?: string): UnifiedAIError {
  const code = toAIErrorCode(error)
  const message = error instanceof Error ? error.message : String(error)
  return toUnifiedAIError(code, { message: message.slice(0, 500), traceId })
}
