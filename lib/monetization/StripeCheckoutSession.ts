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

export type StripeCheckoutSessionResult = {
  url: string
  sessionId: string
  purchaseType: StripeCheckoutPurchaseType
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
 * Coupons: a sponsor code the route has VALIDATED arrives with its percentage and
 * is applied as a Stripe coupon on the session (see ensureStripeSponsorCoupon).
 * Without one, Stripe-native `allow_promotion_codes` lets the customer type any
 * Stripe promotion code (e.g. a founding-member code) on the Checkout page. The two
 * are mutually exclusive in the Checkout API, so exactly one is sent.
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
  if (couponCode && percentOff > 0) {
    const couponId = await ensureStripeSponsorCoupon(stripe, couponCode, percentOff)
    params.discounts = [{ coupon: couponId }]
  } else {
    params.allow_promotion_codes = true
  }

  const session = await stripe.checkout.sessions.create(params)
  if (!session.url) return null

  return { url: session.url, sessionId: session.id, purchaseType }
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
