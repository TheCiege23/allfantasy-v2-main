/**
 * Google Play Billing grants. Mirrors __tests__/apple-purchases.test.ts, with an
 * in-memory google_play_purchases / user_subscriptions so the claim-and-lock
 * and the shared-row rules are exercised, not just called.
 */
import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

type Claim = {
  id: string
  purchaseTokenHash: string
  purchaseToken: string
  userId: string
  productId: string
  kind: string
  userSubscriptionId: string | null
  latestOrderId: string | null
  state: string | null
  testPurchase: boolean
  createdAt: Date
}
type SubRow = Record<string, unknown> & { id: string }

const claims = new Map<string, Claim>()
const subs = new Map<string, SubRow>()
let clock = 0
const calls: string[] = []

const grantTokens = vi.fn(async () => {
  calls.push("grant")
  return {}
})
const reverseGoogle = vi.fn()
const syncProfile = vi.fn()
const api = {
  getSubscriptionPurchase: vi.fn(),
  acknowledgeSubscription: vi.fn(async () => {
    calls.push("ack")
    return {}
  }),
  getProductPurchase: vi.fn(),
  consumeProduct: vi.fn(async () => {
    calls.push("consume")
    return {}
  }),
}

function byId(id: string) {
  return [...claims.values()].find((c) => c.id === id)
}

const db = {
  $executeRaw: async (_s: TemplateStringsArray, ...v: unknown[]) => {
    const [id, hash, token, userId, productId, kind] = v as string[]
    if (!claims.has(hash)) {
      claims.set(hash, {
        id, purchaseTokenHash: hash, purchaseToken: token, userId, productId, kind,
        userSubscriptionId: null, latestOrderId: null, state: null, testPurchase: false,
        createdAt: new Date(1_000 + clock++),
      })
    }
    return 1
  },
  $queryRaw: async (_s: TemplateStringsArray, hash: string) => {
    const c = claims.get(hash)
    return c ? [{ ...c }] : []
  },
  googlePlayPurchase: {
    findUnique: async ({ where }: { where: { purchaseTokenHash: string } }) => {
      const c = claims.get(where.purchaseTokenHash)
      return c ? { ...c } : null
    },
    findFirst: async ({ where }: { where: { userSubscriptionId: string; createdAt: { gt: Date }; id: { not: string } } }) =>
      [...claims.values()].find(
        (c) => c.userSubscriptionId === where.userSubscriptionId && c.createdAt > where.createdAt.gt && c.id !== where.id.not,
      ) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<Claim> }) => {
      const c = byId(where.id)!
      Object.assign(c, data)
      return c
    },
  },
  userSubscription: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const id = `sub-${subs.size + 1}`
      subs.set(id, { id, ...data })
      return { id }
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      Object.assign(subs.get(where.id)!, data)
      return { id: where.id }
    },
  },
}

vi.mock("@/lib/prisma", () => ({
  prisma: { ...db, $transaction: async (fn: (tx: typeof db) => unknown) => fn(db) },
}))
vi.mock("@/lib/monetization/catalog", () => ({
  getMonetizationCatalogItemBySku: (sku: string) => {
    if (sku === "af_tokens_5") return { sku, type: "token_pack", tokenAmount: 250, title: "Starter Tokens" }
    if (sku === "af_pro_monthly") return { sku, type: "subscription", planFamily: "af_pro", title: "AF Pro Monthly" }
    if (sku === "af_pro_yearly") return { sku, type: "subscription", planFamily: "af_pro", title: "AF Pro Yearly" }
    return null
  },
}))
vi.mock("@/lib/subscription/webhookHandlers", () => ({
  upsertSubscriptionPlanForCatalogItem: vi.fn(async () => ({ id: "plan-1" })),
}))
vi.mock("@/lib/subscription/syncBridge", () => ({ syncUserProfileFromSubscriptions: syncProfile }))
vi.mock("@/lib/tokens/TokenSpendService", () => ({
  TokenSpendService: class {
    grantTokensFromPackagePurchase = grantTokens
    reverseGooglePlayPackagePurchase = reverseGoogle
  },
}))
vi.mock("@/lib/google-play/playDeveloperApi", () => ({
  ...api,
  readPlayBillingConfig: () => ({ packageName: "ai.allfantasy.app", serviceAccount: {} }),
}))

const alice = "11111111-1111-4111-8111-111111111111"
const bob = "22222222-2222-4222-8222-222222222222"
const future = new Date(Date.now() + 30 * 86_400_000).toISOString()
const past = new Date(Date.now() - 86_400_000).toISOString()
const hash = (t: string) => createHash("sha256").update(t).digest("hex")

function activeSub(overrides: Record<string, unknown> = {}) {
  return {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
    latestOrderId: "GPA.1111",
    startTime: new Date().toISOString(),
    lineItems: [{ productId: "af_pro_monthly", expiryTime: future }],
    ...overrides,
  }
}

