import {
  PAID_TIER_TOP_MONTHLY_TITLE,
  PAID_TIER_TOP_YEARLY_TITLE,
} from "@/lib/brand/display-names"

export type MonetizationSubscriptionSku =
  | "af_pro_monthly"
  | "af_pro_yearly"
  | "af_commissioner_monthly"
  | "af_commissioner_yearly"
  | "af_war_room_monthly"
  | "af_war_room_yearly"
  | "af_supreme_monthly"
  | "af_supreme_yearly"

export type MonetizationTokenPackSku =
  | "af_tokens_5"
  | "af_tokens_10"
  | "af_tokens_25"

export type MonetizationSku = MonetizationSubscriptionSku | MonetizationTokenPackSku

// NOTE: internal plan family "af_war_room" is retained as the stable key; the
// customer-facing name for this tier is "Legacy" (top all-access). Never surface
// "war_room" or "AI" to customers.
export type SubscriptionPlanFamily =
  | "af_pro"
  | "af_commissioner"
  | "af_war_room"
  | "af_supreme"

export type MonetizationCatalogItem = {
  sku: MonetizationSku
  type: "subscription" | "token_pack"
  title: string
  description: string
  amountUsd: number
  currency: "usd"
  interval: "month" | "year" | null
  tokenAmount: number | null
  planFamily: SubscriptionPlanFamily | null
  stripePriceEnvVar: string
}

