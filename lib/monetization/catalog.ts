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
    /*
     * ⚠ SUBSCRIPTIONS NO LONGER CARRY TOKENS — null, NOT 0. Tokens are the
     * pay-per-use path for people who do not want a subscription; a subscriber
     * has the features unlocked outright and should never need to spend them.
     * null means "this plan does not deal in tokens"; 0 would mean "it grants
     * you zero of them", which invites the reasonable question of why it is
     * mentioned at all.
     */
    tokenAmount: null,
    planFamily: "af_pro",
    stripePriceEnvVar: "STRIPE_PRICE_AF_PRO_MONTHLY",
  },
  {
    sku: "af_pro_yearly",
    type: "subscription",
    title: "AF Pro Yearly",
    description: "Player tools for active fantasy managers — trades, waivers, lineups, and drafts.",
    amountUsd: 79.99,
    currency: "usd",
    // Must match subscription-policy.ts's pro.yearlyIncludedPremiumCredits (3500). Previously 3000,
    // which UNDER-stated the grant — the opposite direction to the other drifts, and the only one
    // that was costing us goodwill rather than owing it.
    interval: "year",
    /*
     * ⚠ SUBSCRIPTIONS NO LONGER CARRY TOKENS — null, NOT 0. Tokens are the
     * pay-per-use path for people who do not want a subscription; a subscriber
     * has the features unlocked outright and should never need to spend them.
     * null means "this plan does not deal in tokens"; 0 would mean "it grants
     * you zero of them", which invites the reasonable question of why it is
     * mentioned at all.
     */
    tokenAmount: null,
    planFamily: "af_pro",
    stripePriceEnvVar: "STRIPE_PRICE_AF_PRO_YEARLY",
  },
  {
    sku: "af_commissioner_monthly",
    type: "subscription",
    title: "AF Commissioner Monthly",
    // ⚠ NOT "Everything in Pro plus …", which is what this said and which is false.
    // Only Supreme bundles other tiers (SUPREME_INCLUDED_PLAN_IDS in
    // lib/subscription/feature-access.ts = [pro, commissioner, war_room]).
    // Commissioner does NOT grant Pro's player tools, so a subscriber who bought on
    // that sentence would find the trade and waiver tools still locked.
    description: "The tools to run your leagues — health, integrity, recaps and the Commissioner OS.",
    amountUsd: 14.99,
    currency: "usd",
    // Must match subscription-policy.ts's commissioner.monthlyIncludedPremiumCredits (100).
    // Previously 500 — a 5x overpromise against what invoice.payment_succeeded actually credits.
    // Same bug already fixed on Supreme below; this tier and Legacy were missed.
    interval: "month",
    /*
     * ⚠ SUBSCRIPTIONS NO LONGER CARRY TOKENS — null, NOT 0. Tokens are the
     * pay-per-use path for people who do not want a subscription; a subscriber
     * has the features unlocked outright and should never need to spend them.
     * null means "this plan does not deal in tokens"; 0 would mean "it grants
     * you zero of them", which invites the reasonable question of why it is
     * mentioned at all.
     */
    tokenAmount: null,
    planFamily: "af_commissioner",
    stripePriceEnvVar: "STRIPE_PRICE_AF_COMMISSIONER_MONTHLY",
  },
  {
    sku: "af_commissioner_yearly",
    type: "subscription",
    title: "AF Commissioner Yearly",
    // ⚠ NOT "Everything in Pro plus …", which is what this said and which is false.
    // Only Supreme bundles other tiers (SUPREME_INCLUDED_PLAN_IDS in
    // lib/subscription/feature-access.ts = [pro, commissioner, war_room]).
    // Commissioner does NOT grant Pro's player tools, so a subscriber who bought on
    // that sentence would find the trade and waiver tools still locked.
    description: "The tools to run your leagues — health, integrity, recaps and the Commissioner OS.",
    amountUsd: 129.99,
    currency: "usd",
    // Must match subscription-policy.ts's commissioner.yearlyIncludedPremiumCredits (1500).
    // Previously 6000 — a 4x overpromise.
    interval: "year",
    /*
     * ⚠ SUBSCRIPTIONS NO LONGER CARRY TOKENS — null, NOT 0. Tokens are the
     * pay-per-use path for people who do not want a subscription; a subscriber
     * has the features unlocked outright and should never need to spend them.
     * null means "this plan does not deal in tokens"; 0 would mean "it grants
     * you zero of them", which invites the reasonable question of why it is
     * mentioned at all.
     */
    tokenAmount: null,
    planFamily: "af_commissioner",
    stripePriceEnvVar: "STRIPE_PRICE_AF_COMMISSIONER_YEARLY",
  },
  {
    sku: "af_war_room_monthly",
    type: "subscription",
    title: "AF Legacy Monthly",
    // ⚠ THIS CLAIM WAS BACKWARDS, NOT MERELY LADDER-ISH. SUPREME_INCLUDED_PLAN_IDS
    // contains war_room, so SUPREME INCLUDES LEGACY — not the reverse. Legacy also
    // grants 300 tokens/mo against Supreme's 1,000 while costing $10 MORE, so
    // "everything in Supreme plus" was false in the one dimension a pricing grid
    // shows side by side.
    description: "The live draft room, dynasty tools, and priority access.",
    amountUsd: 9.99,
    currency: "usd",
    // Must match subscription-policy.ts's war_room.monthlyIncludedPremiumCredits (300). Previously
    // 3000 — a 10x overpromise, and the largest of the set. Note this tier is surfaced as
    // "AF Legacy"; the planFamily keeps the historical war_room key.
    interval: "month",
    /*
     * ⚠ SUBSCRIPTIONS NO LONGER CARRY TOKENS — null, NOT 0. Tokens are the
     * pay-per-use path for people who do not want a subscription; a subscriber
     * has the features unlocked outright and should never need to spend them.
     * null means "this plan does not deal in tokens"; 0 would mean "it grants
     * you zero of them", which invites the reasonable question of why it is
     * mentioned at all.
     */
    tokenAmount: null,
    planFamily: "af_war_room",
    stripePriceEnvVar: "STRIPE_PRICE_AF_WAR_ROOM_MONTHLY",
  },
  {
    sku: "af_war_room_yearly",
    type: "subscription",
    title: "AF Legacy Yearly",
    // ⚠ THIS CLAIM WAS BACKWARDS, NOT MERELY LADDER-ISH. SUPREME_INCLUDED_PLAN_IDS
    // contains war_room, so SUPREME INCLUDES LEGACY — not the reverse. Legacy also
    // grants 300 tokens/mo against Supreme's 1,000 while costing $10 MORE, so
    // "everything in Supreme plus" was false in the one dimension a pricing grid
    // shows side by side.
    description: "The live draft room, dynasty tools, and priority access.",
    amountUsd: 79.99,
    currency: "usd",
    // Must match subscription-policy.ts's war_room.yearlyIncludedPremiumCredits (3500). Previously
    // 36000 — a 10.3x overpromise.
    interval: "year",
    /*
     * ⚠ SUBSCRIPTIONS NO LONGER CARRY TOKENS — null, NOT 0. Tokens are the
     * pay-per-use path for people who do not want a subscription; a subscriber
     * has the features unlocked outright and should never need to spend them.
     * null means "this plan does not deal in tokens"; 0 would mean "it grants
     * you zero of them", which invites the reasonable question of why it is
     * mentioned at all.
     */
    tokenAmount: null,
    planFamily: "af_war_room",
    stripePriceEnvVar: "STRIPE_PRICE_AF_WAR_ROOM_YEARLY",
  },
  {
    sku: "af_supreme_monthly",
    type: "subscription",
    title: "AF Supreme Monthly",
    // Supreme is the ONE bundling tier, and saying so is accurate here where it is
    // not on the others: it inherits Pro, Commissioner AND Legacy.
    /*
     * ⚠ NO LONGER "Pro, Commissioner and Legacy … largest token allowance". Both
     * halves went stale the same morning: SUPREME_INCLUDED_PLAN_IDS dropped
     * war_room, and subscriptions stopped granting tokens entirely. It survived
     * two sweeps because the token guard required a DIGIT before "tokens" and
     * "allowance" has none, and the Legacy guard only read planIncludes.ts. Both
     * holes are now closed.
     */
    description:
      "AF Pro and AF Commissioner in one tier, for less than buying both.",
    amountUsd: 19.99,
    currency: "usd",
    interval: "month",
    // Must match lib/tokens/subscription-policy.ts's supreme.monthlyIncludedPremiumCredits — that
    // policy value is what the invoice.payment_succeeded webhook actually grants (TokenSpendService
    // .grantMonthlySubscriptionCredits). This field was previously 1500, overpromising vs. the 1000
    // actually credited.
    /*
     * ⚠ SUBSCRIPTIONS NO LONGER CARRY TOKENS — null, NOT 0. Tokens are the
     * pay-per-use path for people who do not want a subscription; a subscriber
     * has the features unlocked outright and should never need to spend them.
     * null means "this plan does not deal in tokens"; 0 would mean "it grants
     * you zero of them", which invites the reasonable question of why it is
     * mentioned at all.
     */
    tokenAmount: null,
    planFamily: "af_supreme",
    stripePriceEnvVar: "STRIPE_PRICE_AF_SUPREME_MONTHLY",
  },
  {
    sku: "af_supreme_yearly",
    type: "subscription",
    title: "AF Supreme Yearly",
    // Supreme is the ONE bundling tier, and saying so is accurate here where it is
    // not on the others: it inherits Pro, Commissioner AND Legacy.
    /*
     * ⚠ NO LONGER "Pro, Commissioner and Legacy … largest token allowance". Both
     * halves went stale the same morning: SUPREME_INCLUDED_PLAN_IDS dropped
     * war_room, and subscriptions stopped granting tokens entirely. It survived
     * two sweeps because the token guard required a DIGIT before "tokens" and
     * "allowance" has none, and the Legacy guard only read planIncludes.ts. Both
     * holes are now closed.
     */
    description:
      "AF Pro and AF Commissioner in one tier, for less than buying both.",
    /*
     * ⚠ NOT 179.99. At that price Supreme's YEARLY bundle saved only 14.3%
     * against buying Pro + Commissioner yearly ($209.98), while its MONTHLY
     * bundle saved 20% against buying them monthly — so committing for a year
     * made the bundle worth LESS, which is the opposite of everything else on
     * the page. 159.99 is 33.3% off 12x its own monthly (exactly matching Pro
     * and Legacy) and 23.8% off buying the two tiers separately, so it beats the
     * monthly bundle on both axes. Effective $13.33/mo.
     */
    amountUsd: 159.99,
    currency: "usd",
    interval: "year",
    // Must match subscription-policy.ts's supreme.yearlyIncludedPremiumCredits (15000). Previously
    // 18000, overpromising vs. what invoice.payment_succeeded actually grants.
    /*
     * ⚠ SUBSCRIPTIONS NO LONGER CARRY TOKENS — null, NOT 0. Tokens are the
     * pay-per-use path for people who do not want a subscription; a subscriber
     * has the features unlocked outright and should never need to spend them.
     * null means "this plan does not deal in tokens"; 0 would mean "it grants
     * you zero of them", which invites the reasonable question of why it is
     * mentioned at all.
     */
    tokenAmount: null,
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

/**
 * Prices staged ahead of their Stripe objects.
 *
 * ⚠ EMPTY IS THE CORRECT STEADY STATE — DO NOT DELETE THIS. It exists so a price
 * can be agreed and committed BEFORE the Stripe Price it depends on exists,
 * without the page ever advertising a figure checkout will not honour. The 2026-08
 * overhaul used it exactly that way: five prices sat here while amountUsd kept
 * showing what Stripe still billed, then moved across once the Prices were created
 * and verify-stripe-price-parity read 11/11.
 *
 * The next price change should land here first, not in amountUsd.
 */
export const PLANNED_PRICE_USD: Partial<Record<MonetizationSku, number>> = {}

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
