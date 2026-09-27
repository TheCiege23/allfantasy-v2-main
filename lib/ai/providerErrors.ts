/**
 * Provider error classification for the AI fallback router.
 * Determines whether an error from a provider should trigger fallback to the
 * next provider, or halt (e.g. content policy refusal).
 */

import { isAiSpendDisabledError } from '@/lib/ai/aiSpendGuard'

export type ProviderErrorCategory =
  | 'billing'        // credits exhausted, payment required
  | 'rate_limit'     // 429 / quota exceeded
  | 'overload'       // 529 or server-side throttle
  | 'server_error'   // 5xx
  | 'unavailable'    // no API key, client not configured
  | 'timeout'        // network / connection timeout
  | 'content_filter' // safety / policy refusal — NOT fallback eligible
  | 'spend_disabled' // AI_FEATURES_ENABLED kill switch — NOT fallback eligible
  | 'auth'           // invalid API key (provider-level)
  | 'unknown'

export type NormalizedProviderError = {
  category: ProviderErrorCategory
  status: number | null
  message: string
  fallbackEligible: boolean
}

function getStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const e = error as Record<string, unknown>
  if (typeof e.status === 'number') return e.status
  if (typeof e.statusCode === 'number') return e.statusCode
  return null
}

function getMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export function normalizeProviderError(error: unknown): NormalizedProviderError {
  const status = getStatus(error)
  const message = getMessage(error)
  const lower = message.toLowerCase()
  const code = String((error as Record<string, unknown>)?.code ?? '').toLowerCase()

  // The AI spend kill switch — NOT fallback eligible. It is one global switch, so every other provider
  // is off too; falling through would only reach a provider whose own guard was missing (the router's
  // inline Anthropic adapter was exactly that until 2026-09-27). Checked first: the refusal carries no
  // HTTP status, so left to the rules below it lands in `unknown`, which falls back.
  if (isAiSpendDisabledError(error)) {
    return { category: 'spend_disabled', status, message, fallbackEligible: false }
  }

  // Content filter / safety — NOT fallback eligible (other providers would also refuse)
  if (
    (status === 400 &&
      /content.filter|safety.system|policy.violation|harmful.content|inappropriate|usage.polic|violates.{0,40}polic/i.test(lower)) ||
    /content_filter|safety_error|policy_violation/.test(code)
  ) {
    return { category: 'content_filter', status, message, fallbackEligible: false }
  }

  // Billing / credits exhausted (includes Anthropic's HTTP 400 "credit balance" error)
  if (
    status === 402 ||
    (status === 400 && /credit.balance|insufficient.quota|billing|credits/i.test(lower)) ||
    /insufficient_quota|billing_not_active|account_deactivated/.test(code)
  ) {
    return { category: 'billing', status, message, fallbackEligible: true }
  }

  // Rate limit
  if (
    status === 429 ||
    /rate.limit|too.many.requests|quota.exceeded/.test(lower) ||
    code === 'rate_limit_exceeded'
  ) {
    return { category: 'rate_limit', status, message, fallbackEligible: true }
  }

  // Anthropic-specific overload
  if (status === 529 || /overloaded/i.test(lower)) {
    return { category: 'overload', status, message, fallbackEligible: true }
  }

  // Auth at provider level — invalid API key means try the next provider's key
  if (status === 401) {
    return { category: 'auth', status, message, fallbackEligible: true }
  }

  // Provider not configured / service unavailable
  if (
    status === 503 ||
    /not.configured|unavailable|not.set|missing.*key|set.*api.key|provider.*unavailable/i.test(lower)
  ) {
    return { category: 'unavailable', status, message, fallbackEligible: true }
  }

  // Timeout / network errors
  if (
    error instanceof TypeError ||
    /timeout|timed.out|etimedout|econnreset|econnrefused|network|failed.to.fetch/i.test(lower)
  ) {
    return { category: 'timeout', status: null, message, fallbackEligible: true }
  }

  // Server errors
  if (status != null && status >= 500) {
    return { category: 'server_error', status, message, fallbackEligible: true }
  }

  return { category: 'unknown', status, message, fallbackEligible: true }
}

export function isProviderFallbackEligible(error: unknown): boolean {
  return normalizeProviderError(error).fallbackEligible
}
