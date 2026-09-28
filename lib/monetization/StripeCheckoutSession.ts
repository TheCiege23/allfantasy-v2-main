import "server-only"
import type Stripe from "stripe"
import { getStripeClient } from "@/lib/stripe-client"
import { getBaseUrl } from "@/lib/get-base-url"
import {
  getMonetizationCatalogItemBySku,
  getMonetizationStripePriceIdForSku,
  type MonetizationSku,
} from "@/lib/monetization/catalog"
import {
  buildStripeCheckoutClientReferenceId,
  type StripeCheckoutPurchaseType,
} from "@/lib/monetization/StripeCheckoutLinkRegistry"
import { getFoundingCouponId } from "@/lib/monetization/foundingMember"

export type StripeCheckoutSessionResult = {
  url: string
  sessionId: string
  purchaseType: StripeCheckoutPurchaseType
  /** The founding-member coupon rode this session (see lib/monetization/foundingMember.ts). */
  foundingDiscountApplied: boolean
}

/**
 * CANONICAL checkout (Release Readiness Phase 1 — pricing truth).
 *
 * Builds a server-side Stripe Checkout Session whose CHARGE is derived from the
 * catalog price id (`STRIPE_PRICE_AF_*` resolved via
 * `getMonetizationStripePriceIdForSku`). Because the line item is the same Stripe
 * Price the catalog points at, the amount charged is structurally guaranteed to
 * equal the catalog's displayed `amountUsd` — eliminating the display-vs-charge
 * drift that the hardcoded Stripe Payment Link flow (`StripeCheckoutLinkRegistry`
 * `buildStripeCheckoutDestinationForSku`) could not prevent (the amount lived in
 * the Stripe-hosted link, outside this repo).
 *
 * Compatibility: sets BOTH `client_reference_id` (the same `af1_<base64>` payload
 * the webhook decodes via `parseStripeCheckoutClientReferenceId`) AND
 * `metadata.{userId,sku,purchaseType,couponCode}` — the webhook resolves context
 * from either (see `resolveCheckoutContext` / `resolveCheckoutPurchaseType`).
 *
 * Fails soft: if the SKU's price-id env var is unset, returns null so the caller
 * responds 503 (same graceful degradation as the old link registry when the link
 * env var was unset). No hard failure, no charge from an unknown price.
 *
 * Coupons — exactly ONE of these is sent, because Stripe Checkout rejects a session
 * carrying both `discounts` and `allow_promotion_codes`:
 *   1. a sponsor code the route has VALIDATED arrives with its percentage and is
 *      applied as a Stripe coupon (see ensureStripeSponsorCoupon). It wins because
 *      the buyer typed it and the page already showed them that discount;
 *   2. otherwise a founding member (account created before the paywall start) buying
 *      a SUBSCRIPTION gets the `STRIPE_FOUNDING_COUPON_ID` coupon — only when that env
 *      var is set, and never on a token pack;
 *   3. otherwise Stripe-native `allow_promotion_codes` lets the customer type any
 *      Stripe promotion code on the Checkout page — exactly the behaviour before
 *      founding pricing existed.
 */
