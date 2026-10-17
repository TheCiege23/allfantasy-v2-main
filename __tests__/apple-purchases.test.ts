import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JWSTransactionDecodedPayload } from "@apple/app-store-server-library"

const findSubscription = vi.fn()
const upsertSubscription = vi.fn()
const updateSubscription = vi.fn()
const grantTokens = vi.fn()
const syncProfile = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: { userSubscription: { findUnique: findSubscription, upsert: upsertSubscription, update: updateSubscription } },
}))
vi.mock("@/lib/monetization/catalog", () => ({
  getMonetizationCatalogItemBySku: (sku: string) => {
    if (sku === "af_tokens_5") return {
      sku, type: "token_pack", tokenAmount: 250, title: "Starter Tokens",
    }
    if (sku === "af_pro_monthly") return {
      sku, type: "subscription", planFamily: "af_pro", title: "AF Pro Monthly",
    }
    return null
  },
}))
vi.mock("@/lib/subscription/webhookHandlers", () => ({
  upsertSubscriptionPlanForCatalogItem: vi.fn(async () => ({ id: "plan-1" })),
}))
vi.mock("@/lib/subscription/syncBridge", () => ({
  syncUserProfileFromSubscriptions: syncProfile,
}))
vi.mock("@/lib/tokens/TokenSpendService", () => ({
  TokenSpendService: class { grantTokensFromPackagePurchase = grantTokens },
}))

const userId = "11111111-1111-4111-8111-111111111111"
const base: JWSTransactionDecodedPayload = {
  transactionId: "apple-tx-1",
  originalTransactionId: "apple-original-1",
  productId: "af_tokens_5",
  appAccountToken: userId,
  type: "Consumable",
  environment: "Sandbox",
}

describe("Apple purchase grants", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findSubscription.mockResolvedValue(null)
  })

  it("rejects a valid transaction attached to a different account", async () => {
    const { applyApplePurchase } = await import("@/lib/monetization/applePurchases")
    await expect(applyApplePurchase(base, "22222222-2222-4222-8222-222222222222"))
      .rejects.toThrow("different AllFantasy account")
    expect(grantTokens).not.toHaveBeenCalled()
  })

  it("uses the Apple transaction ID as a global token grant idempotency key", async () => {
    const { applyApplePurchase } = await import("@/lib/monetization/applePurchases")
    await applyApplePurchase(base, userId)
    expect(grantTokens).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      packageSku: "af_tokens_5",
      sourceType: "apple_iap",
      idempotencyKey: "apple_iap:apple-tx-1",
    }))
  })

  it("rejects expired subscriptions", async () => {
    const { applyApplePurchase } = await import("@/lib/monetization/applePurchases")
    await expect(applyApplePurchase({
      ...base,
      productId: "af_pro_monthly",
      type: "Auto-Renewable Subscription",
      purchaseDate: Date.now() - 86_400_000,
      expiresDate: Date.now() - 1000,
    }, userId)).rejects.toThrow("expired or incomplete")
    expect(upsertSubscription).not.toHaveBeenCalled()
  })

  it("does not let an older renewal shorten an active subscription", async () => {
    findSubscription.mockResolvedValue({ userId, currentPeriodEnd: new Date(Date.now() + 86_400_000 * 60) })
    const { applyApplePurchase } = await import("@/lib/monetization/applePurchases")
    await applyApplePurchase({
      ...base,
      productId: "af_pro_monthly",
      type: "Auto-Renewable Subscription",
      purchaseDate: Date.now() - 1000,
      expiresDate: Date.now() + 86_400_000 * 30,
    }, userId)
    expect(upsertSubscription).not.toHaveBeenCalled()
  })

  it("does not expire a subscription because an older period was refunded", async () => {
    findSubscription.mockResolvedValue({
      id: "sub-1", userId, appleLatestTransactionId: "apple-tx-2",
    })
    const { expireAppleSubscription } = await import("@/lib/monetization/applePurchases")
    await expireAppleSubscription(base, "expired")
    expect(updateSubscription).not.toHaveBeenCalled()
  })

  it("revokes access when the latest Apple period is refunded", async () => {
    findSubscription.mockResolvedValue({
      id: "sub-1", userId, appleLatestTransactionId: "apple-tx-1",
    })
    const { expireAppleSubscription } = await import("@/lib/monetization/applePurchases")
    await expireAppleSubscription(base, "expired")
    expect(updateSubscription).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "sub-1" },
      data: expect.objectContaining({ status: "expired", expiresAt: new Date(0) }),
    }))
  })
})
