import { getMonetizationCatalog, type MonetizationSku } from "@/lib/monetization/catalog"

export const PLAY_PACKAGE = "ai.allfantasy.app"
export const PLAY_METHOD = "https://play.google.com/billing"
export const PLAY_BASE_PLAN = "standard"

// A separate product per interval avoids Billing 8's first-eligible-base-plan ambiguity.
export function playBillingCatalog() {
  return getMonetizationCatalog().all.map(item => ({ ...item,
    productId: item.sku,
    basePlanId: item.type === "subscription" ? PLAY_BASE_PLAN : null,
  }))
}
export function playProduct(productId: string) {
  return playBillingCatalog().find(item => item.productId === productId) ?? null
}
export function playProductForSku(sku: string) {
  return playBillingCatalog().find(item => item.sku === sku as MonetizationSku) ?? null
}
