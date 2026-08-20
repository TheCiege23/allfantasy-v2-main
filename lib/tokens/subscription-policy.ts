import { EntitlementResolver, type EntitlementSnapshot } from "@/lib/subscription/EntitlementResolver"
import {
  expandPlansWithBundle,
  isActiveOrGraceStatus,
} from "@/lib/subscription/feature-access"
import type { SubscriptionPlanId } from "@/lib/subscription/types"
import {
  getTokenSpendRuleMatrixEntry,
  type TokenPricingTier,
} from "@/lib/tokens/pricing-matrix"

type SubscriptionTokenPlanPolicy = {
  /**
   * Monthly AI tokens deposited automatically each monthly billing cycle.
   *
   * Granted via `TokenSpendService.grantMonthlySubscriptionCredits`, called
   * from the `invoice.payment_succeeded` Stripe webhook handler for both
   * `subscription_create` (first month) and `subscription_cycle` (renewals).
   * Idempotency key: `subscription_credit:{invoiceId}` — safe against Stripe retries.
   *
   * This value is also surfaced in the Token Center pricing UI so subscribers
   * can see how many credits are included with each plan tier.
   */
  monthlyIncludedPremiumCredits: number
  /**
   * AI tokens deposited automatically on yearly subscription invoices.
   * Kept separate from monthly credits so annual buyers receive the advertised
   * launch allowance rather than one month of credits.
   */
  yearlyIncludedPremiumCredits: number
  discountedTokenSpendPct: number
  supportsUnlimitedLowTierInFuture: boolean
}

type SubscriptionTokenPolicyConfig = {
  model: "mixed_access"
  version: "v1_discounted_tokens"
  plans: Record<SubscriptionPlanId, SubscriptionTokenPlanPolicy>
}

/*
 * ⚠ SUBSCRIPTIONS GRANT NO TOKENS. This is deliberate and it is the whole model:
 * a subscription unlocks features outright, and tokens are the pay-per-use path
 * for people who do not want a subscription. Granting both meant a subscriber
 * held a currency they had no reason to spend.
 *
 * ⚠ discountedTokenSpendPct IS 0 FOR THE SAME REASON. A subscriber discount on
 * token spend only matters to someone who spends tokens, and a subscriber does
 * not. Keeping it would have meant a whole column in the cost table, and a
 * concept on the pricing page, serving nobody.
 *
 * ⚠ THESE ZEROES ARE LOAD-BEARING — grantMonthlyCreditsFromInvoice bails on
 * `!tokenAmount || tokenAmount <= 0`, so 0 here is what actually stops the
 * invoice.payment_succeeded webhook from crediting anything. Do not "tidy" these
 * into removed keys; the lookup would return undefined and the guard reads the
 * same, but the intent would stop being visible.
 */
export const SUBSCRIPTION_TOKEN_POLICY_CONFIG: SubscriptionTokenPolicyConfig = {
  model: "mixed_access",
  version: "v1_discounted_tokens",
  plans: {
    pro: {
      monthlyIncludedPremiumCredits: 0,
      yearlyIncludedPremiumCredits: 0,
      discountedTokenSpendPct: 0,
      supportsUnlimitedLowTierInFuture: true,
    },
    commissioner: {
      monthlyIncludedPremiumCredits: 0,
      yearlyIncludedPremiumCredits: 0,
      discountedTokenSpendPct: 0,
      supportsUnlimitedLowTierInFuture: true,
    },
    war_room: {
      monthlyIncludedPremiumCredits: 0,
      yearlyIncludedPremiumCredits: 0,
      discountedTokenSpendPct: 0,
      supportsUnlimitedLowTierInFuture: true,
    },
    supreme: {
      monthlyIncludedPremiumCredits: 0,
      yearlyIncludedPremiumCredits: 0,
      discountedTokenSpendPct: 0,
      supportsUnlimitedLowTierInFuture: true,
    },
    // Enterprise workspace tier — highest allowances (matches/exceeds Supreme).
    enterprise: {
      monthlyIncludedPremiumCredits: 0,
      yearlyIncludedPremiumCredits: 0,
      discountedTokenSpendPct: 0,
      supportsUnlimitedLowTierInFuture: true,
    },
  },
}

export function getIncludedPremiumCreditsForSubscription(input: {
  planId: SubscriptionPlanId
  interval: "month" | "year"
}): number {
  const policy = SUBSCRIPTION_TOKEN_POLICY_CONFIG.plans[input.planId]
  if (!policy) return 0
  return input.interval === "year"
    ? policy.yearlyIncludedPremiumCredits
    : policy.monthlyIncludedPremiumCredits
}

