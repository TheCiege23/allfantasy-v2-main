import { getMonetizationCatalogItemBySku, type MonetizationSku } from "@/lib/monetization/catalog"

/**
 * Single formatter for every customer-facing price string.
 *
 * WHY THIS EXISTS
 * Prices were hardcoded in six separate customer-facing files. They all happened to
 * match `catalog.ts` — but only because someone remembered to update each one after the
 * July 2026 reprice. PR #247 fixed one drift instance; the mechanism that produced it
 * stayed in place everywhere else, so the next reprice silently breaks whichever file
 * gets missed. Reading from the catalog removes the chance to forget.
 *
 * Returns `—` rather than throwing or rendering `undefined` when a SKU is missing:
 * marketing copy should degrade to a dash, never to "$NaN/mo" on a live page.
 */
export function priceOf(sku: MonetizationSku): string {
  const amount = getMonetizationCatalogItemBySku(sku)?.amountUsd
  if (typeof amount !== "number") return "—"
  return `$${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`
}

/**
 * The tier prices actually surfaced in marketing copy, resolved once at module load.
 *
 * Note `af_war_room` is the internal key for the tier customers see as **Legacy** — see
 * the note in catalog.ts. Never render the raw key.
 */
export const TIER_PRICE = {
  proMonthly: priceOf("af_pro_monthly"),
  proYearly: priceOf("af_pro_yearly"),
  commissionerMonthly: priceOf("af_commissioner_monthly"),
  commissionerYearly: priceOf("af_commissioner_yearly"),
  /** Customer-facing name: "Legacy". */
  legacyMonthly: priceOf("af_war_room_monthly"),
  /** Customer-facing name: "Legacy". */
  legacyYearly: priceOf("af_war_room_yearly"),
  supremeMonthly: priceOf("af_supreme_monthly"),
  supremeYearly: priceOf("af_supreme_yearly"),
} as const
