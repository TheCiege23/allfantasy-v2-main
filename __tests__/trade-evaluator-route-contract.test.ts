import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const requireFeatureEntitlementMock = vi.fn()
const isToolTradeAnalyzerEnabledMock = vi.fn()
const checkAiRateLimitMock = vi.fn()
const getAiActionConfigMock = vi.fn()
const getCachedResponseMock = vi.fn()
const setCachedResponseMock = vi.fn()
const buildCacheKeyMock = vi.fn()

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

vi.mock("@/lib/feature-toggle", () => ({
  isToolTradeAnalyzerEnabled: isToolTradeAnalyzerEnabledMock,
}))

vi.mock("@/lib/league-access", () => ({
  assertLeagueMember: assertLeagueMemberMock,
}))

vi.mock("@/lib/subscription/entitlement-middleware", () => ({
  requireFeatureEntitlement: requireFeatureEntitlementMock,
}))

vi.mock("@/lib/telemetry/usage", () => ({
  withApiUsage: () => (handler: (req: Request) => Promise<Response>) => handler,
}))

vi.mock("@/lib/ai-protection", () => ({
  checkAiRateLimit: checkAiRateLimitMock,
  getAiActionConfig: getAiActionConfigMock,
  getCachedResponse: getCachedResponseMock,
  setCachedResponse: setCachedResponseMock,
  buildCacheKey: buildCacheKeyMock,
  consumeRateLimit: vi.fn(),
}))

function buildValidTradeEvaluatorBody(overrides?: Record<string, unknown>) {
  return {
    trade_id: "trade-1",
    sender: {
      manager_name: "Team A",
      gives_players: ["Player A"],
      gives_picks: [],
      gives_faab: 0,
    },
    receiver: {
      manager_name: "Team B",
      gives_players: ["Player B"],
      gives_picks: [],
      gives_faab: 0,
    },
    league: {
      format: "dynasty",
      sport: "NFL",
      scoring_summary: "PPR",
      qb_format: "sf",
    },
    ...overrides,
  }
}

