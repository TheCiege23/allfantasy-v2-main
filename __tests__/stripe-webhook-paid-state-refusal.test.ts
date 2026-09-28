/**
 * The Stripe webhook refuses a purchase whose card billing address is in a
 * restricted state — BEFORE anything is granted — and still grants every other
 * purchase exactly as before. The refusal steps themselves are unit-tested in
 * paid-state-card-check.test.ts; this pins where the route calls them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"

const constructEventMock = vi.hoisted(() => vi.fn())
const stripe = vi.hoisted(() => ({
  webhooks: { constructEvent: constructEventMock },
  subscriptions: {
    retrieve: vi.fn(),
    cancel: vi.fn(),
  },
  invoicePayments: { list: vi.fn() },
  refunds: { create: vi.fn() },
}))

vi.mock("@/lib/stripe-client", () => ({
  getStripeClient: () => stripe,
  getStripeWebhookSecret: () => "whsec_test",
}))

const db = vi.hoisted(() => ({
  eventFindUnique: vi.fn(),
  eventCreate: vi.fn(),
  eventUpdate: vi.fn(),
  planUpsert: vi.fn(),
  subUpsert: vi.fn(),
  subFindMany: vi.fn(),
  subFindFirst: vi.fn(),
  profileUpsert: vi.fn(),
  grantFindMany: vi.fn(),
  appUserUpdateMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stripeWebhookEvent: { findUnique: db.eventFindUnique, create: db.eventCreate, update: db.eventUpdate },
    subscriptionPlan: { upsert: db.planUpsert },
    userSubscription: {
      upsert: db.subUpsert,
      findMany: db.subFindMany,
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: db.subFindFirst,
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    userProfile: { upsert: db.profileUpsert },
    adminSubscriptionGrant: { findMany: db.grantFindMany },
    appUser: { updateMany: db.appUserUpdateMany },
  },
}))

const grantTokensMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/tokens/TokenSpendService", () => ({
  TokenSpendService: vi.fn().mockImplementation(function (this: { grantTokensFromPackagePurchase: unknown }) {
    this.grantTokensFromPackagePurchase = grantTokensMock
  }),
}))

const trackMetaMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/meta-capi", () => ({ trackMetaServerEvent: trackMetaMock }))

const NV = { country: "US", postal_code: "89501", state: "NV", line1: "1 Main St", line2: null, city: "Reno" }
const CA = { ...NV, postal_code: "94107", state: "CA", city: "San Francisco" }

function subscriptionCheckout(address: object) {
  return {
    id: "evt_sub",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_sub",
        mode: "subscription",
        payment_status: "paid",
        subscription: "sub_1",
        invoice: "in_1",
        customer: "cus_1",
        amount_total: 999,
        customer_details: { email: "buyer@example.com", address },
        metadata: { purchaseType: "subscription", userId: "u1", sku: "af_pro_monthly" },
      },
    },
  }
}

function tokenCheckout(address: object) {
  return {
    id: "evt_tok",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_tok",
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi_tokens",
        customer: "cus_1",
        amount_total: 499,
        customer_details: { email: "buyer@example.com", address },
        metadata: { purchaseType: "tokens", userId: "u1", sku: "af_tokens_5" },
      },
    },
  }
}

async function post() {
  const { POST } = await import("@/app/api/stripe/webhook/route")
  const req = createMockNextRequest("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "sig_test" },
    body: "{}",
  })
  const res = await POST(req as never)
  return { status: res.status, body: await res.json() }
}

describe("Stripe webhook: the paid-state card check", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    db.eventFindUnique.mockResolvedValue(null)
    db.eventCreate.mockResolvedValue({ id: "row" })
    db.eventUpdate.mockResolvedValue({ id: "row" })
    db.planUpsert.mockResolvedValue({ id: "plan-1" })
    db.subUpsert.mockResolvedValue({ id: "usub-1" })
    db.subFindMany.mockResolvedValue([])
    db.subFindFirst.mockResolvedValue(null)
    db.profileUpsert.mockResolvedValue({})
    db.grantFindMany.mockResolvedValue([])
    db.appUserUpdateMany.mockResolvedValue({ count: 1 })
    grantTokensMock.mockResolvedValue({ id: "led-1" })
    trackMetaMock.mockResolvedValue(undefined)
    stripe.subscriptions.retrieve.mockResolvedValue({ id: "sub_1", status: "active" })
    stripe.subscriptions.cancel.mockResolvedValue({ id: "sub_1", status: "canceled" })
    stripe.invoicePayments.list.mockResolvedValue({
      data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_invoice" } }],
    })
    stripe.refunds.create.mockResolvedValue({ id: "re_1" })
  })

  it("refuses a Nevada card's subscription: no plan, no Purchase event, refunded, cancelled, locked", async () => {
    constructEventMock.mockReturnValue(subscriptionCheckout(NV))
    const { status, body } = await post()

    expect(status).toBe(200)
    expect(body).toMatchObject({ received: true, purchaseType: "refused_paid_state:NV" })
    expect(db.subUpsert).not.toHaveBeenCalled()
    expect(db.planUpsert).not.toHaveBeenCalled()
    expect(trackMetaMock).not.toHaveBeenCalled()
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_1", { invoice_now: false, prorate: false })
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_invoice" }),
      { idempotencyKey: "af-paid-state-refund-cs_sub" },
    )
    expect(db.appUserUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "u1" }),
        data: { stateRestrictionLevel: "card_paid_block", isStateRestricted: true },
      }),
    )
    // Recorded as processed with the outcome, for the admin view.
    expect(db.eventUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "processed", purchaseType: "refused_paid_state:NV" }),
      }),
    )
  })

  it("locks the WHOLE account for a Washington card — owner's decision, 2026-09-25", async () => {
    constructEventMock.mockReturnValue(subscriptionCheckout({ ...NV, postal_code: "98101", state: "WA", city: "Seattle" }))
    const { body } = await post()

    expect(body).toMatchObject({ purchaseType: "refused_paid_state:WA" })
    expect(db.subUpsert).not.toHaveBeenCalled()
    expect(stripe.refunds.create).toHaveBeenCalled()
    expect(db.appUserUpdateMany).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { stateRestrictionLevel: "full_block", isStateRestricted: true },
    })
  })

  it("never downgrades a Washington lock to the card lock", async () => {
    constructEventMock.mockReturnValue(subscriptionCheckout(NV))
    await post()
    const where = db.appUserUpdateMany.mock.calls[0][0].where
    expect(where.OR).toEqual([{ stateRestrictionLevel: null }, { stateRestrictionLevel: { not: "full_block" } }])
  })

  it("refuses a Nevada card's token pack: no tokens, refunded by its own payment intent", async () => {
    constructEventMock.mockReturnValue(tokenCheckout(NV))
    const { body } = await post()

    expect(body).toMatchObject({ purchaseType: "refused_paid_state:NV" })
    expect(grantTokensMock).not.toHaveBeenCalled()
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled()
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_tokens" }),
      { idempotencyKey: "af-paid-state-refund-cs_tok" },
    )
  })

  it("grants a California card's subscription exactly as before", async () => {
    constructEventMock.mockReturnValue(subscriptionCheckout(CA))
    const { body } = await post()

    expect(body).toMatchObject({ purchaseType: "subscription" })
    expect(db.subUpsert).toHaveBeenCalledTimes(1)
    expect(stripe.refunds.create).not.toHaveBeenCalled()
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled()
    expect(db.appUserUpdateMany).not.toHaveBeenCalled()
  })

  it("grants a California card's token pack exactly as before", async () => {
    constructEventMock.mockReturnValue(tokenCheckout(CA))
    const { body } = await post()

    expect(body).toMatchObject({ purchaseType: "tokens" })
    expect(grantTokensMock).toHaveBeenCalledTimes(1)
    expect(stripe.refunds.create).not.toHaveBeenCalled()
  })

  it("does not act on a delayed payment until it settles", async () => {
    const event = subscriptionCheckout(NV)
    ;(event.data.object as { payment_status: string }).payment_status = "unpaid"
    constructEventMock.mockReturnValue(event)
    const { body } = await post()

    expect(body).toMatchObject({ purchaseType: "subscription" })
    expect(stripe.refunds.create).not.toHaveBeenCalled()
    expect(db.subUpsert).not.toHaveBeenCalled()
  })

  it("checks the delayed payment when it does settle", async () => {
    const event = subscriptionCheckout(NV)
    event.type = "checkout.session.async_payment_succeeded"
    constructEventMock.mockReturnValue(event)
    const { body } = await post()

    expect(body).toMatchObject({ purchaseType: "refused_paid_state:NV" })
    expect(db.subUpsert).not.toHaveBeenCalled()
  })

  it("marks the event errored and asks Stripe to retry when the refund fails", async () => {
    constructEventMock.mockReturnValue(subscriptionCheckout(NV))
    stripe.refunds.create.mockRejectedValueOnce(Object.assign(new Error("api down"), { code: "api_error" }))
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { status } = await post()

    expect(status).toBe(500)
    expect(db.subUpsert).not.toHaveBeenCalled()
    expect(db.eventUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "error" }) }),
    )
  })
})