async function load() {
  return import("@/lib/monetization/googlePlayPurchases")
}

describe("Google Play token packs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    claims.clear()
    subs.clear()
    calls.length = 0
    api.getProductPurchase.mockResolvedValue({ purchaseState: 0, consumptionState: 0, orderId: "GPA.TOK-1" })
  })

  it("grants once keyed on the Google order id, and consumes only after the grant", async () => {
    const { applyGooglePlayPurchase } = await load()
    await applyGooglePlayPurchase({ userId: alice, sku: "af_tokens_5", purchaseToken: "tok-a" })
    expect(grantTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: alice,
        packageSku: "af_tokens_5",
        sourceType: "google_play",
        idempotencyKey: "google_play:GPA.TOK-1",
      }),
    )
    expect(calls).toEqual(["grant", "consume"])
    expect(claims.get(hash("tok-a"))).toMatchObject({ userId: alice, kind: "product", latestOrderId: "GPA.TOK-1" })
  })

  it("refuses a token already claimed by another account and grants nothing", async () => {
    const { applyGooglePlayPurchase } = await load()
    await applyGooglePlayPurchase({ userId: alice, sku: "af_tokens_5", purchaseToken: "tok-a" })
    grantTokens.mockClear()
    await expect(applyGooglePlayPurchase({ userId: bob, sku: "af_tokens_5", purchaseToken: "tok-a" })).rejects.toMatchObject({
      status: 409,
    })
    expect(grantTokens).not.toHaveBeenCalled()
  })

  it("reports a pending payment as 202 and grants nothing", async () => {
    api.getProductPurchase.mockResolvedValue({ purchaseState: 2 })
    const { applyGooglePlayPurchase } = await load()
    await expect(applyGooglePlayPurchase({ userId: alice, sku: "af_tokens_5", purchaseToken: "tok-p" })).rejects.toMatchObject({
      status: 202,
    })
    expect(grantTokens).not.toHaveBeenCalled()
  })

  it("keys a purchase with no order id (license tester) on the token hash, never the raw token", async () => {
    api.getProductPurchase.mockResolvedValue({ purchaseState: 0, consumptionState: 1, purchaseType: 0 })
    const { applyGooglePlayPurchase } = await load()
    await applyGooglePlayPurchase({ userId: alice, sku: "af_tokens_5", purchaseToken: "tok-test" })
    const key = (grantTokens.mock.calls[0] as unknown as [{ idempotencyKey: string }])[0].idempotencyKey
    expect(key).toBe(`google_play:t:${hash("tok-test").slice(0, 40)}`)
    expect(key).not.toContain("tok-test")
    // Already consumed: no second consume.
    expect(api.consumeProduct).not.toHaveBeenCalled()
  })

  it("reverses a refunded pack by its order id", async () => {
    const { applyGooglePlayPurchase, voidGooglePlayPurchase } = await load()
    await applyGooglePlayPurchase({ userId: alice, sku: "af_tokens_5", purchaseToken: "tok-a" })
    await expect(voidGooglePlayPurchase("tok-a")).resolves.toBe("voided")
    expect(reverseGoogle).toHaveBeenCalledWith("GPA.TOK-1")
  })

  it("rejects an unknown product before calling Google", async () => {
    const { applyGooglePlayPurchase } = await load()
    await expect(applyGooglePlayPurchase({ userId: alice, sku: "af_nope", purchaseToken: "x" })).rejects.toThrow("Unknown")
    expect(api.getProductPurchase).not.toHaveBeenCalled()
  })
})

