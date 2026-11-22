import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
import { parseStripeCheckoutClientReferenceId } from "@/lib/monetization/StripeCheckoutLinkRegistry"

const getServerSessionMock = vi.hoisted(() => vi.fn())

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

// The routes now look up the user's existing Stripe customer and live plans before
// checkout; a first-time buyer has neither.
vi.mock("@/lib/monetization/stripeCustomerForUser", () => ({
  findStripeCustomerIdForUser: vi.fn().mockResolvedValue(null),
  findLiveStripePlanFamiliesForUser: vi.fn().mockResolvedValue(new Set()),
  duplicatePlanReason: vi.fn().mockReturnValue(null),
}))

/*
 * Checkout moved from Stripe Payment Links (STRIPE_CHECKOUT_LINK_*) to server-created Checkout
 * Sessions priced from the catalog (STRIPE_PRICE_*), so charged == displayed price. The suite
 * still configured payment links, so both happy paths returned 503 and sat in the baseline. The
 * Stripe client is doubled at its boundary, so the REAL session builder runs and these assert
 * what is actually sent to Stripe.
 */
const sessionCreateMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/stripe-client", () => ({
  getStripeClient: () => ({ checkout: { sessions: { create: sessionCreateMock } } }),
}))

const switchMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/monetization/supremeSwitch", () => ({ switchToSupreme: switchMock }))

// Never let a unit test reach Meta CAPI (an irreversible conversion) or the analytics table.
vi.mock("@/lib/meta-capi", () => ({
  trackMetaServerEvent: vi.fn().mockResolvedValue(null),
}))

