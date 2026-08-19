/**
 * 2G — Normalized failure classification. Determines (a) whether an orchestration OUTCOME counts as a
 * persistable success, and (b) the category + retryability of any failure or thrown error. A run that did not
 * produce a genuine synthesis is NEVER stored as a reusable success and NEVER finalizes a token charge.
 */
import type { ThreeBrainDecisionResult } from '../types'
import type { IntelligenceFailureCategory } from './types'

export type OrchestrationOutcome =
  | { success: true }
  | { success: false; category: IntelligenceFailureCategory; retryable: boolean; message: string }

/**
 * A genuine synthesis exists iff OpenAI completed OR Claude produced a fallback synthesis. `deterministic_only`
 * (both specialists down) and a degraded run with no fallback are NOT reusable successes — they must recompute
 * later and must not be billed.
 */
export function isSuccessfulOrchestration(result: ThreeBrainDecisionResult): boolean {
  return result.specialistStatus.openai === 'completed' || result.claudeState === 'fallback_synthesis'
}

export function classifyOrchestrationOutcome(result: ThreeBrainDecisionResult): OrchestrationOutcome {
  if (isSuccessfulOrchestration(result)) return { success: true }
  if (result.agreementState === 'deterministic_only') {
    return {
      success: false,
      category: 'provider_unavailable',
      retryable: true,
      message: 'Both specialist models were unavailable; no synthesis was produced.',
    }
  }
  return {
    success: false,
    category: 'synthesis_failure',
    retryable: true,
    message: 'Synthesis was unavailable and no fallback synthesis succeeded.',
  }
}

/** Map a thrown error to a normalized category (never leaks the raw message beyond a short, safe summary). */
export function classifyError(error: unknown): {
  category: IntelligenceFailureCategory
  retryable: boolean
  message: string
} {
  const raw = error instanceof Error ? error.message : String(error ?? 'error')
  const msg = raw.slice(0, 200)
  const lower = raw.toLowerCase()

  if (/timeout|timed out|abort/.test(lower)) return { category: 'provider_timeout', retryable: true, message: msg }
  if (/rate.?limit|429|too many/.test(lower)) return { category: 'provider_rate_limit', retryable: true, message: msg }
  if (/unavailable|econn|network|fetch failed|502|503|504/.test(lower))
    return { category: 'provider_unavailable', retryable: true, message: msg }
  if (/prisma|database|db |persist|unique constraint|p20\d\d/.test(lower))
    return { category: 'persistence_failure', retryable: true, message: msg }
  if (/invalid|schema|parse|validation/.test(lower))
    return { category: 'invalid_provider_output', retryable: true, message: msg }
  return { category: 'internal', retryable: false, message: msg }
}
