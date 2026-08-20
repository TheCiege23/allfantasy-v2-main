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
 * Coupons: uses Stripe-native `allow_promotion_codes` (the customer enters the
 * code at Checkout). The route still validates the sponsor code and records the
 * pending redemption, and the code is carried in client_reference_id + metadata
 * for webhook-side redemption tracking. (Auto-prefilling the sponsor code into the
 * Session — the old `prefilled_promo_code` behavior — is a follow-up; it is a UX
 * nicety, not a pricing-integrity requirement.)
 */
export async function buildStripeCheckoutSessionForSku(input: {
  sku: MonetizationSku
  userId: string
  userEmail?: string | null
  returnPath?: string | null
  couponCode?: string | null
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
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
  }
  const email = input.userEmail?.trim()
  if (email) params.customer_email = email
  if (mode === "subscription") {
    params.subscription_data = { metadata: { ...metadata } }
  }

  const stripe = getStripeClient()
  const session = await stripe.checkout.sessions.create(params)
  if (!session.url) return null

  return { url: session.url, sessionId: session.id, purchaseType }
}
