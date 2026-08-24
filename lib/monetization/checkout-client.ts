import type { MetaEventPayload } from "@/lib/meta-events"

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
  /**
   * `status` is the HTTP status the checkout endpoint answered with, when there
   * was one (absent for a network failure or timeout, where no response exists).
   *
   * ⚠ IT EXISTS SO A CALLER CAN TELL "YOU ARE NOT SIGNED IN" APART FROM "THIS
   * PURCHASE FAILED", which are different problems with different remedies and
   * were previously indistinguishable. Both arrived here as `{ ok: false }` with
   * a string, so /pricing printed the endpoint's raw `Unauthorized` at a
   * signed-out visitor who clicked Choose AF Pro and left them there — a dead
   * end on the one action the page exists for. A 401 is not an error to display;
   * it is a redirect to make.
   */
  | { ok: false; error: string; status?: number }

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
          status: response.status,
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
