/**
 * Google Play Billing inside our Android app (a Trusted Web Activity).
 *
 * The TWA exposes Play Billing to the page through two web APIs:
 *  - the Digital Goods API (`window.getDigitalGoodsService`) for prices and the
 *    user's existing purchases, and
 *  - the Payment Request API with the `https://play.google.com/billing` method
 *    for the purchase sheet itself.
 *
 * Both only work in a build made with Bubblewrap's `playBilling` feature
 * (docs/play-store/RUNBOOK.md). An older install still has the API on `window`
 * but the service refuses to start, which is reported as "update the app".
 *
 * A purchase token is never trusted here: it is posted to
 * /api/monetization/google/purchases, which verifies it with Google before
 * granting anything.
 */

import { useEffect, useState } from "react"
import { isTrustedWebActivity } from "@/lib/platform/isTrustedWebActivity"

export const PLAY_BILLING_METHOD = "https://play.google.com/billing"
const PLAY_PACKAGE = "ai.allfantasy.app"
const UPDATE_APP_MESSAGE = "Update the AllFantasy app from Google Play to make purchases."

type ItemDetails = { itemId: string; title?: string; price?: { currency: string; value: string } }
type PurchaseDetails = { itemId: string; purchaseToken: string }
type DigitalGoodsService = {
  getDetails(itemIds: string[]): Promise<ItemDetails[]>
  listPurchases(): Promise<PurchaseDetails[]>
}
type WindowWithDigitalGoods = Window & {
  getDigitalGoodsService?: (paymentMethod: string) => Promise<DigitalGoodsService>
}

/** In our Android app at all (any build). Purchases there must go through Play, never Stripe. */
export function isGooglePlayApp(): boolean {
  return isTrustedWebActivity()
}

async function playService(): Promise<DigitalGoodsService | null> {
  if (typeof window === "undefined") return null
  const factory = (window as WindowWithDigitalGoods).getDigitalGoodsService
  if (typeof factory !== "function") return null
  try {
    return await factory.call(window, PLAY_BILLING_METHOD)
  } catch {
    // Thrown when this install was built without Play Billing.
    return null
  }
}

function formatPrice(price: { currency: string; value: string } | undefined): string | null {
  if (!price) return null
  const amount = Number(price.value)
  if (!Number.isFinite(amount)) return null
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency }).format(amount)
  } catch {
    return `${price.value} ${price.currency}`
  }
}

async function fetchProductIds(): Promise<string[]> {
  const response = await fetch("/api/monetization/google/products", { cache: "no-store" })
  if (response.status === 401) throw new Error("Please sign in before purchasing.")
  const data = (await response.json().catch(() => ({}))) as { error?: string; subscriptions?: string[]; tokenPacks?: string[] }
  if (!response.ok) throw new Error(data.error || "Google Play purchases are not configured yet.")
  return [...(data.subscriptions ?? []), ...(data.tokenPacks ?? [])]
}

/** Localized Play prices keyed by SKU (Play product id = catalog SKU). */
export function useGooglePlayPrices() {
  const [playApp, setPlayApp] = useState(false)
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [needsUpdate, setNeedsUpdate] = useState(false)
  useEffect(() => {
    if (!isGooglePlayApp()) return
    setPlayApp(true)
    let cancelled = false
    void (async () => {
      const service = await playService()
      if (!service) {
        if (!cancelled) setNeedsUpdate(true)
        return
      }
      const ids = await fetchProductIds().catch(() => [] as string[])
      if (ids.length === 0) return
      const details = await service.getDetails(ids).catch(() => [] as ItemDetails[])
      if (cancelled) return
      const next: Record<string, string> = {}
      for (const item of details) {
        const formatted = formatPrice(item.price)
        if (formatted) next[item.itemId] = formatted
      }
      setPrices(next)
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return { playApp, prices, needsUpdate }
}

async function grant(sku: string, purchaseToken: string): Promise<void> {
  const response = await fetch("/api/monetization/google/purchases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku, purchaseToken }),
  })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (response.status === 202) {
    throw new Error(data.error || "Your Google Play payment is still pending. Access starts as soon as Google confirms it.")
  }
  if (!response.ok) {
    throw new Error(data.error || "Unable to verify your Google Play purchase. Use Restore Purchases after signing in.")
  }
}

export async function purchaseWithGooglePlay(sku: string): Promise<{ cancelled: boolean }> {
  const allowed = await fetchProductIds()
  if (!allowed.includes(sku)) throw new Error("This product is unavailable on Google Play.")
  const service = await playService()
  if (!service || typeof PaymentRequest === "undefined") throw new Error(UPDATE_APP_MESSAGE)

  // Chrome's Play Billing handler reads `sku`; `itemId` is the Digital Goods spec name.
  const request = new PaymentRequest(
    [{ supportedMethods: PLAY_BILLING_METHOD, data: { sku, itemId: sku } }],
    // Required by the API; Play shows its own, authoritative price.
    { total: { label: "Total", amount: { currency: "USD", value: "0" } } },
  )
  let response: PaymentResponse
  try {
    response = await request.show()
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { cancelled: true }
    throw new Error("Google Play could not open the purchase. Please try again.")
  }
  const purchaseToken = (response.details as { purchaseToken?: unknown } | undefined)?.purchaseToken
  if (typeof purchaseToken !== "string" || !purchaseToken) {
    await response.complete("fail").catch(() => {})
    throw new Error("Google Play did not return a purchase.")
  }
  try {
    await grant(sku, purchaseToken)
    await response.complete("success").catch(() => {})
  } catch (error) {
    await response.complete("fail").catch(() => {})
    throw error
  }
  return { cancelled: false }
}

/** Re-sends every purchase Play still holds for this Google account. Returns how many were accepted. */
export async function restoreGooglePlayPurchases(): Promise<number> {
  const service = await playService()
  if (!service) throw new Error(UPDATE_APP_MESSAGE)
  const purchases = await service.listPurchases()
  let restored = 0
  let lastError: Error | null = null
  for (const purchase of purchases) {
    try {
      await grant(purchase.itemId, purchase.purchaseToken)
      restored++
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unable to restore a purchase.")
    }
  }
  if (restored === 0 && lastError) throw lastError
  return restored
}

/** Play's own subscription screen; only Google can change or cancel a Play subscription. */
export async function manageGooglePlaySubscriptions(): Promise<void> {
  window.location.href = `https://play.google.com/store/account/subscriptions?package=${PLAY_PACKAGE}`
}
