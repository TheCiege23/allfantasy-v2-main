/**
 * "Support AllFantasy monthly" for people who do not play fantasy sports (owner's request,
 * 2026-11-23). A family member who wants to chip in each month should not have to invent a
 * username and password, or find their way around the app, to do it. So this checkout runs
 * BEFORE there is an account:
 *
 *   1. /support → one button → Stripe's own page, where they type an email and a card.
 *   2. The webhook makes the account from that email (lib/monetization/supportGuestAccount).
 *   3. The thank-you page signs them in, and an email carries a one-tap sign-in link.
 *
 * 🛑 THE STRIPE PAGE'S EMAIL IS NOT PROOF ANYONE OWNS IT. Anyone can type anyone's address.
 * So the thank-you page signs the buyer in only when the account is BRAND NEW (made by this
 * very checkout). When the email already has an account, the payment is attached to it and
 * the sign-in link goes to that inbox — the owner's — never to the browser that paid.
 *
 * ⚠ WEB ONLY. The iOS app must sell through Apple and the Android app through Google Play;
 * the route lives under /api/monetization/checkout so middleware's iOS refusal and paid-geo
 * gate cover it with no new list entry, and the /support page sends the Android app to the
 * Play purchase surface instead of this button.
 */
import type Stripe from "stripe"

import { getMonetizationCatalogItemBySku, getMonetizationStripePriceIdForSku, type MonetizationSku } from "@/lib/monetization/catalog"
import { getBaseUrl } from "@/lib/get-base-url"

/** The plan a supporter buys. AF Pro monthly: an existing Stripe price, and a real plan if they ever look around. */
export const SUPPORT_GUEST_SKU: MonetizationSku = "af_pro_monthly"

/** Metadata marker the webhook reads. Set server-side only, at session creation. */
export const SUPPORT_GUEST_METADATA_FLAG = "supportGuest"

export const SUPPORT_GUEST_ENTRY_SOURCE = "support_link"

export const SUPPORT_WELCOME_PATH = "/support/welcome"

/** The supporter plan's monthly price, for the page. Null when the catalog does not carry it. */
export function supportGuestPriceUsd(): number | null {
  const item = getMonetizationCatalogItemBySku(SUPPORT_GUEST_SKU)
  return item ? item.amountUsd : null
}

/** True for a session this module created. Reads metadata only — never the buyer-controlled client reference. */
export function isSupportGuestCheckoutSession(session: Pick<Stripe.Checkout.Session, "metadata">): boolean {
  return (session.metadata ?? {})[SUPPORT_GUEST_METADATA_FLAG] === "1"
}

/** Whether the buyer ticked the 18+ / terms box on /support, carried to the webhook. */
export function supportGuestAgeConfirmed(session: Pick<Stripe.Checkout.Session, "metadata">): boolean {
  return (session.metadata ?? {}).ageConfirmed === "1"
}

/**
 * The Stripe Checkout params for a buyer with no account. No `userId`, no `client_reference_id`
 * and no `customer_email`: Stripe asks for the email, and the webhook decides whose it is.
 * Returns null when the plan has no Stripe price configured.
 */
export function buildSupportGuestCheckoutParams(input: {
  ageConfirmed: boolean
  env?: NodeJS.ProcessEnv
  baseUrl?: string
}): Stripe.Checkout.SessionCreateParams | null {
  const priceId = getMonetizationStripePriceIdForSku(SUPPORT_GUEST_SKU, input.env ?? process.env)
  if (!priceId) return null
  const base = input.baseUrl ?? getBaseUrl()

  const metadata: Record<string, string> = {
    sku: SUPPORT_GUEST_SKU,
    purchaseType: "subscription",
    entrySource: SUPPORT_GUEST_ENTRY_SOURCE,
    [SUPPORT_GUEST_METADATA_FLAG]: "1",
    ageConfirmed: input.ageConfirmed ? "1" : "0",
  }

  return {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    metadata,
    subscription_data: { metadata: { ...metadata } },
    success_url: `${base}${SUPPORT_WELCOME_PATH}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/support?checkout=cancelled`,
    // The paid-state card check reads the billing address (lib/subscription/paidStateRefusal).
    billing_address_collection: "required",
  }
}
