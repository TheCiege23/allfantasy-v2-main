import { beforeEach, describe, expect, it, vi } from "vitest"

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
const chatChimmyPostMock = vi.fn()
const runAgentPipelineMock = vi.fn()
const streamAgentPipelineMock = vi.fn()
const isAnthropicChimmyEnabledMock = vi.fn()
const isAnthropicPipelineAvailableMock = vi.fn()
const getServerSessionMock = vi.fn()
const runAiProtectionMock = vi.fn()
const requireFeatureEntitlementMock = vi.fn()
const refundSpendByLedgerMock = vi.fn()
vi.mock('@/lib/chimmy/planAllowance', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/chimmy/planAllowance')>(),
  // These fixtures exercise the paid-token path after the two daily answers are used.
  readChimmyAnswerAllowance: async () => ({ kind: 'free', planName: 'Free Chimmy', limit: 2,
    used: 2, remaining: 0, resetsAt: '2026-10-26T00:00:00.000Z' }),
}))

vi.mock("@/app/api/chat/chimmy/route", () => ({
  POST: chatChimmyPostMock,
}))

vi.mock("@/lib/agents/anthropic-pipeline", () => ({
  runAgentPipeline: runAgentPipelineMock,
  streamAgentPipeline: streamAgentPipelineMock,
  isAnthropicPipelineAvailable: isAnthropicPipelineAvailableMock,
}))

vi.mock("@/lib/feature-toggle", () => ({
  isAnthropicChimmyEnabled: isAnthropicChimmyEnabledMock,
}))

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

vi.mock("@/lib/ai-protection", () => ({
  runAiProtection: runAiProtectionMock,
}))

vi.mock("@/lib/subscription/entitlement-middleware", () => ({
  requireFeatureEntitlement: requireFeatureEntitlementMock,
}))

vi.mock("@/lib/tokens/TokenSpendService", () => ({
  TokenSpendService: vi.fn().mockImplementation(() => ({
    refundSpendByLedger: refundSpendByLedgerMock,
  })),
}))