const CATALOG_ITEMS: readonly MonetizationCatalogItem[] = [
  {
    sku: "af_pro_monthly",
    type: "subscription",
    title: "AF Pro Monthly",
    description: "Player tools for active fantasy managers — trades, waivers, lineups, and drafts.",
    amountUsd: 9.99,
    currency: "usd",
    interval: "month",
    tokenAmount: 250,
    planFamily: "af_pro",
    stripePriceEnvVar: "STRIPE_PRICE_AF_PRO_MONTHLY",
  },
  {
    sku: "af_pro_yearly",
    type: "subscription",
    title: "AF Pro Yearly",
    description: "Player tools for active fantasy managers — trades, waivers, lineups, and drafts.",
    amountUsd: 99.99,
    currency: "usd",
    interval: "year",
    tokenAmount: 3000,
    planFamily: "af_pro",
    stripePriceEnvVar: "STRIPE_PRICE_AF_PRO_YEARLY",
  },
  {
    sku: "af_commissioner_monthly",
    type: "subscription",
    title: "AF Commissioner Monthly",
    description: "Everything in Pro plus the tools to run your leagues.",
    amountUsd: 14.99,
    currency: "usd",
    interval: "month",
    tokenAmount: 500,
    planFamily: "af_commissioner",
    stripePriceEnvVar: "STRIPE_PRICE_AF_COMMISSIONER_MONTHLY",
  },
  {
    sku: "af_commissioner_yearly",
    type: "subscription",
    title: "AF Commissioner Yearly",
    description: "Everything in Pro plus the tools to run your leagues.",
    amountUsd: 149.99,
    currency: "usd",
    interval: "year",
    tokenAmount: 6000,
    planFamily: "af_commissioner",
    stripePriceEnvVar: "STRIPE_PRICE_AF_COMMISSIONER_YEARLY",
  },
  {
    sku: "af_war_room_monthly",
    type: "subscription",
    title: PAID_TIER_TOP_MONTHLY_TITLE,
    description: "Everything in Supreme plus the live draft room, dynasty tools, and priority access.",
    amountUsd: 29.99,
    currency: "usd",
    interval: "month",
    tokenAmount: 3000,
    planFamily: "af_war_room",
    stripePriceEnvVar: "STRIPE_PRICE_AF_WAR_ROOM_MONTHLY",
  },
  {
    sku: "af_war_room_yearly",
    type: "subscription",
    title: PAID_TIER_TOP_YEARLY_TITLE,
    description: "Everything in Supreme plus the live draft room, dynasty tools, and priority access.",
    amountUsd: 299.99,
    currency: "usd",
    interval: "year",
    tokenAmount: 36000,
    planFamily: "af_war_room",
    stripePriceEnvVar: "STRIPE_PRICE_AF_WAR_ROOM_YEARLY",
  },
  {
    sku: "af_supreme_monthly",
    type: "subscription",
    title: "AF Supreme Monthly",
    description:
      "Everything in Commissioner plus projections, cross-league analytics, and higher token allowances.",
    amountUsd: 19.99,
    currency: "usd",
    interval: "month",
    // Must match lib/tokens/subscription-policy.ts's supreme.monthlyIncludedPremiumCredits — that
    // policy value is what the invoice.payment_succeeded webhook actually grants (TokenSpendService
    // .grantMonthlySubscriptionCredits). This field was previously 1500, overpromising vs. the 1000
    // actually credited.
    tokenAmount: 1000,
    planFamily: "af_supreme",
    stripePriceEnvVar: "STRIPE_PRICE_AF_SUPREME_MONTHLY",
  },
  {
    sku: "af_supreme_yearly",
    type: "subscription",
    title: "AF Supreme Yearly",
    description:
      "Everything in Commissioner plus projections, cross-league analytics, and higher token allowances.",
    amountUsd: 199.99,
    currency: "usd",
    interval: "year",
    // Must match subscription-policy.ts's supreme.yearlyIncludedPremiumCredits (15000). Previously
    // 18000, overpromising vs. what invoice.payment_succeeded actually grants.
    tokenAmount: 15000,
    planFamily: "af_supreme",
    stripePriceEnvVar: "STRIPE_PRICE_AF_SUPREME_YEARLY",
  },
  {
    sku: "af_tokens_5",
    type: "token_pack",
    title: "AllFantasy Starter Tokens (250)",
    description: "250 tokens for premium one-off actions.",
    amountUsd: 4.99,
    currency: "usd",
    interval: null,
    tokenAmount: 250,
    planFamily: null,
    stripePriceEnvVar: "STRIPE_PRICE_AF_TOKENS_5",
  },
  {
    sku: "af_tokens_10",
    type: "token_pack",
    title: "AllFantasy Plus Tokens (600)",
    description: "600 tokens for premium one-off actions.",
    amountUsd: 8.99,
    currency: "usd",
    interval: null,
    tokenAmount: 600,
    planFamily: null,
    stripePriceEnvVar: "STRIPE_PRICE_AF_TOKENS_10",
  },
  {
    sku: "af_tokens_25",
    type: "token_pack",
    title: "AllFantasy Pro Token Pack (1,500)",
    description: "1,500 tokens for premium one-off actions.",
    amountUsd: 19.99,
    currency: "usd",
    interval: null,
    tokenAmount: 1500,
    planFamily: null,
    stripePriceEnvVar: "STRIPE_PRICE_AF_TOKENS_25",
  },
] as const

const CATALOG_BY_SKU = new Map<MonetizationSku, MonetizationCatalogItem>(
  CATALOG_ITEMS.map((item) => [item.sku, item])
)

export type MonetizationCatalog = {
  subscriptions: MonetizationCatalogItem[]
  tokenPacks: MonetizationCatalogItem[]
  all: MonetizationCatalogItem[]
}

export function getMonetizationCatalog(): MonetizationCatalog {
  const all = CATALOG_ITEMS.map((item) => ({ ...item }))
  return {
    subscriptions: all.filter((item) => item.type === "subscription"),
    tokenPacks: all.filter((item) => item.type === "token_pack"),
    all,
  }
}

export function getMonetizationCatalogItemBySku(sku: MonetizationSku): MonetizationCatalogItem | null {
  const found = CATALOG_BY_SKU.get(sku)
  return found ? { ...found } : null
}

export function getMonetizationStripePriceIdForSku(
  sku: MonetizationSku,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const item = CATALOG_BY_SKU.get(sku)
  if (!item) return null
  const value = env[item.stripePriceEnvVar]?.trim()
  return value && value.length > 0 ? value : null
}
