import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"

/*
 * Founding-member pricing at checkout (lib/monetization/foundingMember.ts):
 *  - an account created BEFORE the paywall start gets STRIPE_FOUNDING_COUPON_ID on a subscription;
 *  - a post-launch account does not; with the env var unset nobody does (today's behaviour);
 *  - `discounts` and `allow_promotion_codes` are NEVER sent together (Stripe rejects that);
 *  - token packs are untouched, and a sponsor code the buyer typed still wins.
 * Stripe and Prisma are mocked — nothing here reaches a network or a database.
 */

const mocks = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
  couponsRetrieve: vi.fn(),
  couponsCreate: vi.fn(),
  findUnique: vi.fn(),
  getServerSession: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/stripe-client", () => ({
  getStripeClient: () => ({
    checkout: { sessions: { create: mocks.sessionsCreate } },
    coupons: { retrieve: mocks.couponsRetrieve, create: mocks.couponsCreate },
  }),
}))
vi.mock("@/lib/get-base-url", () => ({ getBaseUrl: () => "https://app.example.com" }))
vi.mock("@/lib/prisma", () => ({ prisma: { appUser: { findUnique: mocks.findUnique } } }))
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/geo/enforcePaidSubscriptionGeo", () => ({ enforcePaidSubscriptionGeo: vi.fn(async () => null) }))
vi.mock("@/lib/meta-capi", () => ({ trackMetaServerEvent: vi.fn(async () => null) }))
vi.mock("@/lib/monetization/stripeCustomerForUser", () => ({
  findStripeCustomerIdForUser: vi.fn(async () => null),
  findLiveStripePlanFamiliesForUser: vi.fn(async () => new Set()),
  duplicatePlanReason: vi.fn(() => null),
}))
vi.mock("@/lib/promotions/sponsorCoupon", () => ({
  validateCouponForUser: vi.fn(async ({ rawCode }: { rawCode: string }) =>
    rawCode.toUpperCase() === "WASSUPFRED"
      ? { valid: true, normalizedCode: "WASSUPFRED", discountPercent: 20 }
      : { valid: false }
  ),
  createPendingRedemption: vi.fn(async () => null),
  calculateDiscountedAmounts: vi.fn((subtotal: number, pct: number) => ({
    discountAmountCents: Math.round((subtotal * pct) / 100),
    totalCents: subtotal - Math.round((subtotal * pct) / 100),
  })),
  findSponsorCoupon: vi.fn(() => null),
  normalizeCouponCode: vi.fn((c: string) => c.toUpperCase()),
}))

import { buildStripeCheckoutSessionForSku } from "@/lib/monetization/StripeCheckoutSession"
import { POST as postSubscription } from "@/app/api/monetization/checkout/subscription/route"
import { POST as postTokens } from "@/app/api/monetization/checkout/tokens/route"
import { DEFAULT_PAYWALL_STARTS_AT } from "@/lib/monetization/paywallLaunch"

const FOUNDING = "coupon_founding_test"
const PRE_LAUNCH = new Date(DEFAULT_PAYWALL_STARTS_AT.getTime() - 24 * 3600 * 1000)
const POST_LAUNCH = new Date(DEFAULT_PAYWALL_STARTS_AT.getTime() + 60 * 1000)

const ENV_KEYS = [
  "STRIPE_PRICE_AF_PRO_MONTHLY",
  "STRIPE_PRICE_AF_TOKENS_10",
  "STRIPE_FOUNDING_COUPON_ID",
  "AF_PAYWALL_STARTS_AT",
] as const

function lastParams(): Record<string, any> {
  const calls = mocks.sessionsCreate.mock.calls
  return calls[calls.length - 1]![0]
}

/** Stripe Checkout rejects a session carrying both; no path may ever build one. */
function expectNeverBoth() {
  for (const [params] of mocks.sessionsCreate.mock.calls) {
    expect(Boolean(params.discounts) && params.allow_promotion_codes === true).toBe(false)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_PRICE_AF_PRO_MONTHLY = "price_pro_monthly_test"
  process.env.STRIPE_PRICE_AF_TOKENS_10 = "price_tokens_10_test"
  process.env.STRIPE_FOUNDING_COUPON_ID = FOUNDING
  delete process.env.AF_PAYWALL_STARTS_AT
  mocks.sessionsCreate.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" })
  mocks.couponsRetrieve.mockResolvedValue({ id: "af_sponsor_wassupfred_20pct" })
  mocks.getServerSession.mockResolvedValue({ user: { id: "user-1", email: "buyer@test.dev" } })
})

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

