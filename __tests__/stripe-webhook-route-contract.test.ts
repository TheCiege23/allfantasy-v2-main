import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
import { buildStripeCheckoutClientReferenceId } from "@/lib/monetization/StripeCheckoutLinkRegistry"

const constructEventMock = vi.hoisted(() => vi.fn())
const getStripeClientMock = vi.hoisted(() =>
  vi.fn(() => ({
    webhooks: {
      constructEvent: constructEventMock,
    },
  }))
)
const getStripeWebhookSecretMock = vi.hoisted(() => vi.fn(() => "whsec_test"))

const findUniqueMock = vi.hoisted(() => vi.fn())
const createMock = vi.hoisted(() => vi.fn())
const updateMock = vi.hoisted(() => vi.fn())
const subscriptionPlanUpsertMock = vi.hoisted(() => vi.fn())
const userSubscriptionUpsertMock = vi.hoisted(() => vi.fn())
const userSubscriptionFindManyMock = vi.hoisted(() => vi.fn())
const userSubscriptionFindFirstMock = vi.hoisted(() => vi.fn())
const userSubscriptionUpdateMock = vi.hoisted(() => vi.fn())
const userSubscriptionCreateMock = vi.hoisted(() => vi.fn())
const userProfileUpsertMock = vi.hoisted(() => vi.fn())
const adminSubscriptionGrantFindManyMock = vi.hoisted(() => vi.fn())

// Token purchase mocks — used by persistTokenPurchaseFromCheckout path
const grantTokensFromPackagePurchaseMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/stripe-client", () => ({
  getStripeClient: getStripeClientMock,
  getStripeWebhookSecret: getStripeWebhookSecretMock,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stripeWebhookEvent: {
      findUnique: findUniqueMock,
      create: createMock,
      update: updateMock,
    },
    subscriptionPlan: {
      upsert: subscriptionPlanUpsertMock,
    },
    userSubscription: {
      upsert: userSubscriptionUpsertMock,
      findMany: userSubscriptionFindManyMock,
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: userSubscriptionFindFirstMock,
      update: userSubscriptionUpdateMock,
      create: userSubscriptionCreateMock,
      delete: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    userProfile: {
      upsert: userProfileUpsertMock,
    },
    adminSubscriptionGrant: {
      findMany: adminSubscriptionGrantFindManyMock,
    },
  },
}))

// Mock the full TokenSpendService so token tests don't need prisma.$transaction.
// Must use a regular function (not arrow) so `new TokenSpendService()` works as a constructor.
vi.mock("@/lib/tokens/TokenSpendService", () => ({
  TokenSpendService: vi.fn().mockImplementation(function (this: any) {
    this.grantTokensFromPackagePurchase = grantTokensFromPackagePurchaseMock
  }),
}))

