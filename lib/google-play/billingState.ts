import { playProduct, PLAY_BASE_PLAN } from "./billingCatalog"
import { PlayBillingError } from "./billingConfig"

export type VerifiedPlayPurchase = {
  product: NonNullable<ReturnType<typeof playProduct>>
  state: string; status: "active" | "canceled" | "grace" | "expired" | "pending"
  start: Date | null; end: Date | null; accountId: string | null; linkedToken: string | null
  needsFinish: boolean; consumed: boolean; revoked: boolean; orderId: string | null
}
function date(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}
export function parsePlayPurchase(type: "subscription" | "token_pack", body: unknown, expectedProduct: string): VerifiedPlayPurchase {
  if (!body || typeof body !== "object") throw new PlayBillingError("Incomplete Google Play response.", 502)
  const b = body as Record<string, any>
  const product = playProduct(expectedProduct)
  if (!product || product.type !== type) throw new PlayBillingError("Unknown Google Play product.")
  const lines = type === "subscription" ? b.lineItems : b.productLineItem
  if (!Array.isArray(lines) || lines.length !== 1 || lines[0]?.productId !== expectedProduct) {
    throw new PlayBillingError("Google Play product does not match this purchase.")
  }
  const line = lines[0]
  if (type === "subscription") {
    if (line.offerDetails?.basePlanId !== PLAY_BASE_PLAN || line.offerDetails?.offerId || !line.autoRenewingPlan) {
      throw new PlayBillingError("Unsupported Google Play subscription plan.")
    }
    const state = b.subscriptionState
    const status = ({ SUBSCRIPTION_STATE_ACTIVE: "active", SUBSCRIPTION_STATE_CANCELED: "canceled",
      SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "grace", SUBSCRIPTION_STATE_PENDING: "pending",
      SUBSCRIPTION_STATE_PAUSED: "expired", SUBSCRIPTION_STATE_ON_HOLD: "expired",
      SUBSCRIPTION_STATE_EXPIRED: "expired", SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: "expired" } as Record<string, VerifiedPlayPurchase["status"]>)[state as string]
    if (!status) throw new PlayBillingError("Unknown Google Play subscription state.", 502)
    const end = date(line.expiryTime), start = date(b.startTime)
    if (["active", "grace", "canceled"].includes(status) && (!end || !start)) throw new PlayBillingError("Google Play subscription period is missing.", 502)
    return { product, state, status, start, end, accountId: b.externalAccountIdentifiers?.obfuscatedExternalAccountId || null,
      linkedToken: b.linkedPurchaseToken || null, needsFinish: b.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING",
      consumed: false, revoked: false, orderId: line.latestSuccessfulOrderId || null }
  }
  const state = b.purchaseStateContext?.purchaseState
  if (!["PURCHASED", "PENDING", "CANCELLED"].includes(state)) throw new PlayBillingError("Unknown Google Play purchase state.", 502)
  const offer = line.productOfferDetails
  if (offer?.quantity !== 1) throw new PlayBillingError("Only single Google Play token packs are supported.")
  const revoked = state === "CANCELLED" || offer.refundableQuantity === 0
  const consumed = offer.consumptionState === "CONSUMPTION_STATE_CONSUMED"
  if (!consumed && offer.consumptionState !== "CONSUMPTION_STATE_YET_TO_BE_CONSUMED") throw new PlayBillingError("Incomplete Google Play consumption state.", 502)
  return { product, state, status: revoked ? "expired" : state === "PENDING" ? "pending" : "active",
    start: date(b.purchaseCompletionTime), end: null, accountId: b.obfuscatedExternalAccountId || null,
    linkedToken: null, needsFinish: !consumed && state === "PURCHASED" && !revoked, consumed, revoked,
    orderId: b.orderId || null }
}