describe("buildStripeCheckoutSessionForSku — founding coupon", () => {
  it("applies the founding coupon to a founding member's subscription, without allow_promotion_codes", async () => {
    const result = await buildStripeCheckoutSessionForSku({ sku: "af_pro_monthly", userId: "u1", foundingMember: true })
    const params = lastParams()
    expect(params.discounts).toEqual([{ coupon: FOUNDING }])
    expect(params.allow_promotion_codes).toBeUndefined()
    expect(result?.foundingDiscountApplied).toBe(true)
  })

  it("does not apply it to a non-founding account — today's promo-code behaviour", async () => {
    const result = await buildStripeCheckoutSessionForSku({ sku: "af_pro_monthly", userId: "u1", foundingMember: false })
    const params = lastParams()
    expect(params.discounts).toBeUndefined()
    expect(params.allow_promotion_codes).toBe(true)
    expect(result?.foundingDiscountApplied).toBe(false)
  })

  it("does nothing when STRIPE_FOUNDING_COUPON_ID is unset, even for a founding member", async () => {
    delete process.env.STRIPE_FOUNDING_COUPON_ID
    await buildStripeCheckoutSessionForSku({ sku: "af_pro_monthly", userId: "u1", foundingMember: true })
    const params = lastParams()
    expect(params.discounts).toBeUndefined()
    expect(params.allow_promotion_codes).toBe(true)
  })

  it("never puts the founding coupon on a token pack", async () => {
    const result = await buildStripeCheckoutSessionForSku({ sku: "af_tokens_10", userId: "u1", foundingMember: true })
    const params = lastParams()
    expect(params.mode).toBe("payment")
    expect(params.discounts).toBeUndefined()
    expect(params.allow_promotion_codes).toBe(true)
    expect(result?.foundingDiscountApplied).toBe(false)
  })

  it("lets a validated sponsor code win — exactly one discount, the one the buyer was shown", async () => {
    await buildStripeCheckoutSessionForSku({
      sku: "af_pro_monthly",
      userId: "u1",
      foundingMember: true,
      couponCode: "WASSUPFRED",
      couponPercentOff: 20,
    })
    const params = lastParams()
    expect(params.discounts).toEqual([{ coupon: "af_sponsor_wassupfred_20pct" }])
    expect(params.allow_promotion_codes).toBeUndefined()
  })

  it("retries without the coupon when Stripe rejects it, so a bad coupon never blocks a purchase", async () => {
    mocks.sessionsCreate
      .mockRejectedValueOnce(Object.assign(new Error("No such coupon"), { type: "StripeInvalidRequestError", code: "resource_missing", param: "discounts[0][coupon]" }))
      .mockResolvedValueOnce({ id: "cs_test_2", url: "https://checkout.stripe.com/c/pay/cs_test_2" })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = await buildStripeCheckoutSessionForSku({ sku: "af_pro_monthly", userId: "u1", foundingMember: true })
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(2)
    expect(lastParams().discounts).toBeUndefined()
    expect(lastParams().allow_promotion_codes).toBe(true)
    expect(result?.url).toBe("https://checkout.stripe.com/c/pay/cs_test_2")
    expect(result?.foundingDiscountApplied).toBe(false)
    warn.mockRestore()
  })

  it("does not swallow an unrelated Stripe failure", async () => {
    mocks.sessionsCreate.mockRejectedValueOnce(Object.assign(new Error("boom"), { type: "StripeAPIError" }))
    await expect(
      buildStripeCheckoutSessionForSku({ sku: "af_pro_monthly", userId: "u1", foundingMember: true })
    ).rejects.toThrow("boom")
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1)
  })

  it("never combines discounts with allow_promotion_codes, across every combination", async () => {
    for (const sku of ["af_pro_monthly", "af_tokens_10"] as const) {
      for (const foundingMember of [true, false, null]) {
        for (const coupon of [true, false]) {
          for (const envSet of [true, false]) {
            if (envSet) process.env.STRIPE_FOUNDING_COUPON_ID = FOUNDING
            else delete process.env.STRIPE_FOUNDING_COUPON_ID
            await buildStripeCheckoutSessionForSku({
              sku,
              userId: "u1",
              foundingMember,
              couponCode: coupon ? "WASSUPFRED" : null,
              couponPercentOff: coupon ? 20 : null,
            })
          }
        }
      }
    }
    expect(mocks.sessionsCreate.mock.calls.length).toBe(24)
    expectNeverBoth()
  })
})

