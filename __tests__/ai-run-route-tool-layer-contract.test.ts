import { beforeEach, describe, expect, it, vi } from "vitest"

// A plan holder: these tests are about what the paid route does once the plan gate lets the caller in.
vi.mock('@/lib/subscription/entitlement-middleware', () => ({
  requireFeatureEntitlement: async () => ({ ok: true, decision: {}, tokenSpend: null, tokenPreview: null }),
}))

const getServerSessionMock = vi.fn()
const runUnifiedOrchestrationMock = vi.fn()

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

vi.mock("@/lib/ai-orchestration", () => ({
  runUnifiedOrchestration: runUnifiedOrchestrationMock,
}))

describe("POST /api/ai/run tool layer contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when user is unauthenticated", async () => {
    getServerSessionMock.mockResolvedValue(null)
    const { POST } = await import("@/app/api/ai/run/route")
    const res = await POST(
      new Request("http://localhost/api/ai/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: "trade_analyzer", sport: "NFL" }),
      })
    )
    expect(res.status).toBe(401)
  })

  it("adds structured tool output sections and fact-guard warnings", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } })
    runUnifiedOrchestrationMock.mockResolvedValue({
      ok: true,
      response: {
        primaryAnswer:
          "Based on deterministic context, this trade is slightly favorable and improves weekly floor.",
        evidence: ["Fairness score 54", "Acceptance probability 61%"],
        actionPlan: "Proceed if your roster can absorb short-term variance.",
        confidenceScore: 72,
        uncertaintyExplanation: "Injury volatility can shift the edge.",
        modelOutputs: [
          {
            model: "openai",
            raw: "Slight accept, but monitor volatility.",
            structured: {
              verdict: "Slight accept",
              keyEvidence: ["Fairness score 54", "Acceptance probability 61%"],
              confidenceScore: 72,
              risksCaveats: ["Injury volatility"],
              suggestedNextAction: "Counter only if you need a floor boost.",
              alternatePath: "Hold and reassess after waivers.",
            },
          },
        ],
        reliability: {
          usedDeterministicFallback: false,
          providerStatus: [{ provider: "openai", status: "ok", latencyMs: 240 }],
        },
        factGuardWarnings: ["Context limited: bench depth unavailable."],
        mode: "consensus",
      },
    })

    const { POST } = await import("@/app/api/ai/run/route")
    const res = await POST(
      new Request("http://localhost/api/ai/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tool: "trade_analyzer",
          sport: "NFL",
          deterministicContext: {
            fairnessScore: 54,
            valueDelta: 110,
            sideATotalValue: 8400,
            sideBTotalValue: 8290,
          },
          leagueSettings: {
            scoring: "ppr",
            format: "dynasty",
          },
          userMessage: "Explain this offer.",
        }),
      })
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.verdict).toBe("Slight accept")
    expect(json.suggestedNextAction).toContain("Counter")
    expect(json.alternatePath).toContain("Hold and reassess")
    expect(Array.isArray(json.sections)).toBe(true)
    expect(json.sections[0]).toMatchObject({
      id: "verdict",
      title: "Verdict / Recommendation",
    })
    expect(json.outputShape).toMatchObject({
      verdict: "Slight accept",
      suggestedNextAction: "Counter only if you need a floor boost.",
    })
    expect(json.factGuardWarnings).toEqual(
      expect.arrayContaining(["Context limited: bench depth unavailable."])
    )
  })
})
