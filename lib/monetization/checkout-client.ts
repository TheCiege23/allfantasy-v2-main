import type { MetaEventPayload } from "@/lib/meta-events"
import { isTrustedWebActivity } from "@/lib/platform/isTrustedWebActivity"
import { purchaseWithGooglePlay } from "@/lib/monetization/google-play-client"
import { isAppleApp, purchaseWithApple } from "@/lib/monetization/apple-iap-client"

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
  /** `signIn`: `url` is the sign-in page, returning here — not Stripe. Callers navigate to it the same way. */
  | { ok: true; url: string; metaEvent?: MetaEventPayload; signIn?: true }
  | { ok: true; completed: true }
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

  if (isAppleApp()) {
    try {
      const purchase = await purchaseWithApple(sku)
      return purchase.cancelled
        ? { ok: false, error: "Purchase cancelled." }
        : { ok: true, completed: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Unable to complete Apple purchase." }
    }
  }

  // Every Android purchase stays inside Play; a missing native bridge fails closed.
  if (isTrustedWebActivity()) {
    try { await purchaseWithGooglePlay(sku); return { ok: true, completed: true } }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Unable to complete Google Play purchase." } }
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
        message?: string
        metaEvent?: MetaEventPayload
      }
      /*
       * Signed out (or the session lapsed): send them to sign in and back, rather than printing the
       * route's bare "Unauthorized" under the plan they just chose. Every purchase surface already
       * navigates to `url` on ok, so this needs nothing from any of them.
       */
      if (response.status === 401) {
        const here = typeof window === "undefined" ? normalizedRequest.returnPath : `${window.location.pathname}${window.location.search}`
        return { ok: true, url: `/login?callbackUrl=${encodeURIComponent(here || "/pricing")}`, signIn: true }
      }
      if (!response.ok || !data.url) {
        return {
          ok: false,
          // A geo refusal puts a code in `error` (PAID_GEO_BLOCKED, VPN_BLOCKED)
          // and the sentence meant for a person in `message`.
          error: data.message ?? data.error ?? "Unable to start checkout. Please try again.",
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
