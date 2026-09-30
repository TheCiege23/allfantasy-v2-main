import type Stripe from "stripe"
import { getMonetizationStripePriceIdForSku, type MonetizationSku } from "@/lib/monetization/catalog"

/**
 * ⚠ `client_reference_id` IS BUYER-CONTROLLED. It is plain base64 JSON, and on a
 * `buy.stripe.com` Payment Link it is a URL parameter the buyer can rewrite — so
 * "pay for the cheapest link, claim af_supreme_yearly" granted Supreme. Session
 * metadata is set server-side at creation and needs no such check; a SKU that
 * came from client_reference_id only stands if the session actually bought that
 * SKU's catalog price.
 *
 * Returns a reason instead of throwing so the webhook decides how to refuse.
 */
export async function verifyClientReferenceSkuPurchase(
  stripe: Pick<Stripe, "checkout">,
  session: Pick<Stripe.Checkout.Session, "id">,
  sku: MonetizationSku,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const expectedPriceId = getMonetizationStripePriceIdForSku(sku, env)
  if (!expectedPriceId) {
    return { ok: false, reason: `client_reference_id claims sku ${sku}, which has no configured Stripe price` }
  }
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 20 })
  const boughtIt = lineItems.data.some((item) => item.price?.id === expectedPriceId)
  if (!boughtIt) {
    return {
      ok: false,
      reason: `client_reference_id claims sku ${sku} but session ${session.id} did not buy its catalog price`,
    }
  }
  return { ok: true }
}
