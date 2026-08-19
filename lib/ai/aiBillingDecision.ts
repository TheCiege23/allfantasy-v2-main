/**
 * AiBillingDecision — central billing intent helper.
 *
 * Given the outcome of an AI response (provider, validator result, user plan),
 * returns a typed decision about whether a token should be charged and why.
 *
 * Rules (in priority order):
 *  1. Deterministic / policy path → no charge (no AI cost incurred)
 *  2. Cache hit → no charge (LLM was skipped)
 *  3. Provider unavailable → no charge (nothing delivered)
 *  4. Validator blocked → no charge (bad output, no value delivered)
 *  5. LLM called + active paid subscription → covered by plan, no deduction
 *  6. LLM called + no subscription → token should be charged
 *
 * This helper is intentionally synchronous and side-effect-free.
 * Actual token deduction must happen via TokenSpendService.spendTokensForRule().
 *
 * Do NOT bypass grounding / validator / audit logging.
 * Do NOT duplicate AI logic — this is the single source of billing truth.
 */

/** All possible billing intent reasons */
export type AiBillingReason =
  | "deterministic"         // answered from policy/rules — no AI cost
  | "cache_hit"             // answered from cache — LLM was skipped
  | "llm_required"          // LLM was called — token charge applies
  | "premium_plan_included" // LLM was called but covered by subscription
  | "validator_blocked"     // LLM called but response blocked — no useful output
  | "provider_missing"      // LLM attempted but provider was unavailable
  | "error"                 // unexpected state — no charge

export type AiBillingDecision = {
  /** Whether a token should be deducted for this response */
  shouldChargeToken: boolean
  /** Machine-readable reason for the billing decision */
  reason: AiBillingReason
  /**
   * Human-readable hint for the UI bubble.
   *
   * Examples:
   *   "No token used · answered from pool data"
   *   "No token used · cached insight"
   *   "Included in your plan · AI answer"
   *   "1 token used · AI coaching answer"
   */
  displayHint: string
}

/** Provider names that never involve an LLM (deterministic or policy paths) */
const DETERMINISTIC_PROVIDERS = new Set(["deterministic", "policy", "sports-cache"])

/** Provider names that represent a cache hit (LLM was skipped) */
const CACHE_PROVIDERS = new Set(["cache"])

/** Provider names that represent an unavailable / failed AI path */
const UNAVAILABLE_PROVIDERS = new Set(["unavailable"])

/** Plan values that indicate an active paid subscription */
const PAID_PLANS = new Set(["pro", "commissioner", "war_room", "supreme"])

const HINTS: Record<AiBillingReason, string> = {
  deterministic:         "No token used · answered from pool data",
  cache_hit:             "No token used · cached insight",
  llm_required:          "1 token used · AI coaching answer",
  premium_plan_included: "Included in your plan · AI answer",
  validator_blocked:     "No token used · response filtered",
  provider_missing:      "No token used · AI unavailable",
  error:                 "No token used · error",
}

/**
 * Resolve the billing decision for a single AI interaction.
 *
 * @param input.provider       The providerSource from the AI service
 *                             ("deterministic", "policy", "cache", "openai", "anthropic", …)
 * @param input.validatorBlocked  Whether the validator blocked the LLM response
 * @param input.plan           The user's subscription plan (null/undefined/"free" → token-based)
 */
export function resolveBillingDecision(input: {
  provider: string
  validatorBlocked?: boolean
  plan?: string | null
}): AiBillingDecision {
  const { provider, validatorBlocked = false, plan } = input

  if (DETERMINISTIC_PROVIDERS.has(provider)) {
    return { shouldChargeToken: false, reason: "deterministic", displayHint: HINTS.deterministic }
  }

  if (CACHE_PROVIDERS.has(provider)) {
    return { shouldChargeToken: false, reason: "cache_hit", displayHint: HINTS.cache_hit }
  }

  if (UNAVAILABLE_PROVIDERS.has(provider)) {
    return { shouldChargeToken: false, reason: "provider_missing", displayHint: HINTS.provider_missing }
  }

  // At this point the LLM was invoked (openai, anthropic, gemini, etc.)

  // Validator-blocked check precedes plan check — blocked output has no value regardless of plan.
  if (validatorBlocked) {
    return { shouldChargeToken: false, reason: "validator_blocked", displayHint: HINTS.validator_blocked }
  }

  // Active subscription plan — LLM cost is absorbed by the platform, no token deduction.
  if (plan && PAID_PLANS.has(plan)) {
    return {
      shouldChargeToken: false,
      reason: "premium_plan_included",
      displayHint: HINTS.premium_plan_included,
    }
  }

  // LLM was called, validator passed, no subscription — token must be charged.
  return { shouldChargeToken: true, reason: "llm_required", displayHint: HINTS.llm_required }
}
