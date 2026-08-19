import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdminOrBearer: vi.fn(),
  buildTradeLearningDiagnostics: vi.fn(),
}))

vi.mock("@/lib/adminAuth", () => ({
  requireAdminOrBearer: mocks.requireAdminOrBearer,
}))

vi.mock("@/lib/trade-engine/diagnostics", () => ({
  buildTradeLearningDiagnostics: mocks.buildTradeLearningDiagnostics,
}))

describe("admin trade-learning diagnostics route", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("requires admin access and performs no diagnostics work when unauthenticated", async () => {
    mocks.requireAdminOrBearer.mockResolvedValueOnce({
      ok: false,
      res: Response.json({ error: "Unauthorized" }, { status: 401 }),
    })

    const { GET } = await import("@/app/api/admin/trade-learning/diagnostics/route")
    const res = await GET(new Request("http://localhost/api/admin/trade-learning/diagnostics"))

    expect(res.status).toBe(401)
    expect(mocks.buildTradeLearningDiagnostics).not.toHaveBeenCalled()
  })

  it("returns diagnostics for authenticated admins, leaving season resolution to buildTradeLearningDiagnostics()'s canonical resolver when no ?season= is given", async () => {
    mocks.requireAdminOrBearer.mockResolvedValueOnce({ ok: true, user: { role: "admin" } })
    mocks.buildTradeLearningDiagnostics.mockResolvedValueOnce({
      generatedAt: "2026-07-05T00:00:00.000Z",
      season: 2026,
      operational: { weeklyRecalibrationEnabled: false, envVar: "TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED" },
      calibratedB0: { current: -1.10, owner: "promoteShadowB0", lastCalibratedAt: null },
      shadow: {
        pending: false, shadowB0: null, computedAt: null, ageDays: null,
        maturityThresholdDays: 7, isMature: false, divergenceFromActive: null,
        maxAllowedDivergence: 0.4, withinDivergenceCap: null, sampleSize: null, minRequiredSample: 30,
      },
      promotion: { hasEverBeenPromoted: false, lastPromotedAt: null, lastPromotedB0: null },
      scheduler: {
        lastRecalibrationAt: null, daysSinceLastRecalibration: null, cadenceThresholdDays: 6.5,
        wouldRunIfInvokedNow: true, skipReasonIfAny: null,
      },
      segments: null,
      calibrationHealth: null,
      drift: null,
      recentHistory: [],
    })

    const { GET } = await import("@/app/api/admin/trade-learning/diagnostics/route")
    const res = await GET(new Request("http://localhost/api/admin/trade-learning/diagnostics"))
    const body = await res.json()

    expect(res.status).toBe(200)
    // No ?season= query param -> the route must pass `undefined` through, not
    // its own hardcoded default, so buildTradeLearningDiagnostics() resolves
    // the season via the one canonical resolver (lib/trade-engine/season-resolver.ts).
    expect(mocks.buildTradeLearningDiagnostics).toHaveBeenCalledWith(undefined)
    expect(body.ok).toBe(true)
    expect(body.operational.weeklyRecalibrationEnabled).toBe(false)
    expect(body.calibratedB0.current).toBe(-1.10)
  })

  it("passes through an explicit ?season= query parameter", async () => {
    mocks.requireAdminOrBearer.mockResolvedValueOnce({ ok: true, user: { role: "admin" } })
    mocks.buildTradeLearningDiagnostics.mockResolvedValueOnce({ season: 2026 })

    const { GET } = await import("@/app/api/admin/trade-learning/diagnostics/route")
    await GET(new Request("http://localhost/api/admin/trade-learning/diagnostics?season=2026"))

    expect(mocks.buildTradeLearningDiagnostics).toHaveBeenCalledWith(2026)
  })

  it("only exports a GET handler — no write operations are exposed", async () => {
    const routeModule = await import("@/app/api/admin/trade-learning/diagnostics/route")
    expect(routeModule.GET).toBeDefined()
    expect((routeModule as Record<string, unknown>).POST).toBeUndefined()
    expect((routeModule as Record<string, unknown>).PUT).toBeUndefined()
    expect((routeModule as Record<string, unknown>).DELETE).toBeUndefined()
    expect((routeModule as Record<string, unknown>).PATCH).toBeUndefined()
  })
})
