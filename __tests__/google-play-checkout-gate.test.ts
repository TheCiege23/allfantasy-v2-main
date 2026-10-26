/**
 * Inside our Android app every purchase must go to Google Play Billing and
 * never reach the Stripe checkout endpoints (Play payments policy).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let inTwa = true
const purchaseWithGooglePlay = vi.fn()

vi.mock("@/lib/platform/isTrustedWebActivity", () => ({ isTrustedWebActivity: () => inTwa }))
vi.mock("@/lib/monetization/apple-iap-client", () => ({ isAppleApp: () => false, purchaseWithApple: vi.fn() }))
vi.mock("@/lib/monetization/google-play-client", () => ({
  purchaseWithGooglePlay: (sku: string) => purchaseWithGooglePlay(sku),
}))

describe("resolveCheckoutUrl inside the Android app", () => {
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ url: "https://checkout.stripe.com/x" })))
  beforeEach(() => {
    vi.clearAllMocks()
    inTwa = true
    vi.stubGlobal("fetch", fetchSpy)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("completes through Google Play and never calls the Stripe checkout", async () => {
    purchaseWithGooglePlay.mockResolvedValue({ cancelled: false })
    const { resolveCheckoutUrl } = await import("@/lib/monetization/checkout-client")
    const result = await resolveCheckoutUrl({ sku: "af_pro_monthly", productType: "subscription", returnPath: "/pricing" })
    expect(result).toEqual({ ok: true, completed: true })
    expect(purchaseWithGooglePlay).toHaveBeenCalledWith("af_pro_monthly")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("reports a Play failure as an error and still never falls through to Stripe", async () => {
    purchaseWithGooglePlay.mockRejectedValue(new Error("Update the AllFantasy app from Google Play to make purchases."))
    const { resolveCheckoutUrl } = await import("@/lib/monetization/checkout-client")
    const result = await resolveCheckoutUrl({ sku: "af_tokens_5", productType: "token_pack", returnPath: "/tokens" })
    expect(result).toEqual({ ok: false, error: "Update the AllFantasy app from Google Play to make purchases." })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("leaves the open web on Stripe", async () => {
    inTwa = false
    const { resolveCheckoutUrl } = await import("@/lib/monetization/checkout-client")
    const result = await resolveCheckoutUrl({ sku: "af_pro_monthly", productType: "subscription", returnPath: "/pricing" })
    expect(result).toMatchObject({ ok: true, url: "https://checkout.stripe.com/x" })
    expect(purchaseWithGooglePlay).not.toHaveBeenCalled()
  })
})
