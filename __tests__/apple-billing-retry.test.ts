import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JWSTransactionDecodedPayload } from "@apple/app-store-server-library"
import { resolveSubscriptionStatus } from "@/lib/subscription/SubscriptionStatusResolver"

/**
 * Apple DID_FAIL_TO_RENEW (2026-11-17). It fell through to "do nothing":
 *   - with a billing grace period, Apple keeps the member's service on — we cut it at the old period end;
 *   - without one, nothing recorded the failed payment.
 * Now the row goes `past_due`, with Apple's grace end when there is one.
 */

const findSubscription = vi.fn()
const updateSubscription = vi.fn()
const syncProfile = vi.fn()
vi.mock("@/lib/prisma", () => ({
  prisma: { userSubscription: { findUnique: findSubscription, update: updateSubscription, upsert: vi.fn() } },
}))
vi.mock("@/lib/subscription/syncBridge", () => ({ syncUserProfileFromSubscriptions: syncProfile }))
vi.mock("@/lib/subscription/webhookHandlers", () => ({ upsertSubscriptionPlanForCatalogItem: vi.fn() }))
vi.mock("@/lib/tokens/TokenSpendService", () => ({ TokenSpendService: class {} }))

const userId = "11111111-1111-4111-8111-111111111111"
const tx: JWSTransactionDecodedPayload = {
  transactionId: "apple-tx-2",
  originalTransactionId: "apple-original-1",
  productId: "af_pro_monthly",
  appAccountToken: userId,
  type: "Auto-Renewable Subscription",
  environment: "Sandbox",
}
const periodEnd = new Date(Date.now() - 60_000) // the renewal that failed was due a minute ago
const row = { id: "sub-1", userId, appleLatestTransactionId: "apple-tx-2", currentPeriodEnd: periodEnd, expiresAt: null }

beforeEach(() => {
  vi.clearAllMocks()
  findSubscription.mockResolvedValue(row)
})

describe("markAppleBillingRetry", () => {
  it("with Apple's grace period: past_due + grace end, which resolves to access (grace)", async () => {
    const { markAppleBillingRetry } = await import("@/lib/monetization/applePurchases")
    const graceEnd = new Date(Date.now() + 6 * 86_400_000)
    await markAppleBillingRetry(tx, graceEnd)
    expect(updateSubscription).toHaveBeenCalledWith({ where: { id: "sub-1" }, data: { status: "past_due", gracePeriodEnd: graceEnd } })
    expect(syncProfile).toHaveBeenCalledWith(userId)
    const written = { ...row, ...updateSubscription.mock.calls[0]![0].data }
    expect(resolveSubscriptionStatus(written)).toBe("grace")
  })

  it("control: the same row left as it was (no notice handled) has already lost access", () => {
    expect(resolveSubscriptionStatus({ ...row, status: "active", gracePeriodEnd: null })).toBe("expired")
  })

  it("without a grace period: past_due, no grace — access ends with the paid period", async () => {
    const { markAppleBillingRetry } = await import("@/lib/monetization/applePurchases")
    await markAppleBillingRetry(tx, null)
    const data = updateSubscription.mock.calls[0]![0].data
    expect(data).toEqual({ status: "past_due", gracePeriodEnd: null })
    expect(resolveSubscriptionStatus({ ...row, ...data })).toBe("expired")
    // …and while the period has not ended yet, it reads as a billing problem, not as active:
    expect(resolveSubscriptionStatus({ ...row, ...data, currentPeriodEnd: new Date(Date.now() + 3_600_000) })).toBe("past_due")
  })

  it("a grace end already in the past is not stored", async () => {
    const { markAppleBillingRetry } = await import("@/lib/monetization/applePurchases")
    await markAppleBillingRetry(tx, new Date(Date.now() - 1000))
    expect(updateSubscription.mock.calls[0]![0].data.gracePeriodEnd).toBeNull()
  })

  it("an old failure cannot touch a newer renewal", async () => {
    findSubscription.mockResolvedValue({ ...row, appleLatestTransactionId: "apple-tx-3" })
    const { markAppleBillingRetry } = await import("@/lib/monetization/applePurchases")
    await markAppleBillingRetry(tx, null)
    expect(updateSubscription).not.toHaveBeenCalled()
  })

  it("a transaction for a different account is refused", async () => {
    findSubscription.mockResolvedValue({ ...row, userId: "22222222-2222-4222-8222-222222222222" })
    const { markAppleBillingRetry } = await import("@/lib/monetization/applePurchases")
    await expect(markAppleBillingRetry(tx, null)).rejects.toThrow("account mismatch")
    expect(updateSubscription).not.toHaveBeenCalled()
  })
})

describe("the notifications route hands DID_FAIL_TO_RENEW to it", () => {
  it("GRACE_PERIOD: reads the grace end from the verified renewal info", async () => {
    vi.resetModules()
    const mark = vi.fn(async () => undefined)
    const graceMs = Date.now() + 5 * 86_400_000
    vi.doMock("@/lib/monetization/appleStore", () => ({
      appleIapConfigured: () => true,
      verifyAppleNotification: async () => ({
        environment: "Sandbox",
        payload: { notificationType: "DID_FAIL_TO_RENEW", subtype: "GRACE_PERIOD", data: { signedTransactionInfo: "t", signedRenewalInfo: "r" } },
      }),
      verifyAppleTransaction: async () => tx,
      verifyAppleRenewalInfo: async (signed: string) => {
        expect(signed).toBe("r")
        return { gracePeriodExpiresDate: graceMs }
      },
      getCurrentAppleTransaction: vi.fn(),
    }))
    vi.doMock("@/lib/monetization/applePurchases", () => ({
      ApplePurchaseError: class extends Error { status = 400 },
      applyApplePurchase: vi.fn(),
      expireAppleSubscription: vi.fn(),
      markAppleBillingRetry: mark,
    }))
    const { POST } = await import("@/app/api/monetization/apple/notifications/route")
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ signedPayload: "p" }) }))
    expect(res.status).toBe(200)
    expect(mark).toHaveBeenCalledWith(tx, new Date(graceMs))
  })

  it("no subtype (billing retry without grace): marked with no grace end", async () => {
    vi.resetModules()
    const mark = vi.fn(async () => undefined)
    const renewal = vi.fn()
    vi.doMock("@/lib/monetization/appleStore", () => ({
      appleIapConfigured: () => true,
      verifyAppleNotification: async () => ({
        environment: "Sandbox",
        payload: { notificationType: "DID_FAIL_TO_RENEW", data: { signedTransactionInfo: "t", signedRenewalInfo: "r" } },
      }),
      verifyAppleTransaction: async () => tx,
      verifyAppleRenewalInfo: renewal,
      getCurrentAppleTransaction: vi.fn(),
    }))
    vi.doMock("@/lib/monetization/applePurchases", () => ({
      ApplePurchaseError: class extends Error { status = 400 },
      applyApplePurchase: vi.fn(),
      expireAppleSubscription: vi.fn(),
      markAppleBillingRetry: mark,
    }))
    const { POST } = await import("@/app/api/monetization/apple/notifications/route")
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ signedPayload: "p" }) }))
    expect(res.status).toBe(200)
    expect(mark).toHaveBeenCalledWith(tx, null)
    expect(renewal).not.toHaveBeenCalled()
  })
})
