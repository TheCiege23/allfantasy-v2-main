import type { MetaEventPayload } from "@/lib/meta-events"
import { isTrustedWebActivity } from "@/lib/platform/isTrustedWebActivity"

export type MonetizationCheckoutProductType = "subscription" | "token_pack"

type CheckoutEndpoint = "/api/monetization/checkout/subscription" | "/api/monetization/checkout/tokens"

export type MonetizationCheckoutRequest = {
  sku: string
  productType: MonetizationCheckoutProductType
  returnPath: string
  /** Optional sponsor/promo code to pre-apply at checkout (e.g. "WassupFred"). Server validates — client cannot spoof discounts. */
  couponCode?: string | null
}

export type MonetizationCheckoutResult =
  | { ok: true; url: string; metaEvent?: MetaEventPayload }
  | { ok: false; error: string }

const CHECKOUT_TIMEOUT_MS = 12_000
const inFlightCheckoutRequests = new Map<string, Promise<MonetizationCheckoutResult>>()

function resolveCheckoutEndpoint(productType: MonetizationCheckoutProductType): CheckoutEndpoint {
  return productType === "subscription"
    ? "/api/monetization/checkout/subscription"
    : "/api/monetization/checkout/tokens"
}

function normalizeReturnPath(path: string): string {
  const value = String(path ?? "").trim()
  if (!value.startsWith("/")) return "/pricing"
  return value.length > 200 ? value.slice(0, 200) : value
}

export async function resolveCheckoutUrl(
  request: MonetizationCheckoutRequest
): Promise<MonetizationCheckoutResult> {
  const sku = String(request.sku ?? "").trim()
  if (!sku) {
    return { ok: false, error: "Missing checkout sku." }
  }

  /*
   * ⚠ ONE GATE FOR EVERY PURCHASE, AND THIS IS THE ONLY PLACE IT CAN LIVE.
   * Google Play's payments policy requires digital goods sold to app users to
   * go through Play Billing, and the Android TWA puts this entire site inside a
   * Play-distributed app. A reachable Stripe checkout there is what gets a
   * production submission rejected.
   *
   * Every purchase surface — MonetizationPurchaseSurface, PricingV4,
   * TokenCentreV4 — reaches Stripe through this one function, so gating here
   * covers subscriptions and token packs together and cannot be bypassed by a
   * surface that forgets to check. A per-component `isTrustedWebActivity()`
   * guard would be four copies of one rule, and the fourth is the one that gets
   * added later without it.
   *
   * ⚠ THE OPEN WEB IS UNTOUCHED. This fires only for our own package's TWA;
   * desktop, mobile browsers and the installed iOS PWA all still check out
   * through Stripe, because none of them is distributed through Play.
   *
   * Remove this when Play Billing is wired (Digital Goods API + Payment Request
   * API) or the US external-billing allowance is deliberately adopted.
   */
  if (isTrustedWebActivity()) {
    return {
      ok: false,
      error: "Purchases aren't available in the Android app yet. Open allfantasy.ai in your browser to subscribe or buy tokens.",
    }
  }

  const normalizedCoupon = String(request.couponCode ?? "").trim() || null
  const normalizedRequest: MonetizationCheckoutRequest = {
    sku,
    productType: request.productType,
    returnPath: normalizeReturnPath(request.returnPath),
    couponCode: normalizedCoupon,
  }
  const endpoint = resolveCheckoutEndpoint(request.productType)
  const requestKey = `${normalizedRequest.productType}:${normalizedRequest.sku}:${normalizedRequest.returnPath}:${normalizedCoupon ?? ""}`
  const existing = inFlightCheckoutRequests.get(requestKey)
  if (existing) return existing

  const pending = (async (): Promise<MonetizationCheckoutResult> => {
    const controller = new AbortController()
    const timeoutId = globalThis.setTimeout(() => controller.abort(), CHECKOUT_TIMEOUT_MS)
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sku: normalizedRequest.sku,
          returnPath: normalizedRequest.returnPath,
          ...(normalizedRequest.couponCode ? { couponCode: normalizedRequest.couponCode } : {}),
        }),
        signal: controller.signal,
      })
      const data = (await response.json().catch(() => ({}))) as {
        url?: string
        error?: string
        metaEvent?: MetaEventPayload
      }
      if (!response.ok || !data.url) {
        return {
          ok: false,
          error: data.error ?? "Unable to start checkout. Please try again.",
        }
      }
      return { ok: true, url: data.url, metaEvent: data.metaEvent }
    } catch {
      return { ok: false, error: "Unable to start checkout. Please try again." }
    } finally {
      globalThis.clearTimeout(timeoutId)
      inFlightCheckoutRequests.delete(requestKey)
    }
  })()

  inFlightCheckoutRequests.set(requestKey, pending)
  return pending
}