describe("Monetization checkout routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1", email: "user@test.dev" } })
    process.env.STRIPE_PRICE_AF_PRO_MONTHLY = "price_test_pro_monthly"
    process.env.STRIPE_PRICE_AF_TOKENS_10 = "price_test_tokens_10"
    sessionCreateMock.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" })
  })

  it("resolves subscription checkout link for valid subscription sku", async () => {
    const { POST } = await import("@/app/api/monetization/checkout/subscription/route")
    const req = createMockNextRequest("http://localhost/api/monetization/checkout/subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { sku: "af_pro_monthly", returnPath: "/pricing?from=upgrade" },
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const payload = await res.json()
    expect(payload).toMatchObject({
      sku: "af_pro_monthly",
      purchaseType: "subscription",
    })
    expect(payload.url).toBe("https://checkout.stripe.com/c/pay/cs_test_1")
    expect(sessionCreateMock).toHaveBeenCalledTimes(1)
    const params = sessionCreateMock.mock.calls[0][0]
    expect(params).toMatchObject({
      mode: "subscription",
      line_items: [{ price: "price_test_pro_monthly", quantity: 1 }],
      customer_email: "user@test.dev",
      metadata: { userId: "user-1", sku: "af_pro_monthly", purchaseType: "subscription" },
    })
    expect(params.success_url).toContain("/pricing?from=upgrade&checkout=success")
    const clientReference = parseStripeCheckoutClientReferenceId(params.client_reference_id)
    expect(clientReference).toMatchObject({
      userId: "user-1",
      sku: "af_pro_monthly",
      purchaseType: "subscription",
    })
  })

  it("rejects token sku on subscription checkout route", async () => {
    const { POST } = await import("@/app/api/monetization/checkout/subscription/route")
    const req = createMockNextRequest("http://localhost/api/monetization/checkout/subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { sku: "af_tokens_10" },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid subscription sku" })
  })

  it("resolves token checkout link for valid token pack sku", async () => {
    const { POST } = await import("@/app/api/monetization/checkout/tokens/route")
    const req = createMockNextRequest("http://localhost/api/monetization/checkout/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { sku: "af_tokens_10", returnPath: "https://malicious.example.com" },
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const payload = await res.json()
    expect(payload).toMatchObject({
      sku: "af_tokens_10",
      tokenAmount: 600,
      purchaseType: "tokens",
    })
    expect(payload.url).toBe("https://checkout.stripe.com/c/pay/cs_test_1")
    const params = sessionCreateMock.mock.calls[0][0]
    expect(params).toMatchObject({
      mode: "payment",
      line_items: [{ price: "price_test_tokens_10", quantity: 1 }],
    })
    // An off-site returnPath must never become the post-checkout redirect.
    expect(params.success_url).not.toContain("malicious.example.com")
    expect(params.cancel_url).not.toContain("malicious.example.com")
    const clientReference = parseStripeCheckoutClientReferenceId(params.client_reference_id)
    expect(clientReference).toMatchObject({
      sku: "af_tokens_10",
      userId: "user-1",
      purchaseType: "tokens",
    })
  })

  it("rejects subscription sku on token checkout route", async () => {
    const { POST } = await import("@/app/api/monetization/checkout/tokens/route")
    const req = createMockNextRequest("http://localhost/api/monetization/checkout/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { sku: "af_pro_monthly" },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid token pack sku" })
  })

  it("rejects prohibited intent-like sku via compliance guardrail", async () => {
    const { POST } = await import("@/app/api/monetization/checkout/tokens/route")
    const req = createMockNextRequest("http://localhost/api/monetization/checkout/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { sku: "dues_pack" },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: "in_app_dues_not_allowed",
    })
  })

  it("rejects payout and prize_pool settlement intents", async () => {
    const { POST: postSubscription } = await import("@/app/api/monetization/checkout/subscription/route")
    const payoutReq = createMockNextRequest("http://localhost/api/monetization/checkout/subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { sku: "payout_distribution" },
    })
    const payoutRes = await postSubscription(payoutReq)
    expect(payoutRes.status).toBe(400)
    await expect(payoutRes.json()).resolves.toMatchObject({
      code: "in_app_payout_not_allowed",
    })

    const { POST: postTokens } = await import("@/app/api/monetization/checkout/tokens/route")
    const prizeReq = createMockNextRequest("http://localhost/api/monetization/checkout/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { sku: "prize_pool_setup" },
    })
    const prizeRes = await postTokens(prizeReq)
    expect(prizeRes.status).toBe(400)
    await expect(prizeRes.json()).resolves.toMatchObject({
      code: "in_app_prize_pool_not_allowed",
    })
  })

  it("fails safely when the catalog price id is missing", async () => {
    delete process.env.STRIPE_PRICE_AF_PRO_MONTHLY
    const { POST } = await import("@/app/api/monetization/checkout/subscription/route")
    const req = createMockNextRequest("http://localhost/api/monetization/checkout/subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { sku: "af_pro_monthly" },
    })
    const res = await POST(req)
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("temporarily unavailable"),
    })
    expect(sessionCreateMock).not.toHaveBeenCalled()
  })

  it("🛑 a Pro member buying Supreme is SWITCHED in place — never sent to a second Checkout", async () => {
    const { findLiveStripePlanFamiliesForUser } = await import("@/lib/monetization/stripeCustomerForUser")
    vi.mocked(findLiveStripePlanFamiliesForUser).mockResolvedValueOnce(new Set(["af_pro"]))
    switchMock.mockResolvedValueOnce({ kind: "switched", stripeSubscriptionId: "sub_pro", fromSku: "af_pro_monthly", cancelledSubscriptionIds: [] })
    const { POST } = await import("@/app/api/monetization/checkout/subscription/route")
    const res = await POST(createMockNextRequest("http://localhost/api/monetization/checkout/subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { sku: "af_supreme_monthly", returnPath: "/upgrade?plan=supreme&from=pro", entrySource: "supreme_spotlight", confirmSwitch: true },
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: "/upgrade?plan=supreme&from=pro&checkout=success&switched=1", sku: "af_supreme_monthly", purchaseType: "subscription", switched: true })
    expect(switchMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", supremeSku: "af_supreme_monthly" }))
    expect(sessionCreateMock).not.toHaveBeenCalled()
  })

  it("🛑 the switch charges the card on file, so it is never done unconfirmed: the first request only asks", async () => {
    const { findLiveStripePlanFamiliesForUser } = await import("@/lib/monetization/stripeCustomerForUser")
    vi.mocked(findLiveStripePlanFamiliesForUser).mockResolvedValueOnce(new Set(["af_pro"]))
    const { POST } = await import("@/app/api/monetization/checkout/subscription/route")
    const res = await POST(createMockNextRequest("http://localhost/api/monetization/checkout/subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { sku: "af_supreme_monthly", returnPath: "/upgrade" },
    }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      code: "confirm_switch",
      message: "Switch your AF Pro plan to AF Supreme? Your card on file is charged the difference for the rest of this billing period today, then $19.99/month. You won't be billed for both.",
    })
    expect(switchMock).not.toHaveBeenCalled()
    expect(sessionCreateMock).not.toHaveBeenCalled()
  })

  it("a declined switch is reported, and nothing else is tried", async () => {
    const { findLiveStripePlanFamiliesForUser } = await import("@/lib/monetization/stripeCustomerForUser")
    vi.mocked(findLiveStripePlanFamiliesForUser).mockResolvedValueOnce(new Set(["af_commissioner"]))
    switchMock.mockResolvedValueOnce({ kind: "failed", status: 402, code: "payment_failed", error: "Your card was declined, so the switch to AF Supreme did not go through. Nothing changed." })
    const { POST } = await import("@/app/api/monetization/checkout/subscription/route")
    const res = await POST(createMockNextRequest("http://localhost/api/monetization/checkout/subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { sku: "af_supreme_monthly", returnPath: "/upgrade", confirmSwitch: true },
    }))
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ code: "payment_failed" })
    expect(sessionCreateMock).not.toHaveBeenCalled()
  })

  it("Supreme with no Pro or Commissioner is an ordinary checkout", async () => {
    process.env.STRIPE_PRICE_AF_SUPREME_MONTHLY = "price_test_supreme_monthly"
    const { POST } = await import("@/app/api/monetization/checkout/subscription/route")
    const res = await POST(createMockNextRequest("http://localhost/api/monetization/checkout/subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { sku: "af_supreme_monthly", returnPath: "/upgrade" },
    }))
    expect(res.status).toBe(200)
    expect(switchMock).not.toHaveBeenCalled()
    expect(sessionCreateMock).toHaveBeenCalledTimes(1)
  })
})

