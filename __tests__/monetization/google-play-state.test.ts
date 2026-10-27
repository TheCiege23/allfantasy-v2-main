// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { parsePlayPurchase } from "@/lib/google-play/billingState"
import { playBillingCatalog } from "@/lib/google-play/billingCatalog"
import { decryptPurchaseToken, encryptPurchaseToken, playCheckoutEnabled, purchaseHash } from "@/lib/google-play/billingConfig"
const sub = () => ({ subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", startTime: "2026-10-26T00:00:00Z", acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
  lineItems: [{ productId: "af_pro_monthly", expiryTime: "2026-11-26T00:00:00Z", autoRenewingPlan: { autoRenewEnabled: true }, offerDetails: { basePlanId: "standard" } }] })
const pack = () => ({ purchaseStateContext: { purchaseState: "PURCHASED" }, purchaseCompletionTime: "2026-10-26T00:00:00Z",
  productLineItem: [{ productId: "af_tokens_5", productOfferDetails: { quantity: 1, refundableQuantity: 1, consumptionState: "CONSUMPTION_STATE_YET_TO_BE_CONSUMED" } }] })
afterEach(() => vi.unstubAllEnvs())
describe("Google Play authoritative billing state", () => {
  it("maps eight distinct subscriptions and three packs to the central catalog", () => {
    const all = playBillingCatalog()
    expect(all).toHaveLength(11)
    expect(new Set(all.map(p => p.productId)).size).toBe(11)
    expect(all.find(p => p.productId === "af_legacy_yearly")?.sku).toBe("af_war_room_yearly")
    expect(all.filter(p => p.type === "subscription").every(p => p.tokenAmount === null)).toBe(true)
  })
  it.each([["ACTIVE", "active"], ["CANCELED", "canceled"], ["IN_GRACE_PERIOD", "grace"], ["ON_HOLD", "expired"], ["PAUSED", "expired"], ["EXPIRED", "expired"], ["PENDING", "pending"], ["PENDING_PURCHASE_CANCELED", "expired"]])("maps %s to %s", (state, expected) => {
    expect(parsePlayPurchase("subscription", { ...sub(), subscriptionState: `SUBSCRIPTION_STATE_${state}` }, "af_pro_monthly").status).toBe(expected)
  })
  it("rejects a receipt for a different product", () => expect(() => parsePlayPurchase("subscription", sub(), "af_pro_yearly")).toThrow(/match/))
  it("rejects missing subscription expiry instead of unlimited access", () => {
    const p = sub(); p.lineItems[0].expiryTime = ""
    expect(() => parsePlayPurchase("subscription", p, "af_pro_monthly")).toThrow(/period/)
  })
  it("rejects a different base plan or introductory offer", () => {
    const p = sub(); p.lineItems[0].offerDetails.basePlanId = "other"
    expect(() => parsePlayPurchase("subscription", p, "af_pro_monthly")).toThrow(/plan/)
    expect(() => parsePlayPurchase("subscription", { ...sub(), lineItems: [{ ...sub().lineItems[0], offerDetails: { basePlanId: "standard", offerId: "trial" } }] }, "af_pro_monthly")).toThrow(/plan/)
  })
  it("pending money never becomes a token grant", () => {
    expect(parsePlayPurchase("token_pack", { ...pack(), purchaseStateContext: { purchaseState: "PENDING" } }, "af_tokens_5")).toMatchObject({ status: "pending", needsFinish: false })
  })
  it.each([0, 2, -1])("rejects unsupported token pack quantity %s", quantity => {
    const p = pack(); p.productLineItem[0].productOfferDetails.quantity = quantity
    expect(() => parsePlayPurchase("token_pack", p, "af_tokens_5")).toThrow(/single/)
  })
  it("a fully refunded quantity is revoked even if the top-level state is PURCHASED", () => {
    const p = pack(); p.productLineItem[0].productOfferDetails.refundableQuantity = 0
    expect(parsePlayPurchase("token_pack", p, "af_tokens_5")).toMatchObject({ revoked: true, status: "expired", needsFinish: false })
  })
  it("a consumed pack needs no consume retry", () => {
    const p = pack(); p.productLineItem[0].productOfferDetails.consumptionState = "CONSUMPTION_STATE_CONSUMED"
    expect(parsePlayPurchase("token_pack", p, "af_tokens_5")).toMatchObject({ consumed: true, needsFinish: false })
  })
  it("stores authenticated ciphertext and rejects tampering", () => {
    vi.stubEnv("GOOGLE_PLAY_PURCHASE_ENCRYPTION_KEY", "ab".repeat(32))
    const token = "private-receipt-identifier", ciphertext = encryptPurchaseToken(token)
    expect(ciphertext).not.toContain(token)
    expect(decryptPurchaseToken(ciphertext)).toBe(token)
    const parts = ciphertext.split("."); parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1)
    expect(() => decryptPurchaseToken(parts.join("."))).toThrow()
    expect(purchaseHash(token)).toHaveLength(64)
  })
  it("does not enable checkout from a flag alone", () => {
    vi.stubEnv("GOOGLE_PLAY_BILLING_ENABLED", "true")
    vi.stubEnv("GOOGLE_PLAY_BILLING_SERVICE_ACCOUNT_JSON", "")
    vi.stubEnv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "")
    expect(playCheckoutEnabled()).toBe(false)
  })
})