function buildJsonRequest(body: Record<string, unknown>) {
  return createMockNextRequest("http://localhost/api/chimmy", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "next-auth.session-token=test" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/chimmy compatibility route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isAnthropicChimmyEnabledMock.mockResolvedValue(false)
    isAnthropicPipelineAvailableMock.mockReturnValue(true)
    getServerSessionMock.mockResolvedValue({ user: { id: "session-user" } })
    runAiProtectionMock.mockResolvedValue(null)
    requireFeatureEntitlementMock.mockResolvedValue({
      ok: true,
      decision: {
        entitlement: {
          plans: ["pro"],
        },
      },
      tokenSpend: { id: 'alias-ledger', balanceAfter: 10 },
      tokenPreview: null,
    })
    refundSpendByLedgerMock.mockResolvedValue(null)
    streamAgentPipelineMock.mockReset()
  })

  it("maps the JSON compatibility contract into the dedicated Chimmy handler", async () => {
    chatChimmyPostMock.mockImplementationOnce(async (req: Request) => {
      const formData = await req.formData()

      expect(formData.get("message")).toBe("What should I do?")
      expect(formData.get("source")).toBe("trade_analyzer")
      expect(formData.get("confirmTokenSpend")).toBe("true")
      expect(formData.get("messages")).toBe(
        JSON.stringify([{ role: "assistant", content: "Previous answer" }])
      )
      expect(formData.get("sport")).toBe("NFL")
      expect(formData.get("leagueId")).toBe("league-1")
      expect(formData.get("leagueFormat")).toBe("dynasty")
      expect(formData.get("scoring")).toBe("PPR")
      expect(formData.get("tone")).toBe("strategic")
      expect(formData.get("detailLevel")).toBe("concise")
      expect(formData.get("riskMode")).toBe("balanced")
      expect(formData.get("strategyMode")).toBe("balanced")

      return Response.json({
        response: "You should hold for now.",
        meta: { confidencePct: 82 },
      })
    })

    const { POST } = await import("@/app/api/chimmy/route")
    const res = await POST(
      buildJsonRequest({
        message: "What should I do?",
        confirmTokenSpend: true,
        conversation: [{ role: "assistant", content: "Previous answer" }],
        userContext: {
          userId: "user-1",
          tier: "pro",
          sport: "NFL",
          leagueId: "league-1",
          source: "trade_analyzer",
          leagueFormat: "dynasty",
          scoring: "PPR",
          memory: {
            tone: "strategic",
            detailLevel: "concise",
            riskMode: "balanced",
          },
        },
      }) as any
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      response: "You should hold for now.",
      result: "You should hold for now.",
      message: "You should hold for now.",
      meta: { confidencePct: 82 },
      upgradeRequired: false,
    })
  })

  it("marks token/upgrade gating as upgradeRequired in the compatibility response", async () => {
    chatChimmyPostMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "Insufficient token balance",
          code: "insufficient_token_balance",
        }),
        {
          status: 402,
          headers: { "Content-Type": "application/json" },
        }
      )
    )

    const { POST } = await import("@/app/api/chimmy/route")
    const res = await POST(
      buildJsonRequest({
        message: "Help me with this trade",
        userContext: {
          sport: "NFL",
          leagueId: "league-1",
        },
      }) as any
    )

    expect(res.status).toBe(402)
    await expect(res.json()).resolves.toEqual({
      error: "Insufficient token balance",
      code: "insufficient_token_balance",
      response:
        "This is a premium feature. Upgrade to AF Pro or AF Supreme to unlock full trade analysis, waiver recommendations, draft assistance, and more.",
      result:
        "This is a premium feature. Upgrade to AF Pro or AF Supreme to unlock full trade analysis, waiver recommendations, draft assistance, and more.",
      message:
        "This is a premium feature. Upgrade to AF Pro or AF Supreme to unlock full trade analysis, waiver recommendations, draft assistance, and more.",
      upgradeRequired: true,
      upgradePath: "/pricing",
    })
  })

  it("returns 400 for invalid JSON compatibility payloads", async () => {
    const { POST } = await import("@/app/api/chimmy/route")
    const res = await POST(
      buildJsonRequest({
        message: "",
        userContext: {
          sport: "NFL",
        },
      }) as any
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: "Invalid request format.",
      details: {
        fieldErrors: {
          message: expect.any(Array),
        },
      },
    })
  })

  it("returns 412 for league-specific requests without leagueId", async () => {
    const { POST } = await import("@/app/api/chimmy/route")
    const res = await POST(
      buildJsonRequest({
        message: "Should I trade this player now?",
        userContext: {
          sport: "NFL",
          source: "trade_analyzer",
        },
      }) as any
    )

    expect(res.status).toBe(412)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("League context is required"),
    })
    expect(chatChimmyPostMock).not.toHaveBeenCalled()
    expect(runAgentPipelineMock).not.toHaveBeenCalled()
  })

  it("uses the Anthropic pipeline when the feature flag is enabled for supported requests", async () => {
    isAnthropicChimmyEnabledMock.mockResolvedValueOnce(true)
    runAgentPipelineMock.mockResolvedValueOnce({
      result: "Hold the core and ask for a better plus piece.",
      intent: "trade_evaluation",
      model: "claude-sonnet-4-6",
      tokensUsed: 143,
    })

    const { POST } = await import("@/app/api/chimmy/route")
    const res = await POST(
      buildJsonRequest({
        message: "Should I trade CeeDee Lamb for Diggs and a 2026 2nd?",
        confirmTokenSpend: true,
        conversation: [{ role: "assistant", content: "Prior context" }],
        userContext: {
          userId: "spoofed-user",
          tier: "free",
          sport: "NFL",
          leagueId: "league-1",
          source: "trade_analyzer",
          leagueFormat: "dynasty",
          scoring: "PPR",
          memory: {
            tone: "strategic",
            detailLevel: "concise",
            riskMode: "balanced",
          },
        },
      }) as any
    )

    expect(chatChimmyPostMock).not.toHaveBeenCalled()
    expect(runAgentPipelineMock).toHaveBeenCalledWith(
      "Should I trade CeeDee Lamb for Diggs and a 2026 2nd?",
      expect.objectContaining({
        userId: "session-user",
        tier: "pro",
        sport: "NFL",
        leagueId: "league-1",
        source: "trade_analyzer",
        leagueFormat: "dynasty",
        scoring: "PPR",
        conversation: [{ role: "assistant", content: "Prior context" }],
      })
    )
    expect(requireFeatureEntitlementMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "session-user",
        featureId: "ai_chat",
        confirmTokenSpend: true,
      })
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      result: "Hold the core and ask for a better plus piece.",
      response: "Hold the core and ask for a better plus piece.",
      intent: "trade_evaluation",
      model: "claude-sonnet-4-6",
      tokensUsed: 143,
      meta: {
        responseStructure: {
          shortAnswer: "Hold the core and ask for a better plus piece.",
        },
        recommendedTool: "trade_analyzer",
      },
      upgradeRequired: false,
    })
  })

  it("uses the Anthropic pipeline for image requests when Anthropic is enabled", async () => {
    isAnthropicChimmyEnabledMock.mockResolvedValueOnce(true)
    runAgentPipelineMock.mockResolvedValueOnce({
      result: "Claude analyzed the uploaded image successfully.",
      intent: "quick_ask",
      model: "claude-sonnet-4-6",
      tokensUsed: 77,
    })

    const { POST } = await import("@/app/api/chimmy/route")
    const res = await POST(
      buildJsonRequest({
        message: "Analyze this screenshot",
        image: {
          dataUrl: "data:image/png;base64,aW1hZ2UtYnl0ZXM=",
          name: "upload.png",
          type: "image/png",
        },
        userContext: {
          sport: "NFL",
          leagueId: "league-1",
          source: "trade_analyzer",
        },
      }) as any
    )

    expect(res.status).toBe(200)
    expect(chatChimmyPostMock).not.toHaveBeenCalled()
    expect(runAgentPipelineMock).toHaveBeenCalledWith(
      "Analyze this screenshot",
      expect.objectContaining({
        userId: "session-user",
        tier: "pro",
        sport: "NFL",
        leagueId: "league-1",
        source: "trade_analyzer",
        image: {
          data: "aW1hZ2UtYnl0ZXM=",
          mediaType: "image/png",
          name: "upload.png",
        },
      })
    )
    await expect(res.json()).resolves.toMatchObject({
      response: "Claude analyzed the uploaded image successfully.",
      result: "Claude analyzed the uploaded image successfully.",
      intent: "quick_ask",
      model: "claude-sonnet-4-6",
      tokensUsed: 77,
      upgradeRequired: false,
    })
  })

  it("streams Anthropic responses when the client opts in", async () => {
    isAnthropicChimmyEnabledMock.mockResolvedValueOnce(true)
    streamAgentPipelineMock.mockImplementationOnce(async (_message, _ctx, onText) => {
      onText("Hold ", "Hold ")
      onText("tight.", "Hold tight.")
      return {
        result: "Hold tight.",
        intent: "trade_evaluation",
        model: "claude-sonnet-4-6",
        tokensUsed: 88,
      }
    })

    const { POST } = await import("@/app/api/chimmy/route")
    const res = await POST(
      buildJsonRequest({
        message: "Should I make this trade?",
        stream: true,
        userContext: {
          sport: "NFL",
          leagueId: "league-1",
          source: "trade_analyzer",
        },
      }) as any
    )

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const body = await res.text()
    expect(body).toContain('event: chunk')
    expect(body).toContain('"response":"Hold tight."')
    expect(body).toContain('event: done')
    expect(body).toContain('"tokensUsed":88')
  })
})
