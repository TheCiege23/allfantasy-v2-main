import type { SubscriptionPlanId } from "@/lib/subscription/types"

/**
 * Split out of subscription-policy.ts so lib/monetization/catalog.ts can read the real included-
 * token amounts without pulling in that file's other exports (resolveTokenChargeDecisionForUser
 * imports EntitlementResolver, which imports dev-admin/access.ts -> adminAuth.ts -> next/headers).
 * catalog.ts is imported from client components (via feature-access.ts), so any transitive
 * next/headers import breaks the build with "You're importing a component that needs
 * next/headers... not supported in the pages/ directory." This module has zero further imports
 * beyond a pure type, so it's safe from any context.
 */

export type SubscriptionTokenPlanPolicy = {
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

export type SubscriptionTokenPolicyConfig = {
  model: "mixed_access"
  version: "v1_discounted_tokens"
  plans: Record<SubscriptionPlanId, SubscriptionTokenPlanPolicy>
}

export const SUBSCRIPTION_TOKEN_POLICY_CONFIG: SubscriptionTokenPolicyConfig = {
  model: "mixed_access",
  version: "v1_discounted_tokens",
  plans: {
    pro: {
      monthlyIncludedPremiumCredits: 250,
      yearlyIncludedPremiumCredits: 3500,
      discountedTokenSpendPct: 20,
      supportsUnlimitedLowTierInFuture: true,
    },
    commissioner: {
      monthlyIncludedPremiumCredits: 100,
      yearlyIncludedPremiumCredits: 1500,
      discountedTokenSpendPct: 20,
      supportsUnlimitedLowTierInFuture: true,
    },
    war_room: {
      monthlyIncludedPremiumCredits: 300,
      yearlyIncludedPremiumCredits: 3500,
      discountedTokenSpendPct: 25,
      supportsUnlimitedLowTierInFuture: true,
    },
    supreme: {
      monthlyIncludedPremiumCredits: 1000,
      yearlyIncludedPremiumCredits: 15000,
      discountedTokenSpendPct: 45,
      supportsUnlimitedLowTierInFuture: true,
    },
    // Enterprise workspace tier — highest allowances (matches/exceeds Supreme).
    enterprise: {
      monthlyIncludedPremiumCredits: 1000,
      yearlyIncludedPremiumCredits: 15000,
      discountedTokenSpendPct: 45,
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