export async function buildStripeCheckoutSessionForSku(input: {
  sku: MonetizationSku
  userId: string
  userEmail?: string | null
  /** Reuse this Stripe customer instead of letting Checkout mint a new one. */
  stripeCustomerId?: string | null
  returnPath?: string | null
  couponCode?: string | null
  /** The validated sponsor code's discount. Required for the discount to be CHARGED. */
  couponPercentOff?: number | null
  /**
   * The buyer's account predates the paywall (lib/monetization/foundingMember.ts). The caller
   * decides eligibility; this builder decides whether the coupon may ride THIS session.
   */
  foundingMember?: boolean | null
  env?: NodeJS.ProcessEnv
}): Promise<StripeCheckoutSessionResult | null> {
  const env = input.env ?? process.env

  const item = getMonetizationCatalogItemBySku(input.sku)
  if (!item) return null

  const priceId = getMonetizationStripePriceIdForSku(input.sku, env)
  if (!priceId) return null

  const purchaseType: StripeCheckoutPurchaseType =
    item.type === "subscription" ? "subscription" : "tokens"
  const mode: Stripe.Checkout.SessionCreateParams.Mode = item.interval ? "subscription" : "payment"

  const base = getBaseUrl()
  const returnPath =
    input.returnPath && input.returnPath.startsWith("/") ? input.returnPath : "/pricing"
  const sep = returnPath.includes("?") ? "&" : "?"
  const successUrl = `${base}${returnPath}${sep}checkout=success&session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${base}${returnPath}${sep}checkout=cancelled`

  const clientReferenceId = buildStripeCheckoutClientReferenceId({
    userId: input.userId,
    sku: input.sku,
    purchaseType,
    couponCode: input.couponCode ?? null,
  })

  const metadata: Record<string, string> = {
    userId: input.userId,
    sku: input.sku,
    purchaseType,
  }
  const couponCode = input.couponCode?.trim()
  if (couponCode) metadata.couponCode = couponCode

  const params: Stripe.Checkout.SessionCreateParams = {
    mode,
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: clientReferenceId,
    metadata,
    success_url: successUrl,
    cancel_url: cancelUrl,
    /*
     * The paid-state card check reads the billing address the webhook receives
     * (lib/subscription/paidStateRefusal). Left at "auto", Checkout collects only
     * what the card network needs — often just a country and ZIP, sometimes less
     * — so the check would have nothing to read on exactly the buyers it is for.
     */
    billing_address_collection: "required",
  }
  // `customer` and `customer_email` are mutually exclusive in the Checkout API.
  const customerId = input.stripeCustomerId?.trim()
  const email = input.userEmail?.trim()
  if (customerId) params.customer = customerId
  else if (email) params.customer_email = email
  if (mode === "subscription") {
    params.subscription_data = { metadata: { ...metadata } }
  }

  const stripe = getStripeClient()

  /*
   * 🛑 THE COUPON BOX USED TO PROMISE A DISCOUNT THIS SESSION NEVER APPLIED. The
   * route validated the sponsor code and the UI showed "20% off · Total due today",
   * but the session carried the code only as metadata — so the customer was charged
   * full price unless they happened to retype it on Stripe's page AND a matching
   * Stripe promotion code existed (none did). The displayed discount is now the
   * charged one.
   */
  const percentOff = input.couponPercentOff ?? 0
  /*
   * Subscriptions only: a token pack is pay-per-use, and founding pricing is a price on a
   * plan. `mode` is checked as well as the catalog type so a one-off payment never carries it.
   */
  const foundingCouponId =
    input.foundingMember === true && item.type === "subscription" && mode === "subscription"
      ? getFoundingCouponId(env)
      : null
  let foundingDiscountApplied = false
  if (couponCode && percentOff > 0) {
    const couponId = await ensureStripeSponsorCoupon(stripe, couponCode, percentOff)
    params.discounts = [{ coupon: couponId }]
  } else if (foundingCouponId) {
    params.discounts = [{ coupon: foundingCouponId }]
    foundingDiscountApplied = true
  } else {
    params.allow_promotion_codes = true
  }

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.create(params)
  } catch (error) {
    /*
     * ⚠ THE FOUNDING COUPON MUST NEVER BE THE REASON A CUSTOMER CANNOT PAY. It is an env var
     * pointing at a Stripe object the owner manages by hand: deleted, expired, capped at its
     * max redemptions, or created in the other Stripe mode, and Stripe rejects the WHOLE
     * session. So a rejected request that carried it is retried once exactly as if founding
     * pricing were off. Anything else wrong with the request fails the retry the same way and
     * still throws.
     */
    if (!foundingDiscountApplied || !isStripeInvalidRequest(error)) throw error
    console.warn("[checkout] founding coupon rejected by Stripe; retrying without it", {
      code: (error as { code?: unknown })?.code ?? null,
      param: (error as { param?: unknown })?.param ?? null,
    })
    delete params.discounts
    params.allow_promotion_codes = true
    foundingDiscountApplied = false
    session = await stripe.checkout.sessions.create(params)
  }
  if (!session.url) return null

  return { url: session.url, sessionId: session.id, purchaseType, foundingDiscountApplied }
}

function isStripeInvalidRequest(error: unknown): boolean {
  const e = error as { type?: unknown; rawType?: unknown } | null
  return e?.type === "StripeInvalidRequestError" || e?.rawType === "invalid_request_error"
}

/**
 * The Stripe coupon that charges a validated sponsor code's discount, created on
 * first use.
 *
 * The id is derived from the code AND the percentage, so it is idempotent across
 * requests and servers, and a sponsor code whose percentage is later changed in
 * `sponsorCoupon.ts` gets a NEW coupon instead of silently reusing the old rate
 * (Stripe coupons are immutable in amount).
 *
 * `duration: "once"` — the checkout UI promises the discount on "Total due today",
 * i.e. the first payment. It is not a recurring discount on renewals.
 */
export async function ensureStripeSponsorCoupon(
  stripe: ReturnType<typeof getStripeClient>,
  couponCode: string,
  percentOff: number
): Promise<string> {
  const slug = couponCode.toLowerCase().replace(/[^a-z0-9]/g, "")
  const pct = Math.round(percentOff * 100) / 100
  const couponId = `af_sponsor_${slug}_${String(pct).replace(".", "p")}pct`
  try {
    const existing = await stripe.coupons.retrieve(couponId)
    return existing.id
  } catch (error: any) {
    if (error?.code !== "resource_missing") throw error
  }
  try {
    const created = await stripe.coupons.create({
      id: couponId,
      percent_off: pct,
      duration: "once",
      name: `${couponCode} (${pct}% off)`.slice(0, 40),
      metadata: { af_sponsor_code: couponCode },
    })
    return created.id
  } catch (error: any) {
    // Two checkouts racing to create the same coupon: the loser reuses the winner's.
    if (error?.code === "resource_already_exists") return couponId
    throw error
  }
}
