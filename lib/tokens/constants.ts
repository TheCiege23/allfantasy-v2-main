import type { SubscriptionPlanId } from "@/lib/subscription/types"
import { TOKEN_SPEND_RULE_MATRIX } from "@/lib/tokens/pricing-matrix"

export const TOKEN_ENTRY_TYPES = {
  PURCHASE: "purchase",
  SPEND: "spend",
  REFUND: "refund",
  ADJUSTMENT: "adjustment",
} as const

export type TokenSpendRuleCode = (typeof TOKEN_SPEND_RULE_MATRIX)[number]["code"]

type TokenSpendRuleTier = "low" | "mid" | "high"

type TokenSpendRuleSeed = {
  code: TokenSpendRuleCode
  category: "ai_feature" | "commissioner_function"
  featureLabel: string
  description: string
  tokenCost: number
  tier: TokenSpendRuleTier
  requiredPlan: SubscriptionPlanId | null
  requiresConfirmation: boolean
  isActive: boolean
  metadata?: Record<string, unknown>
}

export type TokenRefundRuleCode = "feature_execution_failed"

type TokenRefundRuleSeed = {
  code: TokenRefundRuleCode
  description: string
  maxAgeMinutes: number | null
  isActive: boolean
  metadata?: Record<string, unknown>
}

export const TOKEN_PACKAGE_SEEDS = [
  {
    sku: "af_tokens_5",
    title: "AllFantasy AI Tokens (250)",
    description: "250 AI tokens for metered premium AI actions.",
    tokenAmount: 250,
    priceUsdCents: 499,
    isActive: true,
  },
  {
    sku: "af_tokens_10",
    title: "AllFantasy AI Tokens (600)",
    description: "600 AI tokens for metered premium AI actions.",
    tokenAmount: 600,
    priceUsdCents: 899,
    isActive: true,
  },
  {
    sku: "af_tokens_25",
    title: "AllFantasy AI Tokens (1,500)",
    description: "1,500 AI tokens for metered premium AI actions.",
    tokenAmount: 1500,
    priceUsdCents: 1999,
    isActive: true,
  },
] as const

export const TOKEN_SPEND_RULE_SEEDS: readonly TokenSpendRuleSeed[] = [
  ...TOKEN_SPEND_RULE_MATRIX.map((entry) => ({
    code: entry.code,
    category: entry.category,
    featureLabel: entry.featureLabel,
    description: entry.description,
    tokenCost: entry.tokenCost,
    tier: entry.tier,
    requiredPlan: entry.requiredPlan,
    requiresConfirmation: true,
    isActive: true,
    metadata: {
      tier: entry.tier,
      complexity: entry.complexity,
      requiredPlan: entry.requiredPlan,
    },
  })),
] as const

export const TOKEN_REFUND_RULE_SEEDS: readonly TokenRefundRuleSeed[] = [
  {
    code: "feature_execution_failed",
    description: "Automatic refund when spend-confirmed feature execution fails.",
    maxAgeMinutes: 120,
    isActive: true,
  },
] as const
