/**
 * Phase 1 — single source of truth for "does this user have AI access right now?"
 *
 * Layers (highest precedence first):
 *   1. Active paid subscription that includes the `ai_chat` feature
 *      (resolved via `EntitlementResolver` — also covers admin grants).
 *   2. 10-day signup trial — derived from `appUser.createdAt`.
 *      No new schema; future phases can promote this to an explicit
 *      `trialEndsAt` column or `AdminSubscriptionGrant{grantType:'trial'}`.
 *   3. Token balance — user can spend AF tokens per AI action.
 *
 * Callers use:
 *   - `AIAccessResolver.resolveForUser(...)` for server-side gating decisions.
 *   - The shape returned here is what `/api/ai/access` exposes to the UI so the
 *     dashboard can show "X tokens" / "Y days left in trial" / "Upgrade".
 *
 * IMPORTANT product rule: never surface winnings; always show remaining tokens.
 */

import { EntitlementResolver, type EntitlementSnapshot } from '@/lib/subscription/EntitlementResolver'
import { TokenSpendService } from '@/lib/tokens/TokenSpendService'

export const AI_TRIAL_DAYS = 10
export const AI_TRIAL_MS = AI_TRIAL_DAYS * 24 * 60 * 60 * 1000

export type AIAccessReason =
  | 'subscription_active'
  | 'in_trial'
  | 'tokens_available'
  | 'no_access'

export type AIAccessStatus = {
  hasAccess: boolean
  reason: AIAccessReason
  /** Truthy when an active AI-eligible subscription is in effect. */
  hasSubscription: boolean
  subscription: EntitlementSnapshot
  /** Trial details derived from signup date. */
  trial: {
    inTrial: boolean
    daysRemaining: number
    /** ISO timestamp; null if signup date unknown. */
    endsAt: string | null
  }
  /** Spendable token balance (0 if no row). */
  tokenBalance: number
  /** Convenience copy for the UI badge. */
  message: string
}

const FEATURE_ID = 'ai_chat' as const

/**
 * The ONE definition of "this account is inside its free AI trial".
 *
 * ⚠ EXPORTED SO THE TOKEN GRANT ASKS THE SAME QUESTION THIS RESOLVER DOES. A
 * second copy of `createdAt + AI_TRIAL_MS > now` living next to the grant would
 * be two definitions of the trial, free to drift — and the visible symptom of
 * that drift is a badge reading "Trial · 3d left" above a balance that quietly
 * stopped being topped up, which is precisely the mismatch the grant exists to
 * remove.
 */
export function isInAiTrial(createdAt: Date | null | undefined, now: Date): boolean {
  if (!createdAt) return false
  return createdAt.getTime() + AI_TRIAL_MS > now.getTime()
}

function computeTrial(createdAt: Date | null | undefined, now: Date): AIAccessStatus['trial'] {
  if (!createdAt) {
    return { inTrial: false, daysRemaining: 0, endsAt: null }
  }
  const ends = new Date(createdAt.getTime() + AI_TRIAL_MS)
  if (!isInAiTrial(createdAt, now)) {
    return { inTrial: false, daysRemaining: 0, endsAt: ends.toISOString() }
  }
  const remainingMs = ends.getTime() - now.getTime()
  const daysRemaining = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)))
  return { inTrial: true, daysRemaining, endsAt: ends.toISOString() }
}

export class AIAccessResolver {
  constructor(
    private readonly entitlementResolver = new EntitlementResolver(),
    private readonly tokenService = new TokenSpendService()
  ) {}

  async resolveForUser(input: {
    userId: string
    userEmail?: string | null
    /** Pass `appUser.createdAt` so we can compute trial without re-querying. */
    createdAt?: Date | null
    now?: Date
  }): Promise<AIAccessStatus> {
    const now = input.now ?? new Date()

    const [entitlement, tokens] = await Promise.all([
      this.entitlementResolver
        .resolveForUser(input.userId, FEATURE_ID, input.userEmail ?? null)
        .catch(() => null),
      this.tokenService
        .getBalance(input.userId, input.userEmail ?? null)
        .catch(() => ({ balance: 0 } as { balance: number })),
    ])

    const subscriptionSnapshot: EntitlementSnapshot = entitlement?.entitlement ?? {
      plans: [],
      status: 'none',
      currentPeriodEnd: null,
      gracePeriodEnd: null,
    }
    const hasSubscription = Boolean(entitlement?.hasAccess)
    const trial = computeTrial(input.createdAt ?? null, now)
    const tokenBalance = Number(tokens?.balance ?? 0)

    let reason: AIAccessReason = 'no_access'
    let message = 'Upgrade or purchase tokens to chat with Chimmy.'
    if (hasSubscription) {
      reason = 'subscription_active'
      message = 'Premium AI active.'
    } else if (trial.inTrial) {
      reason = 'in_trial'
      message = `${trial.daysRemaining} day${trial.daysRemaining === 1 ? '' : 's'} left in your free AI trial.`
    } else if (tokenBalance > 0) {
      reason = 'tokens_available'
      message = `${tokenBalance} AI token${tokenBalance === 1 ? '' : 's'} available.`
    }

    return {
      hasAccess: hasSubscription || trial.inTrial || tokenBalance > 0,
      reason,
      hasSubscription,
      subscription: subscriptionSnapshot,
      trial,
      tokenBalance,
      message,
    }
  }
}

/** Module-level singleton — safe to share across requests. */
export const aiAccessResolver = new AIAccessResolver()