describe("POST /api/trade-evaluator contract", () => {
  /*
   * 🛑 WARM THE ROUTE MODULE OUTSIDE ANY TEST'S CLOCK.
   *
   * Every test here does `await import("@/app/api/trade-evaluator/route")`. Within a worker that
   * import is cached, so only the FIRST one pays for the module graph — but it pays inside a
   * test, so the cost lands on whichever test happens to run first. This suite passes alone and
   * fails in a batch: measured twice on a contended box, `returns 401 when unauthenticated` and
   * `returns 403 when user is not a member of league` — the first two tests — died with
   * `Test timed out in 30000ms`. Not an assertion failure, and nothing to do with the route's
   * behaviour; the module simply had not finished loading.
   *
   * Importing once here is semantically identical (same cached instance either way) and moves
   * the cost off the tests. The explicit hook timeout is generous on purpose: this box routinely
   * runs several `tsc` and vitest processes at once, and a red suite caused by contention is the
   * false-negative this repo keeps paying for.
   */
  beforeAll(async () => {
    await import("@/app/api/trade-evaluator/route")
  }, 180_000)

  beforeEach(() => {
    vi.clearAllMocks()
    isToolTradeAnalyzerEnabledMock.mockResolvedValue(true)
    getAiActionConfigMock.mockReturnValue({
      maxRequests: 50,
      windowMs: 60_000,
      cacheTtlMs: 0,
    })
    checkAiRateLimitMock.mockReturnValue({
      allowed: true,
      retryAfterSec: 0,
      remaining: 49,
    })
    getCachedResponseMock.mockReturnValue(null)
    buildCacheKeyMock.mockReturnValue("trade-evaluator-cache-key")
    setCachedResponseMock.mockImplementation(() => {})
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } })
    requireFeatureEntitlementMock.mockResolvedValue({
      ok: true,
      decision: {},
      tokenSpend: null,
      tokenPreview: null,
    })
  })

  it("returns 401 when unauthenticated", async () => {
    getServerSessionMock.mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/trade-evaluator/route")
    const req = createMockNextRequest("http://localhost/api/trade-evaluator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildValidTradeEvaluatorBody()),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" })
  })

  it("returns 403 when user is not a member of league", async () => {
    assertLeagueMemberMock.mockRejectedValueOnce(new Error("Forbidden"))
    const { POST } = await import("@/app/api/trade-evaluator/route")
    const req = createMockNextRequest("http://localhost/api/trade-evaluator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        buildValidTradeEvaluatorBody({
          league_id: "league-1",
        })
      ),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" })
    expect(requireFeatureEntitlementMock).not.toHaveBeenCalled()
  })

  it("returns 409 when token confirmation is required", async () => {
    requireFeatureEntitlementMock.mockResolvedValueOnce({
      ok: false,
      response: new Response(
        JSON.stringify({
          code: "token_confirmation_required",
          message: "Use 50 tokens to unlock this request once.",
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }
      ),
    })

    const { POST } = await import("@/app/api/trade-evaluator/route")
    const req = createMockNextRequest("http://localhost/api/trade-evaluator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildValidTradeEvaluatorBody()),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      code: "token_confirmation_required",
    })
  })

  it("returns 402 when token balance is insufficient", async () => {
    requireFeatureEntitlementMock.mockResolvedValueOnce({
      ok: false,
      response: new Response(
        JSON.stringify({
          code: "insufficient_token_balance",
          message: "Need 50 tokens for this one-time unlock.",
        }),
        {
          status: 402,
          headers: { "Content-Type": "application/json" },
        }
      ),
    })

    const { POST } = await import("@/app/api/trade-evaluator/route")
    const req = createMockNextRequest("http://localhost/api/trade-evaluator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildValidTradeEvaluatorBody()),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(402)
    await expect(res.json()).resolves.toMatchObject({
      code: "insufficient_token_balance",
    })
  })

  it("returns 200 with cached payload and tokenSpend metadata on gated success", async () => {
    getAiActionConfigMock.mockReturnValueOnce({
      maxRequests: 50,
      windowMs: 60_000,
      cacheTtlMs: 60_000,
    })
    getCachedResponseMock.mockReturnValueOnce({
      success: true,
      evaluation: { verdict: { overall: "FAIR" } },
      schemaValid: true,
    })
    requireFeatureEntitlementMock.mockResolvedValueOnce({
      ok: true,
      decision: {},
      tokenSpend: {
        id: "ledger-123",
        balanceAfter: 14,
      },
      tokenPreview: {
        ruleCode: "ai_trade_analyzer_full_review",
        tokenCost: 50,
      },
    })

    const { POST } = await import("@/app/api/trade-evaluator/route")
    const req = createMockNextRequest("http://localhost/api/trade-evaluator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        buildValidTradeEvaluatorBody({
          confirmTokenSpend: true,
        })
      ),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.schemaValid).toBe(true)
    expect(body.evaluation?.verdict?.overall).toBe("FAIR")
    expect(body.tokenSpend).toMatchObject({
      ruleCode: "ai_trade_analyzer_full_review",
      tokenCost: 50,
      balanceAfter: 14,
      ledgerId: "ledger-123",
    })
    expect(requireFeatureEntitlementMock).toHaveBeenCalledWith(
      expect.objectContaining({
        featureId: "trade_analyzer",
        allowTokenFallback: true,
        confirmTokenSpend: true,
        tokenRuleCode: "ai_trade_analyzer_full_review",
      })
    )
  })

  /**
   * 🛑 An unreadable pick label used to be priced as a 2025 FIRST-ROUND PICK.
   *
   * `resolvePickData` answered `parsePickLabel`'s null with `year: 2025, round: 1`, so a typo
   * or an empty field produced a confident grade, lopsided in favour of whoever sent it, with
   * nothing in the response admitting the label had not been understood.
   */
  describe("unreadable draft picks", () => {
    it.each([
      ["Kittens", "not a pick at all"],
      ["", "empty string"],
      ["first rounder", "no year"],
      ["2026 0th", "round zero, which pickRoundShare clamps up to a FIRST"],
    ])("refuses %s (%s) instead of grading it as a first-round pick", async (label) => {
      const { POST } = await import("@/app/api/trade-evaluator/route")
      const req = createMockNextRequest("http://localhost/api/trade-evaluator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildValidTradeEvaluatorBody({
            sender: {
              manager_name: "Team A",
              gives_players: ["Player A"],
              gives_picks: [label],
              gives_faab: 0,
            },
          })
        ),
      })

      const res = await POST(req as any)
      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.error).toBe("UNREADABLE_PICK")
      // Naming it is the point — the manager cannot fix a typo we will not show him.
      expect(body.unreadablePicks).toEqual([label.trim() || "(empty)"])
    })

    it("costs the user nothing — it refuses ahead of the rate limiter and the token gate", async () => {
      const { POST } = await import("@/app/api/trade-evaluator/route")
      const req = createMockNextRequest("http://localhost/api/trade-evaluator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildValidTradeEvaluatorBody({
            receiver: {
              manager_name: "Team B",
              gives_players: ["Player B"],
              gives_picks: ["not a pick"],
              gives_faab: 0,
            },
          })
        ),
      })

      const res = await POST(req as any)
      expect(res.status).toBe(422)
      /*
       * The existing refusals below this one (UNPRICED_ASSETS, AMBIGUOUS_PLAYER, DEVY_SCALE)
       * all return AFTER the gate has spent tokens, and only the catch block refunds. This
       * assertion is what keeps the pick refusal from inheriting that.
       */
      expect(requireFeatureEntitlementMock).not.toHaveBeenCalled()
      expect(checkAiRateLimitMock).not.toHaveBeenCalled()
    })

    it("rejects an out-of-range structured pick at the schema, before any pricing", async () => {
      const { POST } = await import("@/app/api/trade-evaluator/route")
      const req = createMockNextRequest("http://localhost/api/trade-evaluator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildValidTradeEvaluatorBody({
            sender: {
              manager_name: "Team A",
              gives_players: ["Player A"],
              // round 0 validated as a bare z.number() and priced as a first.
              gives_picks: [{ year: 2026, round: 0 }],
              gives_faab: 0,
            },
          })
        ),
      })

      const res = await POST(req as any)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe("Invalid request format")
      expect(requireFeatureEntitlementMock).not.toHaveBeenCalled()
    })

    it("still grades a trade whose picks ARE readable", async () => {
      const { POST } = await import("@/app/api/trade-evaluator/route")
      const req = createMockNextRequest("http://localhost/api/trade-evaluator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildValidTradeEvaluatorBody({
            sender: {
              manager_name: "Team A",
              gives_players: ["Player A"],
              // Includes the two forms that used to be refused and priced as firsts.
              gives_picks: ["2027 Early 1st", "2027 6th", "2026 Round 3"],
              gives_faab: 0,
            },
          })
        ),
      })

      const res = await POST(req as any)
      expect(res.status).not.toBe(422)
      expect(requireFeatureEntitlementMock).toHaveBeenCalled()
    })
  })

  /**
   * 🛑 `qb_format` defaulted to 'sf' IN THE SCHEMA, so omitting it priced every quarterback on
   * a superflex board — the scarcer, more expensive one — and nothing said so.
   */
  describe("superflex resolution", () => {
    /*
     * ⚠ ONLY THE SCHEMA CASE IS TESTED AT THE ROUTE, DELIBERATELY. This suite cannot reach a
     * graded 200 — the one that exists comes from a MOCKED CACHE HIT, and a real run dies in
     * `pricePlayer` with no database. The resolution rule itself is unit-tested against
     * `resolveSuperflex` in __tests__/trade-value/superflexResolution.test.ts, where it can
     * actually fail for the right reasons.
     */
    it("rejects a qb_format that is neither '1qb' nor 'sf' rather than defaulting", async () => {
      const { POST } = await import("@/app/api/trade-evaluator/route")
      const req = createMockNextRequest("http://localhost/api/trade-evaluator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildValidTradeEvaluatorBody({
            league: { format: "dynasty", sport: "NFL", qb_format: "2qb" },
          })
        ),
      })
      const res = await POST(req as any)
      expect(res.status).toBe(400)
      expect(requireFeatureEntitlementMock).not.toHaveBeenCalled()
    })
  })
})
