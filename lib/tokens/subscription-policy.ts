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
import {
  SUBSCRIPTION_TOKEN_POLICY_CONFIG,
  getIncludedPremiumCreditsForSubscription,
  type SubscriptionTokenPlanPolicy,
} from "@/lib/tokens/subscription-token-policy-config"

export { SUBSCRIPTION_TOKEN_POLICY_CONFIG, getIncludedPremiumCreditsForSubscription }
export type { SubscriptionTokenPlanPolicy, SubscriptionTokenPolicyConfig } from "@/lib/tokens/subscription-token-policy-config"

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