function subscriptionRequest(body: Record<string, unknown>) {
  return createMockNextRequest("http://localhost/api/monetization/checkout/subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  })
}

describe("POST /api/monetization/checkout/subscription — founding members", () => {
  it("applies the coupon for an account created before the paywall start", async () => {
    mocks.findUnique.mockResolvedValue({ createdAt: PRE_LAUNCH })
    const res = await postSubscription(subscriptionRequest({ sku: "af_pro_monthly" }))
    expect(res.status).toBe(200)
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: "user-1" }, select: { createdAt: true } })
    expect(lastParams().discounts).toEqual([{ coupon: FOUNDING }])
    expect(lastParams().allow_promotion_codes).toBeUndefined()
    await expect(res.json()).resolves.toMatchObject({ foundingDiscountApplied: true })
  })

  it("does not apply it for an account created after the paywall start", async () => {
    mocks.findUnique.mockResolvedValue({ createdAt: POST_LAUNCH })
    const res = await postSubscription(subscriptionRequest({ sku: "af_pro_monthly" }))
    expect(res.status).toBe(200)
    expect(lastParams().discounts).toBeUndefined()
    expect(lastParams().allow_promotion_codes).toBe(true)
    await expect(res.json()).resolves.toMatchObject({ foundingDiscountApplied: false })
  })

  it("follows a postponed launch: AF_PAYWALL_STARTS_AT moves who counts as a founding member", async () => {
    process.env.AF_PAYWALL_STARTS_AT = new Date(POST_LAUNCH.getTime() + 3600 * 1000).toISOString()
    mocks.findUnique.mockResolvedValue({ createdAt: POST_LAUNCH })
    await postSubscription(subscriptionRequest({ sku: "af_pro_monthly" }))
    expect(lastParams().discounts).toEqual([{ coupon: FOUNDING }])
  })

  it("with STRIPE_FOUNDING_COUPON_ID unset: no account lookup and exactly today's session", async () => {
    delete process.env.STRIPE_FOUNDING_COUPON_ID
    mocks.findUnique.mockResolvedValue({ createdAt: PRE_LAUNCH })
    const res = await postSubscription(subscriptionRequest({ sku: "af_pro_monthly" }))
    expect(res.status).toBe(200)
    expect(mocks.findUnique).not.toHaveBeenCalled()
    expect(lastParams().discounts).toBeUndefined()
    expect(lastParams().allow_promotion_codes).toBe(true)
  })

  it("an account whose creation date cannot be read is not treated as a founding member", async () => {
    mocks.findUnique.mockRejectedValue(new Error("db down"))
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await postSubscription(subscriptionRequest({ sku: "af_pro_monthly" }))
    expect(res.status).toBe(200)
    expect(lastParams().discounts).toBeUndefined()
    expect(lastParams().allow_promotion_codes).toBe(true)
    err.mockRestore()
  })

  it("a validated sponsor code wins and skips the founding lookup", async () => {
    mocks.findUnique.mockResolvedValue({ createdAt: PRE_LAUNCH })
    const res = await postSubscription(subscriptionRequest({ sku: "af_pro_monthly", couponCode: "WassupFred" }))
    expect(res.status).toBe(200)
    expect(mocks.findUnique).not.toHaveBeenCalled()
    expect(lastParams().discounts).toEqual([{ coupon: "af_sponsor_wassupfred_20pct" }])
    expectNeverBoth()
  })
})

describe("POST /api/monetization/checkout/tokens — untouched by founding pricing", () => {
  it("a founding member buying a token pack gets no founding coupon and no account lookup", async () => {
    mocks.findUnique.mockResolvedValue({ createdAt: PRE_LAUNCH })
    const res = await postTokens(
      createMockNextRequest("http://localhost/api/monetization/checkout/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { sku: "af_tokens_10" },
      })
    )
    expect(res.status).toBe(200)
    expect(mocks.findUnique).not.toHaveBeenCalled()
    expect(lastParams().mode).toBe("payment")
    expect(lastParams().discounts).toBeUndefined()
    expect(lastParams().allow_promotion_codes).toBe(true)
  })
})
