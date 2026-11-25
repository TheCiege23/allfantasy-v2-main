import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/*
 * The Black Friday → Cyber Monday sale (lib/monetization/holidaySale.ts) and its coupon at checkout.
 * Pins: the window opens Friday 00:00 ET and closes at the end of Monday ET; 50% off the first year on
 * both intervals; the shown price is never lower than the charge; the sale outranks founding pricing
 * and the Partner Code discount but not a bigger typed sponsor code; a Partner Code buyer stays
 * credited; a coupon Stripe will not create never blocks a purchase; token packs never get it.
 * Stripe is mocked — nothing here reaches the network.
 */

const mocks = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
  couponsRetrieve: vi.fn(),
  couponsCreate: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/stripe-client", () => ({
  getStripeClient: () => ({
    checkout: { sessions: { create: mocks.sessionsCreate } },
    coupons: { retrieve: mocks.couponsRetrieve, create: mocks.couponsCreate },
  }),
}))
vi.mock("@/lib/get-base-url", () => ({ getBaseUrl: () => "https://app.example.com" }))

import {
  getHolidaySale,
  holidaySaleCouponSpec,
  holidaySaleName,
  holidaySalePriceCents,
  holidaySalePriceUsd,
  holidaySaleWindow,
} from "@/lib/monetization/holidaySale"
import { buildStripeCheckoutSessionForSku } from "@/lib/monetization/StripeCheckoutSession"

const DURING = new Date("2026-11-28T17:00:00.000Z") // Saturday noon ET
const BEFORE = new Date("2026-11-27T04:59:59.000Z") // Thursday 11:59:59 PM ET
const LAST_SECOND = new Date("2026-12-01T04:59:59.000Z") // Monday 11:59:59 PM ET
const AFTER = new Date("2026-12-01T05:00:00.000Z") // Tuesday 00:00 ET

const ENV_KEYS = [
  "STRIPE_PRICE_AF_PRO_MONTHLY",
  "STRIPE_PRICE_AF_PRO_YEARLY",
  "STRIPE_PRICE_AF_TOKENS_10",
  "STRIPE_FOUNDING_COUPON_ID",
  "HOLIDAY_SALE_IN_TESTS",
  "NEXT_PUBLIC_HOLIDAY_SALE_DISABLED",
] as const

const lastParams = (): Record<string, any> => mocks.sessionsCreate.mock.calls.at(-1)![0]

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_PRICE_AF_PRO_MONTHLY = "price_pro_monthly_test"
  process.env.STRIPE_PRICE_AF_PRO_YEARLY = "price_pro_yearly_test"
  process.env.STRIPE_PRICE_AF_TOKENS_10 = "price_tokens_10_test"
  process.env.HOLIDAY_SALE_IN_TESTS = "1"
  mocks.sessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" })
  mocks.couponsRetrieve.mockRejectedValue(Object.assign(new Error("No such coupon"), { code: "resource_missing" }))
  mocks.couponsCreate.mockImplementation(async (args: { id: string }) => ({ id: args.id }))
})
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

describe("the sale window", () => {
  it("runs from Friday 00:00 ET to the end of Monday ET, and not a second outside it", () => {
    expect(getHolidaySale(BEFORE)).toBeNull()
    expect(getHolidaySale(new Date("2026-11-27T05:00:00.000Z"))?.percentOff).toBe(50)
    expect(getHolidaySale(DURING)).not.toBeNull()
    expect(getHolidaySale(LAST_SECOND)).not.toBeNull()
    expect(getHolidaySale(AFTER)).toBeNull()
  })

  it("is off inside the test runner unless a test asks, so no other suite sees half prices on Nov 27–30", () => {
    delete process.env.HOLIDAY_SALE_IN_TESTS
    expect(getHolidaySale(DURING)).toBeNull()
  })

  it("has a kill switch, and staging can move the window", () => {
    expect(holidaySaleWindow({ NEXT_PUBLIC_HOLIDAY_SALE_DISABLED: "1" })).toBeNull()
    const early = { NEXT_PUBLIC_HOLIDAY_SALE_STARTS_AT: "2026-11-24T00:00:00Z" }
    expect(getHolidaySale(new Date("2026-11-25T00:00:00Z"), early)).not.toBeNull()
    // A broken override falls back to the real window rather than running forever.
    expect(holidaySaleWindow({ NEXT_PUBLIC_HOLIDAY_SALE_ENDS_AT: "not a date" })?.endsAt).toBe("2026-12-01T05:00:00.000Z")
  })

  it("is called Black Friday through Saturday and Cyber Monday from Sunday", () => {
    expect(holidaySaleName(DURING)).toBe("Black Friday")
    expect(holidaySaleName(new Date("2026-11-30T15:00:00Z"))).toBe("Cyber Monday")
  })
})