describe("Google Play subscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    claims.clear()
    subs.clear()
    calls.length = 0
    api.getSubscriptionPurchase.mockResolvedValue(activeSub())
  })

  it("creates one google_play row, acknowledges, and a repeat post updates the same row", async () => {
    const { applyGooglePlayPurchase } = await load()
    await applyGooglePlayPurchase({ userId: alice, sku: "af_pro_monthly", purchaseToken: "sub-a" })
    await applyGooglePlayPurchase({ userId: alice, sku: "af_pro_monthly", purchaseToken: "sub-a" })
    expect(subs.size).toBe(1)
    expect([...subs.values()][0]).toMatchObject({
      userId: alice,
      source: "google_play",
      sku: "af_pro_monthly",
      status: "active",
      currentPeriodEnd: new Date(future),
    })
    expect(api.acknowledgeSubscription).toHaveBeenCalledWith(expect.anything(), "af_pro_monthly", "sub-a")
    expect(syncProfile).toHaveBeenCalledWith(alice)
  })

  it("refuses a token whose Google product is not the plan requested", async () => {
    const { applyGooglePlayPurchase } = await load()
    await expect(applyGooglePlayPurchase({ userId: alice, sku: "af_pro_yearly", purchaseToken: "sub-a" })).rejects.toThrow(
      "does not match",
    )
    expect(subs.size).toBe(0)
  })

  it("refuses an expired subscription on a fresh claim", async () => {
    api.getSubscriptionPurchase.mockResolvedValue(
      activeSub({ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED", lineItems: [{ productId: "af_pro_monthly", expiryTime: past }] }),
    )
    const { applyGooglePlayPurchase } = await load()
    await expect(applyGooglePlayPurchase({ userId: alice, sku: "af_pro_monthly", purchaseToken: "sub-a" })).rejects.toThrow()
    expect(subs.size).toBe(0)
  })

  it("a notification after expiry ends access on the owner's row", async () => {
    const { applyGooglePlayPurchase, refreshGooglePlaySubscription } = await load()
    await applyGooglePlayPurchase({ userId: alice, sku: "af_pro_monthly", purchaseToken: "sub-a" })
    api.getSubscriptionPurchase.mockResolvedValue(
      activeSub({ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED", lineItems: [{ productId: "af_pro_monthly", expiryTime: past }] }),
    )
    await expect(refreshGooglePlaySubscription("sub-a")).resolves.toBe("applied")
    expect([...subs.values()][0]).toMatchObject({ status: "expired", expiresAt: new Date(0) })
  })

  it("an upgrade's linked token keeps the same row, and a late event on the old token cannot roll it back", async () => {
    const { applyGooglePlayPurchase, refreshGooglePlaySubscription } = await load()
    await applyGooglePlayPurchase({ userId: alice, sku: "af_pro_monthly", purchaseToken: "sub-old" })
    api.getSubscriptionPurchase.mockResolvedValue(
      activeSub({ linkedPurchaseToken: "sub-old", lineItems: [{ productId: "af_pro_yearly", expiryTime: future }] }),
    )
    await applyGooglePlayPurchase({ userId: alice, sku: "af_pro_yearly", purchaseToken: "sub-new" })
    expect(subs.size).toBe(1)
    expect([...subs.values()][0]).toMatchObject({ sku: "af_pro_yearly", status: "active" })

    api.getSubscriptionPurchase.mockResolvedValue(
      activeSub({ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED", lineItems: [{ productId: "af_pro_monthly", expiryTime: past }] }),
    )
    await refreshGooglePlaySubscription("sub-old")
    expect([...subs.values()][0]).toMatchObject({ sku: "af_pro_yearly", status: "active" })
  })

  it("refuses another account presenting a token linked to someone else's subscription", async () => {
    const { applyGooglePlayPurchase } = await load()
    await applyGooglePlayPurchase({ userId: alice, sku: "af_pro_monthly", purchaseToken: "sub-old" })
    api.getSubscriptionPurchase.mockResolvedValue(activeSub({ linkedPurchaseToken: "sub-old" }))
    await expect(applyGooglePlayPurchase({ userId: bob, sku: "af_pro_monthly", purchaseToken: "sub-new" })).rejects.toMatchObject({
      status: 409,
    })
  })

  it("a refund on the current token expires the row; on a replaced token it does not", async () => {
    const { applyGooglePlayPurchase, voidGooglePlayPurchase } = await load()
    await applyGooglePlayPurchase({ userId: alice, sku: "af_pro_monthly", purchaseToken: "sub-old" })
    api.getSubscriptionPurchase.mockResolvedValue(activeSub({ linkedPurchaseToken: "sub-old" }))
    await applyGooglePlayPurchase({ userId: alice, sku: "af_pro_monthly", purchaseToken: "sub-new" })

    await voidGooglePlayPurchase("sub-old")
    expect([...subs.values()][0]).toMatchObject({ status: "active" })

    await voidGooglePlayPurchase("sub-new")
    expect([...subs.values()][0]).toMatchObject({ status: "expired" })
  })

  it("ignores a notification for a token nobody has claimed", async () => {
    const { refreshGooglePlaySubscription } = await load()
    await expect(refreshGooglePlaySubscription("never-posted")).resolves.toBe("unclaimed")
    expect(subs.size).toBe(0)
  })
})

describe("statusForSubscriptionState", () => {
  it("keeps a cancelled subscription active until expiry and treats hold as past due", async () => {
    const { statusForSubscriptionState } = await load()
    expect(statusForSubscriptionState("SUBSCRIPTION_STATE_CANCELED")).toBe("active")
    expect(statusForSubscriptionState("SUBSCRIPTION_STATE_IN_GRACE_PERIOD")).toBe("active")
    expect(statusForSubscriptionState("SUBSCRIPTION_STATE_ON_HOLD")).toBe("past_due")
    expect(statusForSubscriptionState("SUBSCRIPTION_STATE_EXPIRED")).toBe("expired")
    expect(statusForSubscriptionState("SUBSCRIPTION_STATE_PENDING")).toBeNull()
  })
})
