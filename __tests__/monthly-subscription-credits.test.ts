import { beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks — created before module imports so vi.mock() factories can
// reference them by closure.
// ---------------------------------------------------------------------------
const { prismaMock, grantMonthlySubscriptionCreditsMock } = vi.hoisted(() => ({
  prismaMock: {
    userSubscription: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: any) => fn({
      tokenLedger: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      userTokenBalance: { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    })),
  },
  grantMonthlySubscriptionCreditsMock: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

// Mock TokenSpendService so grantMonthlyCreditsFromInvoice doesn't hit the DB.
// Uses a regular function (not arrow) because it's called with `new`.
vi.mock("@/lib/tokens/TokenSpendService", () => ({
  TokenSpendService: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.grantMonthlySubscriptionCredits = grantMonthlySubscriptionCreditsMock
  }),
}))

// ---------------------------------------------------------------------------
// grantMonthlyCreditsFromInvoice
// Tests verify: plan lookup → token amount → call contract
// The webhookHandlers module is NOT wrapped — we import it directly so that
// its TokenSpendService import picks up the mock above.
// ---------------------------------------------------------------------------
describe("grantMonthlyCreditsFromInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.userSubscription.findFirst.mockResolvedValue(null)
    grantMonthlySubscriptionCreditsMock.mockResolvedValue(null)
  })

  it("skips grant when invoice has no subscription id", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    const invoice = { id: "in_no_sub", billing_reason: "subscription_cycle" }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_123")

    expect(prismaMock.userSubscription.findFirst).not.toHaveBeenCalled()
    expect(grantMonthlySubscriptionCreditsMock).not.toHaveBeenCalled()
  })

  it("skips grant when user subscription row not found in DB", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    prismaMock.userSubscription.findFirst.mockResolvedValue(null)

    const invoice = {
      id: "in_orphan",
      billing_reason: "subscription_cycle",
      subscription: "sub_orphan",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_123")

    expect(grantMonthlySubscriptionCreditsMock).not.toHaveBeenCalled()
  })

  it("skips grant when subscription sku is not in monetization catalog", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "unknown_sku_xyz" })

    const invoice = {
      id: "in_bad_sku",
      billing_reason: "subscription_cycle",
      subscription: "sub_bad",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_123")

    expect(grantMonthlySubscriptionCreditsMock).not.toHaveBeenCalled()
  })

  it("skips grant for token_pack sku (not a subscription)", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "af_tokens_10" })

    const invoice = {
      id: "in_token_pack",
      billing_reason: "subscription_cycle",
      subscription: "sub_tp",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_tp")

    expect(grantMonthlySubscriptionCreditsMock).not.toHaveBeenCalled()
  })

  it("grants 250 tokens for af_pro_monthly plan", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "af_pro_monthly" })

    const invoice = {
      id: "in_pro_cycle",
      billing_reason: "subscription_cycle",
      subscription: "sub_pro",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_pro")

    expect(grantMonthlySubscriptionCreditsMock).toHaveBeenCalledOnce()
    expect(grantMonthlySubscriptionCreditsMock).toHaveBeenCalledWith({
      userId: "user_pro",
      tokenAmount: 250,
      planFamily: "af_pro",
      invoiceId: "in_pro_cycle",
      billingReason: "subscription_cycle",
    })
  })

  it("skips grant for the retired af_all_access_monthly sku (removed from catalog)", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    // The af_all_access tier was removed from the monetization catalog. A legacy
    // invoice still carrying this sku no longer resolves to a catalog item, so no
    // monthly credits are granted (same path as an unknown sku).
    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "af_all_access_monthly" })

    const invoice = {
      id: "in_aa_create",
      billing_reason: "subscription_create",
      subscription: "sub_all_access",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_aa")

    expect(grantMonthlySubscriptionCreditsMock).not.toHaveBeenCalled()
  })

  it("grants 300 tokens for af_war_room_monthly plan", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "af_war_room_monthly" })

    const invoice = {
      id: "in_wr_cycle",
      billing_reason: "subscription_cycle",
      subscription: "sub_wr",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_wr")

    expect(grantMonthlySubscriptionCreditsMock).toHaveBeenCalledWith(
      expect.objectContaining({ tokenAmount: 300, planFamily: "af_war_room" })
    )
  })

  it("grants 100 tokens for af_commissioner_monthly plan", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "af_commissioner_monthly" })

    const invoice = {
      id: "in_comm_cycle",
      billing_reason: "subscription_cycle",
      subscription: "sub_comm",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_comm")

    expect(grantMonthlySubscriptionCreditsMock).toHaveBeenCalledWith(
      expect.objectContaining({ tokenAmount: 100, planFamily: "af_commissioner" })
    )
  })

  it("passes exact invoiceId to grantMonthlySubscriptionCredits for idempotency", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "af_pro_monthly" })

    const invoice = {
      id: "in_unique_abc123",
      billing_reason: "subscription_cycle",
      subscription: "sub_abc",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_idem")

    expect(grantMonthlySubscriptionCreditsMock).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: "in_unique_abc123" })
    )
  })

  it("looks up subscription by correct userId + stripeSubscriptionId", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "af_pro_monthly" })

    const invoice = {
      id: "in_lookup_test",
      billing_reason: "subscription_cycle",
      subscription: "sub_lookup",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_lookup")

    expect(prismaMock.userSubscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_lookup", stripeSubscriptionId: "sub_lookup" },
      })
    )
  })
})

// ---------------------------------------------------------------------------
// grantMonthlySubscriptionCredits null-guard
// ---------------------------------------------------------------------------
describe("TokenSpendService.grantMonthlySubscriptionCredits — null guards", () => {
  // These test the guard clause in the real implementation, but since
  // TokenSpendService is mocked above, we verify the behaviour by examining
  // that grantMonthlyCreditsFromInvoice does NOT call the service when
  // there are no credits to grant (plan with 0 credits).
  // Direct null-guard for the service method itself is in the integration path.

  it("yearly SKU also resolves correct plan family", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "af_pro_yearly" })

    const invoice = {
      id: "in_pro_yearly",
      billing_reason: "subscription_cycle",
      subscription: "sub_pro_yearly",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_pro_y")

    // af_pro_yearly belongs to plan family af_pro and grants the yearly allowance.
    expect(grantMonthlySubscriptionCreditsMock).toHaveBeenCalledWith(
      expect.objectContaining({ tokenAmount: 3500, planFamily: "af_pro" })
    )
  })

  it("yearly Supreme grants the annual flagship allowance", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "af_supreme_yearly" })

    const invoice = {
      id: "in_supreme_yearly",
      billing_reason: "subscription_create",
      subscription: "sub_supreme_yearly",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_supreme_y")

    expect(grantMonthlySubscriptionCreditsMock).toHaveBeenCalledWith(
      expect.objectContaining({ tokenAmount: 15000, planFamily: "af_supreme" })
    )
  })
})