describe("Stripe webhook route contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findUniqueMock.mockResolvedValue(null)
    createMock.mockResolvedValue({ id: "row-1" })
    updateMock.mockResolvedValue({ id: "row-1" })
    subscriptionPlanUpsertMock.mockResolvedValue({ id: "plan-1" })
    userSubscriptionUpsertMock.mockResolvedValue({ id: "sub-1" })
    userSubscriptionFindManyMock.mockResolvedValue([])
    userSubscriptionFindFirstMock.mockResolvedValue(null)
    userSubscriptionUpdateMock.mockResolvedValue({ id: "sub-1" })
    userSubscriptionCreateMock.mockResolvedValue({ id: "sub-1" })
    userProfileUpsertMock.mockResolvedValue({ userId: "u1" })
    adminSubscriptionGrantFindManyMock.mockResolvedValue([])
    // Token grant mock — succeeds by default
    grantTokensFromPackagePurchaseMock.mockResolvedValue({
      id: "led-1",
      entryType: "purchase",
      tokenDelta: 250,
      balanceBefore: 0,
      balanceAfter: 250,
      tokenPackageSku: "af_tokens_5",
      spendRuleCode: null,
      spendFeatureLabel: null,
      refundRuleCode: null,
      sourceType: "stripe_checkout",
      sourceId: "cs_test_tokens",
      description: "Stripe purchase: AllFantasy AI Tokens (250)",
      metadata: null,
      createdAt: new Date().toISOString(),
    })
    constructEventMock.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_1",
          mode: "subscription",
          subscription: "sub_test_1",
          customer: "cus_test_1",
          metadata: {
            purchaseType: "subscription",
            userId: "u1",
            sku: "af_pro_monthly",
          },
        },
      },
    })
  })

  it("returns 400 when stripe-signature header is missing", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const req = createMockNextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      body: "{}",
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: "Missing stripe-signature header",
    })
  }, 60000)

  it("routes known purchaseType and marks webhook event processed", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const req = createMockNextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    })
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      received: true,
      eventType: "checkout.session.completed",
      purchaseType: "subscription",
    })

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(createMock.mock.calls[0][0]).toMatchObject({
      data: { eventId: "evt_1", type: "checkout.session.completed", status: "processing" },
    })
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      where: { eventId: "evt_1" },
      data: expect.objectContaining({
        status: "processed",
        purchaseType: "subscription",
      }),
    })
    expect(subscriptionPlanUpsertMock).toHaveBeenCalledTimes(1)
    expect(userSubscriptionUpsertMock).toHaveBeenCalledTimes(1)
  })

  it("treats already processed event as idempotent duplicate", async () => {
    findUniqueMock.mockResolvedValueOnce({ status: "processed" })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const req = createMockNextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ received: true, duplicate: true })
    expect(createMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("returns a retryable response while a webhook event is still processing", async () => {
    findUniqueMock.mockResolvedValueOnce({
      status: "processing",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const req = createMockNextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    })
    const res = await POST(req as any)
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ received: false, retry: true })
    expect(createMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("retries stale processing webhook events instead of dropping fulfillment", async () => {
    findUniqueMock.mockResolvedValueOnce({
      status: "processing",
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
    })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const req = createMockNextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      where: { eventId: "evt_1" },
      data: expect.objectContaining({ status: "processing", error: null }),
    })
    expect(updateMock.mock.calls.at(-1)?.[0]).toMatchObject({
      where: { eventId: "evt_1" },
      data: expect.objectContaining({ status: "processed" }),
    })
  })

  it("safely accepts unknown purchaseType and still marks processed", async () => {
    constructEventMock.mockReturnValueOnce({
      id: "evt_unknown",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_unknown",
          metadata: { purchaseType: "mystery_value" },
        },
      },
    })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const req = createMockNextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    })
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      received: true,
      purchaseType: "mystery_value",
    })
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "evt_unknown" },
        data: expect.objectContaining({ status: "processed", purchaseType: "mystery_value" }),
      })
    )
    expect(subscriptionPlanUpsertMock).not.toHaveBeenCalled()
    expect(userSubscriptionUpsertMock).not.toHaveBeenCalled()
  })

  it("resolves purchase context from client_reference_id when metadata is missing", async () => {
    constructEventMock.mockReturnValueOnce({
      id: "evt_client_ref_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_client_ref_1",
          mode: "subscription",
          subscription: "sub_client_ref_1",
          customer: "cus_client_ref_1",
          metadata: {},
          client_reference_id: buildStripeCheckoutClientReferenceId({
            userId: "user-ref-1",
            sku: "af_pro_monthly",
            purchaseType: "subscription",
          }),
        },
      },
    })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const req = createMockNextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    })
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      received: true,
      purchaseType: "subscription",
    })
    expect(userSubscriptionUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: "user-ref-1",
          sku: "af_pro_monthly",
        }),
      })
    )
  })

  it("persists error status when processing fails", async () => {
    updateMock
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce({ id: "row-err" })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const req = createMockNextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    })
    const res = await POST(req as any)

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({
      error: "write failed",
    })
    expect(updateMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { eventId: "evt_1" },
        data: expect.objectContaining({ status: "error", purchaseType: "subscription" }),
      })
    )
  })

  // -------------------------------------------------------------------------
  // Delayed payment methods: completed ≠ paid
  // -------------------------------------------------------------------------

  it("does NOT grant the plan while a completed session is still unpaid", async () => {
    constructEventMock.mockReturnValueOnce({
      id: "evt_unpaid",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_unpaid",
          mode: "subscription",
          payment_status: "unpaid",
          subscription: "sub_unpaid",
          customer: "cus_unpaid",
          metadata: { purchaseType: "subscription", userId: "u1", sku: "af_pro_monthly" },
        },
      },
    })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const req = createMockNextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(userSubscriptionUpsertMock).not.toHaveBeenCalled()
    expect(grantTokensFromPackagePurchaseMock).not.toHaveBeenCalled()
  })

  it("grants the plan when the delayed payment succeeds (async_payment_succeeded)", async () => {
    constructEventMock.mockReturnValueOnce({
      id: "evt_async_paid",
      type: "checkout.session.async_payment_succeeded",
      data: {
        object: {
          id: "cs_unpaid",
          mode: "subscription",
          payment_status: "paid",
          subscription: "sub_unpaid",
          customer: "cus_unpaid",
          metadata: { purchaseType: "subscription", userId: "u1", sku: "af_pro_monthly" },
        },
      },
    })
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const req = createMockNextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ purchaseType: "subscription" })
    expect(userSubscriptionUpsertMock).toHaveBeenCalledTimes(1)
  })

  // -------------------------------------------------------------------------
  // Token purchase path
  // -------------------------------------------------------------------------

  it("token purchase: grants tokens and marks event processed", async () => {
    constructEventMock.mockReturnValueOnce({
      id: "evt_tokens_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_tokens_1",
          mode: "payment",
          subscription: null,
          customer: "cus_tokens_1",
          metadata: {},
          client_reference_id: buildStripeCheckoutClientReferenceId({
            userId: "user-tokens-1",
            sku: "af_tokens_5",
            purchaseType: "tokens",
          }),
        },
      },
    })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const req = createMockNextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    })
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ received: true, eventType: "checkout.session.completed", purchaseType: "tokens" })
    // fulfillmentError must be absent — this was a successful grant
    expect(body.fulfillmentError).toBeUndefined()

    // grantTokensFromPackagePurchase was called with correct args
    expect(grantTokensFromPackagePurchaseMock).toHaveBeenCalledTimes(1)
    expect(grantTokensFromPackagePurchaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-tokens-1",
        packageSku: "af_tokens_5",
        sourceType: "stripe_checkout",
        sourceId: "cs_tokens_1",
        idempotencyKey: "stripe_checkout:cs_tokens_1:af_tokens_5",
      })
    )

    // Event must be marked "processed"
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "evt_tokens_1" },
        data: expect.objectContaining({ status: "processed", purchaseType: "tokens" }),
      })
    )
  }, 60000)

  it("token purchase: missing context returns HTTP 200 (non-retryable) and marks event error in DB", async () => {
    // purchaseType resolves to "tokens" from metadata but no userId/sku and
    // no valid client_reference_id — permanent fulfillment failure.
    constructEventMock.mockReturnValueOnce({
      id: "evt_tokens_nocontext",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_tokens_nocontext",
          mode: "payment",
          customer: "cus_tokens_1",
          // purchaseType in metadata so resolveCheckoutPurchaseType returns "tokens"
          // but no userId/sku and no client_reference_id — context will be null
          metadata: { purchaseType: "tokens" },
          client_reference_id: null,
        },
      },
    })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const req = createMockNextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    })
    const res = await POST(req as any)

    // Non-retryable: must be HTTP 200, not 500
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
    expect(body.fulfillmentError).toMatch(/token_grant_skipped:missing_context/)

    // grantTokens must NOT have been called
    expect(grantTokensFromPackagePurchaseMock).not.toHaveBeenCalled()

    // Event must be marked "error" in DB (admin-visible) — NOT "processed"
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "evt_tokens_nocontext" },
        data: expect.objectContaining({
          status: "error",
          error: expect.stringContaining("token_grant_skipped:missing_context"),
        }),
      })
    )
  }, 60000)

  it("token purchase: invalid SKU returns HTTP 200 (non-retryable) and marks event error in DB", async () => {
    // client_reference_id has a SKU that is not a token_pack in the catalog
    constructEventMock.mockReturnValueOnce({
      id: "evt_tokens_badsku",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_tokens_badsku",
          mode: "payment",
          customer: "cus_tokens_1",
          metadata: {},
          client_reference_id: buildStripeCheckoutClientReferenceId({
            userId: "user-tokens-2",
            sku: "af_pro_monthly",   // subscription SKU, not a token_pack
            purchaseType: "tokens",
          }),
        },
      },
    })

    const { POST } = await import("@/app/api/stripe/webhook/route")
    const req = createMockNextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    })
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fulfillmentError).toMatch(/token_grant_skipped:invalid_sku/)
    expect(grantTokensFromPackagePurchaseMock).not.toHaveBeenCalled()
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "error",
          error: expect.stringContaining("token_grant_skipped:invalid_sku"),
        }),
      })
    )
  }, 60000)
})
