import { getIncludedPremiumCreditsForSubscription } from "@/lib/tokens/subscription-policy"

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

/**
 * Included token amounts for subscription SKUs are computed from subscription-policy.ts —
 * the same config the invoice.payment_succeeded webhook reads to actually grant credits
 * (TokenSpendService.grantMonthlySubscriptionCredits) — rather than hardcoded here a second
 * time. This is a structural fix: two independently hand-maintained copies of "how many
 * tokens does this plan include" is exactly how af_pro/commissioner/war_room drifted out of
 * sync with what's actually granted (by as much as 10x) while only af_supreme was patched.
 */
function subscriptionTokenAmount(planId: "pro" | "commissioner" | "war_room" | "supreme", interval: "month" | "year"): number {
  return getIncludedPremiumCreditsForSubscription({ planId, interval })
}

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
    tokenAmount: subscriptionTokenAmount("pro", "month"),
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
    tokenAmount: subscriptionTokenAmount("pro", "year"),
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
    tokenAmount: subscriptionTokenAmount("commissioner", "month"),
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
    tokenAmount: subscriptionTokenAmount("commissioner", "year"),
    planFamily: "af_commissioner",
    stripePriceEnvVar: "STRIPE_PRICE_AF_COMMISSIONER_YEARLY",
  },
  {
    sku: "af_war_room_monthly",
    type: "subscription",
    title: "AF Legacy Monthly",
    // Not "Everything in Supreme plus..." — Legacy is a separate draft/dynasty-focused track,
    // not a superset of Supreme (expandPlansWithBundle treats Supreme as the top bundle that
    // inherits Legacy, Commissioner, and Pro, not the other way around).
    description: "Live draft room, dynasty tools, and priority access for year-round fantasy managers.",
    amountUsd: 29.99,
    currency: "usd",
    interval: "month",
    tokenAmount: subscriptionTokenAmount("war_room", "month"),
    planFamily: "af_war_room",
    stripePriceEnvVar: "STRIPE_PRICE_AF_WAR_ROOM_MONTHLY",
  },
  {
    sku: "af_war_room_yearly",
    type: "subscription",
    title: "AF Legacy Yearly",
    description: "Live draft room, dynasty tools, and priority access for year-round fantasy managers.",
    amountUsd: 299.99,
    currency: "usd",
    interval: "year",
    tokenAmount: subscriptionTokenAmount("war_room", "year"),
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
    tokenAmount: subscriptionTokenAmount("supreme", "month"),
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
    tokenAmount: subscriptionTokenAmount("supreme", "year"),
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