export type TokenChargeMode = "tokens_only" | "subscriber_discounted_tokens"

export type TokenChargeDecision = {
  ruleCode: string
  pricingTier: TokenPricingTier
  requiredPlan: SubscriptionPlanId | null
  baseTokenCost: number
  effectiveTokenCost: number
  discountPct: number
  chargeMode: TokenChargeMode
  subscriptionEligible: boolean
  policyMessage: string
  monthlyIncludedPremiumCredits: number | null
  supportsUnlimitedLowTierInFuture: boolean
}

function getBestPlanPolicy(plans: SubscriptionPlanId[]): {
  plan: SubscriptionPlanId
  policy: SubscriptionTokenPlanPolicy
} | null {
  let best: { plan: SubscriptionPlanId; policy: SubscriptionTokenPlanPolicy } | null = null
  for (const plan of plans) {
    const policy = SUBSCRIPTION_TOKEN_POLICY_CONFIG.plans[plan]
    if (!policy) continue
    if (!best) {
      best = { plan, policy }
      continue
    }
    if (policy.discountedTokenSpendPct > best.policy.discountedTokenSpendPct) {
      best = { plan, policy }
      continue
    }
    if (
      policy.discountedTokenSpendPct === best.policy.discountedTokenSpendPct &&
      policy.monthlyIncludedPremiumCredits > best.policy.monthlyIncludedPremiumCredits
    ) {
      best = { plan, policy }
    }
  }
  return best
}

export function resolveTokenChargeDecisionForEntitlement(input: {
  entitlement: EntitlementSnapshot
  ruleCode: string
  baseTokenCost: number
}): TokenChargeDecision {
  const matrixEntry = getTokenSpendRuleMatrixEntry(input.ruleCode)
  const tier = matrixEntry?.tier ?? "mid"
  const requiredPlan = matrixEntry?.requiredPlan ?? null
  const baseTokenCost = Math.max(1, Math.trunc(input.baseTokenCost || 1))
  const expandedPlans = expandPlansWithBundle(input.entitlement.plans)
  const hasActiveSubscription = isActiveOrGraceStatus(input.entitlement.status)
  const requiredPlanEligible =
    !requiredPlan ||
    expandedPlans.includes(requiredPlan) ||
    expandedPlans.includes("supreme")
  const subscriptionEligible = hasActiveSubscription && requiredPlanEligible

  if (!subscriptionEligible) {
    return {
      ruleCode: input.ruleCode,
      pricingTier: tier,
      requiredPlan,
      baseTokenCost,
      effectiveTokenCost: baseTokenCost,
      discountPct: 0,
      chargeMode: "tokens_only",
      subscriptionEligible: false,
      policyMessage: "Tokens apply at standard rate for this feature.",
      monthlyIncludedPremiumCredits: null,
      supportsUnlimitedLowTierInFuture: false,
    }
  }

  const bestPlan = getBestPlanPolicy(expandedPlans)
  const discountPct = Math.max(0, Math.min(90, bestPlan?.policy.discountedTokenSpendPct ?? 0))
  const discountedCost = Math.max(1, Math.ceil((baseTokenCost * (100 - discountPct)) / 100))

  return {
    ruleCode: input.ruleCode,
    pricingTier: tier,
    requiredPlan,
    baseTokenCost,
    effectiveTokenCost: discountedCost,
    discountPct,
    chargeMode: "subscriber_discounted_tokens",
    subscriptionEligible: true,
    policyMessage:
      discountPct > 0
        ? `Subscription discount applied (${discountPct}% off token cost).`
        : "Subscription active for this feature.",
    monthlyIncludedPremiumCredits: bestPlan?.policy.monthlyIncludedPremiumCredits ?? null,
    supportsUnlimitedLowTierInFuture:
      bestPlan?.policy.supportsUnlimitedLowTierInFuture ?? false,
  }
}

export async function resolveTokenChargeDecisionForUser(input: {
  userId: string
  ruleCode: string
  baseTokenCost: number
}): Promise<TokenChargeDecision> {
  const entitlementResolver = new EntitlementResolver()
  const entitlement = await entitlementResolver.resolveSnapshot(input.userId)
  return resolveTokenChargeDecisionForEntitlement({
    entitlement,
    ruleCode: input.ruleCode,
    baseTokenCost: input.baseTokenCost,
  })
}