describe("sale prices", () => {
  it("halves every plan price, rounding the shown price UP so it is never below the charge", () => {
    expect(holidaySalePriceUsd(79.99)).toBe(40)
    expect(holidaySalePriceUsd(129.99)).toBe(65)
    expect(holidaySalePriceUsd(159.99)).toBe(80)
    expect(holidaySalePriceUsd(9.99)).toBe(5)
    expect(holidaySalePriceUsd(14.99)).toBe(7.5)
    expect(holidaySalePriceUsd(19.99)).toBe(10)
    for (const cents of [999, 1499, 1999, 7999, 12999, 15999]) {
      // Whichever way Stripe rounds the 50% discount, the charge is at most the shown price.
      expect(cents - Math.floor(cents / 2)).toBeLessThanOrEqual(holidaySalePriceCents(cents))
    }
  })

  it("covers the first year on both intervals: one payment yearly, twelve monthly, dead after Monday", () => {
    const sale = getHolidaySale(DURING)!
    const yearly = holidaySaleCouponSpec("year", sale)
    const monthly = holidaySaleCouponSpec("month", sale)
    expect(yearly).toMatchObject({ percent_off: 50, duration: "once" })
    expect(monthly).toMatchObject({ percent_off: 50, duration: "repeating", duration_in_months: 12 })
    expect(yearly.redeem_by).toBe(Date.parse("2026-12-01T05:00:00.000Z") / 1000)
    expect(yearly.id).not.toBe(monthly.id)
  })
})

describe("checkout during the sale", () => {
  it("puts the yearly coupon on a yearly plan and creates it once", async () => {
    const result = await buildStripeCheckoutSessionForSku({ sku: "af_pro_yearly", userId: "u1", now: DURING })
    expect(lastParams().discounts).toEqual([{ coupon: "af_bf2026_50pct_yearly" }])
    expect(lastParams().allow_promotion_codes).toBeUndefined()
    expect(lastParams().subscription_data.metadata.holidaySale).toBe("bf2026")
    expect(mocks.couponsCreate).toHaveBeenCalledWith(expect.objectContaining({ id: "af_bf2026_50pct_yearly", duration: "once" }))
    expect(result?.holidaySaleApplied).toBe(true)
  })

  it("puts the 12-month coupon on a monthly plan, reusing one that already exists", async () => {
    mocks.couponsRetrieve.mockResolvedValue({ id: "af_bf2026_50pct_monthly12" })
    await buildStripeCheckoutSessionForSku({ sku: "af_pro_monthly", userId: "u1", now: DURING })
    expect(lastParams().discounts).toEqual([{ coupon: "af_bf2026_50pct_monthly12" }])
    expect(mocks.couponsCreate).not.toHaveBeenCalled()
  })

  it("outranks founding pricing and the Partner Code discount, and keeps the commissioner's credit", async () => {
    process.env.STRIPE_FOUNDING_COUPON_ID = "coupon_founding"
    const result = await buildStripeCheckoutSessionForSku({
      sku: "af_pro_yearly",
      userId: "u1",
      foundingMember: true,
      partnerCodeId: "pc_1",
      partnerCouponId: "coupon_partner",
      now: DURING,
    })
    expect(lastParams().discounts).toEqual([{ coupon: "af_bf2026_50pct_yearly" }])
    expect(lastParams().metadata.partnerCodeId).toBe("pc_1")
    expect(lastParams().subscription_data.metadata.partnerCodeId).toBe("pc_1")
    expect(result?.foundingDiscountApplied).toBe(false)
  })

  it("gives the buyer a typed sponsor code instead when it is worth more than 50%", async () => {
    mocks.couponsRetrieve.mockResolvedValue({ id: "af_sponsor_big_60pct" })
    await buildStripeCheckoutSessionForSku({ sku: "af_pro_yearly", userId: "u1", couponCode: "BIG", couponPercentOff: 60, now: DURING })
    expect(lastParams().discounts).toEqual([{ coupon: "af_sponsor_big_60pct" }])
  })

  it("still sells at full price when Stripe will not create the coupon", async () => {
    mocks.couponsCreate.mockRejectedValue(Object.assign(new Error("forbidden"), { code: "permission_denied" }))
    const result = await buildStripeCheckoutSessionForSku({ sku: "af_pro_yearly", userId: "u1", now: DURING })
    expect(result?.url).toBeTruthy()
    expect(lastParams().discounts).toBeUndefined()
    expect(lastParams().allow_promotion_codes).toBe(true)
    expect(result?.holidaySaleApplied).toBe(false)
  })

  it("retries without the coupon when Stripe rejects the session over it", async () => {
    mocks.sessionsCreate
      .mockRejectedValueOnce(Object.assign(new Error("coupon expired"), { type: "StripeInvalidRequestError" }))
      .mockResolvedValueOnce({ id: "cs_2", url: "https://checkout.stripe.com/c/pay/cs_2" })
    const result = await buildStripeCheckoutSessionForSku({ sku: "af_pro_yearly", userId: "u1", now: DURING })
    expect(result?.sessionId).toBe("cs_2")
    expect(lastParams().discounts).toBeUndefined()
    expect(lastParams().metadata.holidaySale).toBeUndefined()
    expect(result?.holidaySaleApplied).toBe(false)
  })

  it("never touches a token pack, and is gone after Monday", async () => {
    await buildStripeCheckoutSessionForSku({ sku: "af_tokens_10", userId: "u1", now: DURING })
    expect(lastParams().discounts).toBeUndefined()
    await buildStripeCheckoutSessionForSku({ sku: "af_pro_yearly", userId: "u1", now: AFTER })
    expect(lastParams().discounts).toBeUndefined()
    expect(lastParams().allow_promotion_codes).toBe(true)
  })

  it("does nothing with the kill switch on", async () => {
    process.env.NEXT_PUBLIC_HOLIDAY_SALE_DISABLED = "1"
    await buildStripeCheckoutSessionForSku({ sku: "af_pro_yearly", userId: "u1", now: DURING })
    expect(lastParams().discounts).toBeUndefined()
  })
})
