import { beforeEach, describe, expect, it, vi } from "vitest"

const userSubscriptionFindManyMock = vi.hoisted(() => vi.fn())
const adminSubscriptionGrantFindManyMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userSubscription: {
      findMany: userSubscriptionFindManyMock,
    },
    adminSubscriptionGrant: {
      findMany: adminSubscriptionGrantFindManyMock,
    },
  },
}))

describe("EntitlementResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.DEV_ADMIN_USER_IDS
    adminSubscriptionGrantFindManyMock.mockResolvedValue([])
  })

  it("returns none when user has no subscriptions", async () => {
    userSubscriptionFindManyMock.mockResolvedValueOnce([])
    const { EntitlementResolver } = await import("@/lib/subscription/EntitlementResolver")
    const resolver = new EntitlementResolver()
    const snapshot = await resolver.resolveSnapshot("u1")
    expect(snapshot).toMatchObject({
      plans: [],
      status: "none",
      currentPeriodEnd: null,
      gracePeriodEnd: null,
    })
  })

  it("maps supreme plan and inherits other feature groups", async () => {
    userSubscriptionFindManyMock.mockResolvedValueOnce([
      {
        status: "active",
        currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
        gracePeriodEnd: null,
        expiresAt: null,
        sku: "af_supreme_monthly",
        plan: { code: "af_supreme" },
      },
    ])
    const { EntitlementResolver } = await import("@/lib/subscription/EntitlementResolver")
    const resolver = new EntitlementResolver()
    const snapshot = await resolver.resolveSnapshot("u1")

    expect(snapshot.status).toBe("active")
    expect(snapshot.plans).toContain("supreme")
    expect(resolver.hasFeatureAccess(snapshot, "trade_analyzer")).toBe(true)
    expect(resolver.hasFeatureAccess(snapshot, "commissioner_automation")).toBe(true)
    expect(resolver.hasFeatureAccess(snapshot, "draft_strategy_build")).toBe(true)
  })

  it("treats expired subscriptions as locked features", async () => {
    userSubscriptionFindManyMock.mockResolvedValueOnce([
      {
        status: "expired",
        currentPeriodEnd: new Date("2020-01-01T00:00:00.000Z"),
        gracePeriodEnd: null,
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
        sku: "af_pro_monthly",
        plan: { code: "af_pro" },
      },
    ])
    const { EntitlementResolver } = await import("@/lib/subscription/EntitlementResolver")
    const resolver = new EntitlementResolver()
    const resolved = await resolver.resolveForUser("u1", "ai_chat")

    expect(resolved.entitlement.status).toBe("expired")
    expect(resolved.hasAccess).toBe(false)
    expect(resolved.message).toContain("expired")
  })

  it("returns supreme entitlement for configured dev admins", async () => {
    process.env.DEV_ADMIN_USER_IDS = "dev-user-1"

    const { EntitlementResolver } = await import("@/lib/subscription/EntitlementResolver")
    const resolver = new EntitlementResolver()
    const snapshot = await resolver.resolveSnapshot("dev-user-1")

    expect(snapshot).toMatchObject({
      plans: ["supreme"],
      status: "active",
      currentPeriodEnd: null,
      gracePeriodEnd: null,
    })
    expect(userSubscriptionFindManyMock).not.toHaveBeenCalled()
  })

  it("returns supreme entitlement for the configured owner email", async () => {
    const { EntitlementResolver } = await import("@/lib/subscription/EntitlementResolver")
    const resolver = new EntitlementResolver()
    const snapshot = await resolver.resolveSnapshot("normal-id", "CJABAR.HENSON@GMAIL.COM")

    expect(snapshot).toMatchObject({
      plans: ["supreme"],
      status: "active",
      currentPeriodEnd: null,
      gracePeriodEnd: null,
    })
    expect(userSubscriptionFindManyMock).not.toHaveBeenCalled()
  })
})
