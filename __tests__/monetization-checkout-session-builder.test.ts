import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Pricing-truth guard (Release Readiness Phase 1, blocker B3): the canonical
// checkout Session must charge the SAME Stripe Price the catalog points at, so
// the amount charged is structurally equal to the displayed catalog price. The
// old Payment Link flow could not guarantee this (amount lived in the hosted link).

const { sessionsCreateMock, getStripeClientMock, getBaseUrlMock } = vi.hoisted(() => ({
  sessionsCreateMock: vi.fn(),
  getStripeClientMock: vi.fn(),
  getBaseUrlMock: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/stripe-client", () => ({ getStripeClient: getStripeClientMock }))
vi.mock("@/lib/get-base-url", () => ({ getBaseUrl: getBaseUrlMock }))

import { buildStripeCheckoutSessionForSku } from "@/lib/monetization/StripeCheckoutSession"
import { getMonetizationStripePriceIdForSku } from "@/lib/monetization/catalog"

const PRICE_ENV = {
  STRIPE_PRICE_AF_PRO_MONTHLY: "price_pro_monthly_test",
  STRIPE_PRICE_AF_TOKENS_5: "price_tokens_5_test",
} as const

describe("buildStripeCheckoutSessionForSku — pricing-truth", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBaseUrlMock.mockReturnValue("https://app.example.com")
    getStripeClientMock.mockReturnValue({
      checkout: { sessions: { create: sessionsCreateMock } },
    })
    sessionsCreateMock.mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    })
    for (const [k, v] of Object.entries(PRICE_ENV)) process.env[k] = v
  })
  afterEach(() => {
    for (const k of Object.keys(PRICE_ENV)) delete process.env[k as keyof typeof PRICE_ENV]
  })

  it("charges the catalog price id for a subscription and sets webhook-compatible ids", async () => {
    const result = await buildStripeCheckoutSessionForSku({
      sku: "af_pro_monthly",
      userId: "user_1",
      userEmail: "buyer@example.com",
      returnPath: "/pricing",
    })

    expect(result).not.toBeNull()
    expect(result?.url).toBe("https://checkout.stripe.com/c/pay/cs_test_123")
    expect(result?.purchaseType).toBe("subscription")

    // The line item price MUST equal the catalog-resolved price id (single source of truth).
    const catalogPriceId = getMonetizationStripePriceIdForSku("af_pro_monthly")
    expect(catalogPriceId).toBe("price_pro_monthly_test")

    const params = sessionsCreateMock.mock.calls[0][0]
    expect(params.mode).toBe("subscription")
    expect(params.line_items).toEqual([{ price: "price_pro_monthly_test", quantity: 1 }])
    expect(String(params.client_reference_id)).toMatch(/^af1_/)
    expect(params.metadata).toMatchObject({
      userId: "user_1",
      sku: "af_pro_monthly",
      purchaseType: "subscription",
    })
    expect(params.allow_promotion_codes).toBe(true)
    // The paid-state card check reads the billing address (lib/subscription/paidStateRefusal).
    expect(params.billing_address_collection).toBe("required")
    expect(params.customer_email).toBe("buyer@example.com")
    expect(params.subscription_data?.metadata).toMatchObject({ sku: "af_pro_monthly" })
    expect(String(params.success_url)).toContain("https://app.example.com/pricing")
    expect(String(params.success_url)).toContain("{CHECKOUT_SESSION_ID}")
  })

  it("uses mode=payment and no subscription_data for a token pack", async () => {
    const result = await buildStripeCheckoutSessionForSku({
      sku: "af_tokens_5",
      userId: "user_2",
    })
    expect(result?.purchaseType).toBe("tokens")
    const params = sessionsCreateMock.mock.calls[0][0]
    expect(params.mode).toBe("payment")
    expect(params.line_items).toEqual([{ price: "price_tokens_5_test", quantity: 1 }])
    expect(params.subscription_data).toBeUndefined()
  })

  it("reuses the user's Stripe customer instead of sending customer_email", async () => {
    await buildStripeCheckoutSessionForSku({
      sku: "af_pro_monthly",
      userId: "user_1",
      userEmail: "buyer@example.com",
      stripeCustomerId: "cus_existing",
    })
    const params = sessionsCreateMock.mock.calls[0][0]
    expect(params.customer).toBe("cus_existing")
    // The Checkout API rejects a session carrying both.
    expect(params.customer_email).toBeUndefined()
  })

  it("CHARGES a validated sponsor discount — the session carries the coupon, not just metadata", async () => {
    const couponsRetrieve = vi.fn().mockRejectedValue(Object.assign(new Error("No such coupon"), { code: "resource_missing" }))
    const couponsCreate = vi.fn().mockImplementation(async (p: { id: string }) => ({ id: p.id }))
    getStripeClientMock.mockReturnValue({
      checkout: { sessions: { create: sessionsCreateMock } },
      coupons: { retrieve: couponsRetrieve, create: couponsCreate },
    })

    await buildStripeCheckoutSessionForSku({
      sku: "af_pro_monthly",
      userId: "user_1",
      couponCode: "WASSUPFRED",
      couponPercentOff: 20,
    })

    expect(couponsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "af_sponsor_wassupfred_20pct", percent_off: 20, duration: "once" })
    )
    const params = sessionsCreateMock.mock.calls[0][0]
    expect(params.discounts).toEqual([{ coupon: "af_sponsor_wassupfred_20pct" }])
    // Mutually exclusive with `discounts` in the Checkout API.
    expect(params.allow_promotion_codes).toBeUndefined()
  })

  it("reuses an existing sponsor coupon rather than creating a second one", async () => {
    const couponsRetrieve = vi.fn().mockResolvedValue({ id: "af_sponsor_wassupfred_20pct" })
    const couponsCreate = vi.fn()
    getStripeClientMock.mockReturnValue({
      checkout: { sessions: { create: sessionsCreateMock } },
      coupons: { retrieve: couponsRetrieve, create: couponsCreate },
    })
    await buildStripeCheckoutSessionForSku({
      sku: "af_pro_monthly",
      userId: "user_1",
      couponCode: "WASSUPFRED",
      couponPercentOff: 20,
    })
    expect(couponsCreate).not.toHaveBeenCalled()
    expect(sessionsCreateMock.mock.calls[0][0].discounts).toEqual([{ coupon: "af_sponsor_wassupfred_20pct" }])
  })

  it("fails soft (null, no Stripe call) when the price id env var is unset", async () => {
    delete process.env.STRIPE_PRICE_AF_PRO_MONTHLY
    const result = await buildStripeCheckoutSessionForSku({
      sku: "af_pro_monthly",
      userId: "user_3",
    })
    expect(result).toBeNull()
    expect(sessionsCreateMock).not.toHaveBeenCalled()
  })
})
