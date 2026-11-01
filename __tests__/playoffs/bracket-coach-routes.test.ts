import { beforeEach, describe, expect, it, vi } from "vitest"
const m = vi.hoisted(() => ({ auth: vi.fn(), coach: vi.fn(), evidence: vi.fn(), gate: vi.fn(), run: vi.fn(), limit: vi.fn(), refund: vi.fn(), adapt: vi.fn() }))
vi.mock("@/app/api/brackets/playoffs/_utils", () => ({ requireWorldCupApiUser: m.auth }))
vi.mock("@/lib/playoffs/bracketCoachService", () => ({ loadBracketCoach: m.coach, loadMatchupEvidence: m.evidence, CoachAccessError: class extends Error { status = 403 } }))
vi.mock("@/lib/subscription/entitlement-middleware", () => ({ requireFeatureEntitlement: m.gate }))
vi.mock("@/lib/security/sharedRateLimit", () => ({ consumeSharedRateLimit: m.limit }))
vi.mock("@/lib/tokens/paidToolBilling", () => ({ withPaidToolBilling: (fn: unknown) => fn, paidToolNotDelivered: m.refund }))
vi.mock("@/lib/ai-orchestration", () => ({ runUnifiedOrchestration: m.run }))
vi.mock("@/lib/ai-tool-registry", () => ({ requestContractToUnified: m.adapt }))
import { GET } from "@/app/api/brackets/playoffs/[challengeId]/coach/route"
import { POST } from "@/app/api/brackets/playoffs/[challengeId]/coach/matchup/route"
const context = { params: Promise.resolve({ challengeId: "cup" }) }
const req = (body: unknown) => new Request("https://example.test/api/brackets/playoffs/cup/coach/matchup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
beforeEach(() => {
  vi.clearAllMocks(); m.auth.mockResolvedValue({ ok: true, user: { id: "me" } }); m.coach.mockResolvedValue({ tonight: [] })
  m.evidence.mockResolvedValue({ view: { challenge: { sport: "nba_cup", seasonYear: 2026 } }, evidence: { recommendation: "Boston Celtics", risks: ["limited coverage"] } })
  m.gate.mockResolvedValue({ ok: true }); m.limit.mockResolvedValue({ success: true }); m.adapt.mockReturnValue({ envelope: {} })
  m.run.mockResolvedValue({ ok: true, response: { primaryAnswer: "Boston is the limited lean based on supplied facts.", reliability: { usedDeterministicFallback: false } } })
})
describe("coach route privacy and AI access", () => {
  it("requires authentication for every coach read and AI request", async () => {
    m.auth.mockResolvedValue({ ok: false, response: new Response("Unauthorized", { status: 401 }) })
    expect((await GET(new Request("https://example.test/coach"), context)).status).toBe(401)
    expect((await POST(req({ seriesId: "g", generate: true }), context)).status).toBe(401)
    expect(m.coach).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled()
  })
  it("marks personalized reads private and no-store and passes only authenticated identity", async () => {
    const response = await GET(new Request("https://example.test/coach?entryId=mine&rivalId=rival&userId=other"), context)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(response.headers.get("Vary")).toContain("Cookie")
    expect(m.coach).toHaveBeenCalledWith(expect.objectContaining({ user: { id: "me" }, entryId: "mine", rivalId: "rival" }))
  })
  it("shows facts without invoking or charging AI, and respects the paid gate for explicit analysis", async () => {
    expect((await POST(req({ seriesId: "g" }), context)).status).toBe(200)
    expect(m.run).not.toHaveBeenCalled(); expect(m.gate).not.toHaveBeenCalled()
    m.gate.mockResolvedValue({ ok: false, response: new Response("Confirm tokens", { status: 409 }) })
    expect((await POST(req({ seriesId: "g", generate: true }), context)).status).toBe(409)
    expect(m.run).not.toHaveBeenCalled()
    expect(m.gate).toHaveBeenCalledWith(expect.objectContaining({ featureId: "league_ai_coaching", confirmTokenSpend: false, allowTokenFallback: true }))
  })
  it("grounds a real Chimmy call on server facts, ignoring supplied fake injuries or picks", async () => {
    const response = await POST(req({ seriesId: "g", generate: true, deterministicContext: { injuries: "FAKE", privatePicks: "SECRET" } }), context)
    expect((await response.json()).generative).toBe(true)
    const passed = m.adapt.mock.calls[0][0]
    expect(passed.tool).toBe("chimmy_chat")
    expect(JSON.stringify(passed)).not.toContain("FAKE"); expect(JSON.stringify(passed)).not.toContain("SECRET")
    expect(m.run).toHaveBeenCalledOnce()
  })
  it("does not label fallback output generative and signals that paid AI was not delivered", async () => {
    m.run.mockResolvedValue({ ok: true, response: { primaryAnswer: "Fallback", reliability: { usedDeterministicFallback: true } } })
    const data = await (await POST(req({ seriesId: "g", generate: true }), context)).json()
    expect(data).toMatchObject({ generative: false, analysis: null }); expect(m.refund).toHaveBeenCalledOnce()
  })
  it("blocks explicit analysis at its daily limit without calling a provider", async () => {
    m.limit.mockResolvedValue({ success: false })
    expect((await POST(req({ seriesId: "g", generate: true }), context)).status).toBe(429)
    expect(m.run).not.toHaveBeenCalled(); expect(m.gate).not.toHaveBeenCalled()
  })
})
