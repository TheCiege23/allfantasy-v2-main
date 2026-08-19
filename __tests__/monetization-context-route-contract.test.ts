import { beforeEach, describe, expect, it, vi } from "vitest"

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
const getServerSessionMock = vi.fn()
const resolveForUserMock = vi.fn()
const resolveTokenBalanceMock = vi.fn()
const previewSpendWithEntitlementMock = vi.fn()

class MockTokenSpendRuleNotFoundError extends Error {}

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

vi.mock("@/lib/subscription/EntitlementResolver", () => ({
  EntitlementResolver: class {
    resolveForUser = resolveForUserMock
  },
}))

vi.mock("@/lib/subscription/feature-access", () => ({
  buildFeatureUpgradePath: vi.fn((featureId: string) => `/upgrade/${featureId}`),
  getDisplayPlanName: vi.fn(() => "AF Pro"),
  getRequiredPlanForFeature: vi.fn(() => "pro"),
  isSubscriptionFeatureId: vi.fn(() => true),
  resolveBundleInheritance: vi.fn(() => ({
    hasSupreme: false,
    inheritedPlanIds: [],
    effectivePlanIds: [],
  })),
}))

vi.mock("@/lib/tokens/TokenBalanceResolver", () => ({
  TokenBalanceResolver: class {
    resolveForUser = resolveTokenBalanceMock
  },
}))

vi.mock("@/lib/tokens/TokenSpendService", () => ({
  TokenSpendRuleNotFoundError: MockTokenSpendRuleNotFoundError,
  TokenSpendService: class {
    previewSpendWithEntitlement = previewSpendWithEntitlementMock
  },
}))

describe("GET /api/monetization/context", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } })
    resolveForUserMock.mockResolvedValue({
      entitlement: {
        plans: ["pro"],
        status: "active",
        currentPeriodEnd: null,
        gracePeriodEnd: null,
      },
      hasAccess: true,
      message: "Access granted.",
    })
    resolveTokenBalanceMock.mockResolvedValue({
      balance: 8,
      lifetimePurchased: 10,
      lifetimeSpent: 2,
      lifetimeRefunded: 0,
      updatedAt: "2026-03-31T00:00:00.000Z",
    })
  })

  it("returns monetization context successfully when token previews resolve", async () => {
    previewSpendWithEntitlementMock.mockResolvedValue({
      ruleCode: "ai_chimmy_chat_message",
      featureLabel: "Chimmy chat message",
      tokenCost: 15,
      currentBalance: 8,
      canSpend: true,
      requiresConfirmation: true,
    })

    const { GET } = await import("@/app/api/monetization/context/route")
    const res = await GET(
      createMockNextRequest("http://localhost/api/monetization/context?feature=ai_chat&ruleCode=ai_chimmy_chat_message")
    )

    expect(res.status).toBe(200)
    expect(previewSpendWithEntitlementMock).toHaveBeenCalledWith({
      userId: "user-1",
      ruleCode: "ai_chimmy_chat_message",
      entitlement: {
        plans: ["pro"],
        status: "active",
        currentPeriodEnd: null,
        gracePeriodEnd: null,
      },
      currentBalance: 8,
    })
    await expect(res.json()).resolves.toMatchObject({
      tokenPreviews: [
        {
          ruleCode: "ai_chimmy_chat_message",
          preview: expect.objectContaining({
            tokenCost: 15,
            currentBalance: 8,
          }),
          error: null,
        },
      ],
    })
  })

  it("degrades gracefully when a token preview throws", async () => {
    previewSpendWithEntitlementMock.mockRejectedValueOnce(new Error("preview exploded"))

    const { GET } = await import("@/app/api/monetization/context/route")
    const res = await GET(
      createMockNextRequest("http://localhost/api/monetization/context?ruleCode=ai_chimmy_chat_message")
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      tokenPreviews: [
        {
          ruleCode: "ai_chimmy_chat_message",
          preview: null,
          error: "Unable to preview token cost right now.",
        },
      ],
    })
  })
})
