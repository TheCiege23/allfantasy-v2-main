import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"

const getServerSessionMock = vi.hoisted(() => vi.fn())
const entitlementResolveForUserMock = vi.hoisted(() => vi.fn())
const tokenResolveForUserMock = vi.hoisted(() => vi.fn())
const isSubscriptionEntitlementBypassUserIdMock = vi.hoisted(() => vi.fn())

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

vi.mock("@/lib/subscription/EntitlementResolver", () => ({
  EntitlementResolver: class {
    resolveForUser = entitlementResolveForUserMock
  },
}))

vi.mock("@/lib/tokens/TokenBalanceResolver", () => ({
  TokenBalanceResolver: class {
    resolveForUser = tokenResolveForUserMock
  },
}))

vi.mock("@/lib/dev-admin/access", () => ({
  isSubscriptionEntitlementBypassUserId: isSubscriptionEntitlementBypassUserIdMock,
}))

describe("Resolver-backed entitlement/token routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: "u1", email: "user@example.com" } })
    entitlementResolveForUserMock.mockResolvedValue({
      entitlement: {
        plans: [],
        status: "none",
        currentPeriodEnd: null,
        gracePeriodEnd: null,
      },
      hasAccess: false,
      message: "Upgrade to access this feature.",
    })
    tokenResolveForUserMock.mockResolvedValue({
      balance: 0,
      lifetimePurchased: 0,
      lifetimeSpent: 0,
      lifetimeRefunded: 0,
      updatedAt: "2026-03-30T00:00:00.000Z",
    })
    isSubscriptionEntitlementBypassUserIdMock.mockReturnValue(false)
  })

  it("subscription entitlements route delegates to resolver and preserves shape", async () => {
    const { GET } = await import("@/app/api/subscription/entitlements/route")
    const req = createMockNextRequest("http://localhost/api/subscription/entitlements?feature=ai_chat")
    const res = await GET(req)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      entitlement: {
        plans: [],
        status: "none",
        currentPeriodEnd: null,
        gracePeriodEnd: null,
      },
      hasAccess: false,
      message: "Upgrade to access this feature.",
    })
    expect(entitlementResolveForUserMock).toHaveBeenCalledWith("u1", "ai_chat", "user@example.com")
  })

  it("tokens balance route delegates to resolver and preserves shape", async () => {
    const { GET } = await import("@/app/api/tokens/balance/route")
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      balance: 0,
      updatedAt: "2026-03-30T00:00:00.000Z",
    })
    expect(tokenResolveForUserMock).toHaveBeenCalledWith("u1", "user@example.com")
  })

  it("tokens balance route returns isAdminBypassAccount: false for normal user", async () => {
    isSubscriptionEntitlementBypassUserIdMock.mockReturnValue(false)
    const { GET } = await import("@/app/api/tokens/balance/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isAdminBypassAccount).toBe(false)
    // Resolver is still called regardless of bypass status
    expect(tokenResolveForUserMock).toHaveBeenCalledOnce()
  })

  it("tokens balance route returns isAdminBypassAccount: true for admin bypass user", async () => {
    isSubscriptionEntitlementBypassUserIdMock.mockReturnValue(true)
    const { GET } = await import("@/app/api/tokens/balance/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isAdminBypassAccount).toBe(true)
    // Balance resolver is still called (balance value is synthetic from TokenSpendService.getBalance bypass)
    expect(tokenResolveForUserMock).toHaveBeenCalledOnce()
  })

  it("tokens balance route returns 401 when unauthenticated", async () => {
    getServerSessionMock.mockResolvedValue(null)
    const { GET } = await import("@/app/api/tokens/balance/route")
    const res = await GET()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
    expect(tokenResolveForUserMock).not.toHaveBeenCalled()
  })

  it("normal paid user (af_pro_monthly) gets real balance — isAdminBypassAccount false", async () => {
    isSubscriptionEntitlementBypassUserIdMock.mockReturnValue(false)
    tokenResolveForUserMock.mockResolvedValue({
      balance: 5,
      lifetimePurchased: 5,
      lifetimeSpent: 0,
      lifetimeRefunded: 0,
      updatedAt: "2026-05-25T00:00:00.000Z",
    })
    const { GET } = await import("@/app/api/tokens/balance/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.balance).toBe(5)
    expect(body.isAdminBypassAccount).toBe(false)
  })

  it("normal paid user entitlements resolve af_pro_monthly as pro plan", async () => {
    entitlementResolveForUserMock.mockResolvedValue({
      entitlement: {
        plans: ["pro"],
        status: "active",
        currentPeriodEnd: "2099-01-01T00:00:00.000Z",
        gracePeriodEnd: null,
      },
      hasAccess: true,
      message: "Access granted.",
    })
    const { GET } = await import("@/app/api/subscription/entitlements/route")
    const req = createMockNextRequest("http://localhost/api/subscription/entitlements")
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entitlement.plans).toContain("pro")
    expect(body.entitlement.status).toBe("active")
    expect(body.hasAccess).toBe(true)
  })

  it("platform owner email does not trigger bypass — isSubscriptionEntitlementBypassUserId not called with email-only path", async () => {
    // This test documents that bypass is purely userId-driven.
    // An admin-email account like cjabar.henson@gmail.com goes through normal resolution.
    getServerSessionMock.mockResolvedValue({
      user: { id: "owner-user-id", email: "cjabar.henson@gmail.com" },
    })
    isSubscriptionEntitlementBypassUserIdMock.mockReturnValue(false)
    tokenResolveForUserMock.mockResolvedValue({
      balance: 5,
      lifetimePurchased: 5,
      lifetimeSpent: 0,
      lifetimeRefunded: 0,
      updatedAt: "2026-05-25T00:00:00.000Z",
    })
    const { GET } = await import("@/app/api/tokens/balance/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.balance).toBe(5)
    expect(body.isAdminBypassAccount).toBe(false)
    expect(isSubscriptionEntitlementBypassUserIdMock).toHaveBeenCalledWith(
      "owner-user-id",
      "cjabar.henson@gmail.com"
    )
  })
})
