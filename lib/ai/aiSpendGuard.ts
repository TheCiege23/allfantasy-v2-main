import { PHASE_PRODUCTION_BUILD } from 'next/constants'

/**
 * The global kill switch for OUTBOUND AI PROVIDER SPEND.
 *
 * An audit on 2026-08-20 found 84 API routes that call a provider and only 16 with an
 * entitlement or token gate: 51 were reachable by any signed-in free account and 17 had no guard
 * at all. Every one of those spends real money on the first request. Gating 84 routes one at a
 * time leaves a window open the whole time, so this closes the outbound boundary instead — where
 * there are 24 modules rather than 84 routes, and where being wrong fails safe.
 *
 * OFF BY DEFAULT, and deliberately so. An unset variable must mean "do not spend": the failure
 * this prevents is real money leaving on behalf of users who have not paid, and the cost of being
 * wrong in the other direction is a feature that is merely unavailable. Set
 * `AI_FEATURES_ENABLED=true` to allow spend.
 *
 * This is NOT the paywall. It is the master switch above it. Entitlement still decides WHICH paying
 * user may call a feature; this decides whether the platform is spending at all. Both must pass.
 */

/** Thrown when a provider call is attempted while spend is disabled. */
export class AiSpendDisabledError extends Error {
  /** Callers that map errors to responses should use 402 — this is a payment state, not a fault. */
  readonly httpStatus = 402
  readonly code = 'ai_spend_disabled'
  constructor(context: string) {
    super(
      `AI provider spend is disabled (${context}). Set AI_FEATURES_ENABLED=true to enable it. ` +
        'This is a deliberate off-by-default guard, not a misconfiguration.',
    )
    this.name = 'AiSpendDisabledError'
  }
}

/**
 * `next build` collects page data without the full runtime env and may construct clients at module
 * scope. Throwing there would break the build rather than protect anything — no request is served
 * and no provider is called during collection.
 */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD
}

/** True when the platform is permitted to spend money with an AI provider. */
export function isAiSpendEnabled(): boolean {
  return process.env.AI_FEATURES_ENABLED?.trim() === 'true'
}

/**
 * Throw unless outbound AI spend is currently permitted. Call this at a PROVIDER BOUNDARY — the
 * place a request would actually leave for OpenAI/Anthropic/DeepSeek/xAI — not in a route handler,
 * so a new route cannot bypass it by forgetting to ask.
 *
 * `context` names the boundary and appears in the error; keep it short and specific.
 */
export function assertAiSpendAllowed(context: string): void {
  if (isBuildPhase()) return
  if (isAiSpendEnabled()) return
  throw new AiSpendDisabledError(context)
}

/** Narrow an unknown error to this guard's refusal, for callers mapping it to a 402. */
export function isAiSpendDisabledError(e: unknown): e is AiSpendDisabledError {
  return e instanceof AiSpendDisabledError || (typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'ai_spend_disabled')
}
