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

// e026876bf (pricing overhaul) took tokens OFF subscriptions: every plan's included credits are
// 0, and grantMonthlyCreditsFromInvoice bails on <= 0. This suite still asserted the old
// 100/250/300/3500/15000 grants and sat in the baseline. The real policy runs by default (so
// "subscriptions grant nothing" is asserted against the shipped numbers); the call-contract tests
// below override it with a positive allowance so the grant path stays covered if one returns.
const policyMock = vi.hoisted(() => ({ override: null as null | ((i: { planId: string; interval: string }) => number) }))
vi.mock("@/lib/tokens/subscription-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tokens/subscription-policy")>()
  return {
    ...actual,
    getIncludedPremiumCreditsForSubscription: (input: Parameters<typeof actual.getIncludedPremiumCreditsForSubscription>[0]) =>
      policyMock.override ? policyMock.override(input) : actual.getIncludedPremiumCreditsForSubscription(input),
  }
})

// File-level so an override can never leak into the next describe block.
beforeEach(() => {
  policyMock.override = null
  grantMonthlySubscriptionCreditsMock.mockClear()
})

// ---------------------------------------------------------------------------
// grantMonthlyCreditsFromInvoice
// Tests verify: plan lookup → token amount → call contract
// The webhookHandlers module is NOT wrapped — we import it directly so that
// its TokenSpendService import picks up the mock above.
// ---------------------------------------------------------------------------
describe("grantMonthlyCreditsFromInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    policyMock.override = null
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

  it("grants no tokens for af_pro_monthly (tokens are off subscriptions)", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "af_pro_monthly" })

    const invoice = {
      id: "in_pro_cycle",
      billing_reason: "subscription_cycle",
      subscription: "sub_user_pro",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_pro")

    expect(prismaMock.userSubscription.findFirst).toHaveBeenCalled()
    expect(grantMonthlySubscriptionCreditsMock).not.toHaveBeenCalled()
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

  it("grants no tokens for af_war_room_monthly", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "af_war_room_monthly" })

    const invoice = {
      id: "in_wr_cycle",
      billing_reason: "subscription_cycle",
      subscription: "sub_user_wr",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_wr")

    expect(prismaMock.userSubscription.findFirst).toHaveBeenCalled()
    expect(grantMonthlySubscriptionCreditsMock).not.toHaveBeenCalled()
  })

  it("grants no tokens for af_commissioner_monthly", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "af_commissioner_monthly" })

    const invoice = {
      id: "in_comm_cycle",
      billing_reason: "subscription_cycle",
      subscription: "sub_user_comm",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_comm")

    expect(prismaMock.userSubscription.findFirst).toHaveBeenCalled()
    expect(grantMonthlySubscriptionCreditsMock).not.toHaveBeenCalled()
  })

  it("passes the exact grant contract, invoiceId included for idempotency, when a plan has an allowance", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    policyMock.override = ({ interval }) => (interval === "year" ? 1200 : 100)
    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "af_pro_monthly" })

    const invoice = {
      id: "in_unique_abc123",
      billing_reason: "subscription_cycle",
      subscription: "sub_abc",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_idem")

    expect(grantMonthlySubscriptionCreditsMock).toHaveBeenCalledOnce()
    expect(grantMonthlySubscriptionCreditsMock).toHaveBeenCalledWith({
      userId: "user_idem",
      tokenAmount: 100,
      planFamily: "af_pro",
      invoiceId: "in_unique_abc123",
      billingReason: "subscription_cycle",
    })
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

  it("yearly SKU also resolves correct plan family and the yearly allowance", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    policyMock.override = ({ planId, interval }) => (planId === "pro" && interval === "year" ? 1200 : 0)
    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "af_pro_yearly" })

    const invoice = {
      id: "in_pro_yearly",
      billing_reason: "subscription_cycle",
      subscription: "sub_pro_yearly",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_pro_y")

    expect(grantMonthlySubscriptionCreditsMock).toHaveBeenCalledWith(
      expect.objectContaining({ tokenAmount: 1200, planFamily: "af_pro" })
    )
  })

  it("grants no tokens for af_supreme_yearly", async () => {
    const { grantMonthlyCreditsFromInvoice } = await import(
      "@/lib/subscription/webhookHandlers"
    )

    prismaMock.userSubscription.findFirst.mockResolvedValue({ sku: "af_supreme_yearly" })

    const invoice = {
      id: "in_supreme_yearly",
      billing_reason: "subscription_create",
      subscription: "sub_user_supreme_y",
    }
    await grantMonthlyCreditsFromInvoice(invoice as any, "user_supreme_y")

    expect(prismaMock.userSubscription.findFirst).toHaveBeenCalled()
    expect(grantMonthlySubscriptionCreditsMock).not.toHaveBeenCalled()
  })
})
