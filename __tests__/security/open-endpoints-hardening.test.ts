// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  requireAdmin: vi.fn(),
  requireAdminOrBearer: vi.fn(),
  consumeSharedRateLimit: vi.fn(),
  emailsSend: vi.fn(),
  submissionCreate: vi.fn(),
  earlyAccessFindUnique: vi.fn(),
  trackMetaServerEvent: vi.fn(),
  syncIdentityMap: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock("@/lib/telemetry/usage", () => ({ withApiUsage: () => (fn: unknown) => fn }))
vi.mock("next-auth", () => ({ getServerSession: h.getServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/adminAuth", () => ({ requireAdmin: h.requireAdmin, requireAdminOrBearer: h.requireAdminOrBearer }))
vi.mock("@/lib/security/sharedRateLimit", () => ({ consumeSharedRateLimit: h.consumeSharedRateLimit }))
vi.mock("@/lib/resend-client", () => ({
  getResendClient: async () => ({ client: { emails: { send: h.emailsSend } }, fromEmail: "noreply@allfantasy.test" }),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    leagueTypeSubmission: { create: h.submissionCreate },
    earlyAccessSignup: { findUnique: h.earlyAccessFindUnique },
  },
}))
vi.mock("@/lib/meta-capi", () => ({ trackMetaServerEvent: h.trackMetaServerEvent }))
vi.mock("@/lib/unified-player-service", () => ({ syncIdentityMap: h.syncIdentityMap }))
vi.mock("@/lib/api-sports", () => ({ syncAPISportsPlayersToIdentityMap: vi.fn(async () => ({ linked: 0, created: 0 })) }))
vi.mock("@/lib/ai-protection", () => ({ runAiProtection: vi.fn(async () => null) }))
vi.mock("@/lib/league-access", () => ({ assertLeagueMember: vi.fn() }))
vi.mock("@/lib/ai/output-logger", () => ({ logAiOutput: vi.fn() }))
vi.mock("@/lib/openclaw/config", () => ({
  getOpenClawConfig: () => ({ token: "oc-token", gatewayUrl: "https://gw.test" }),
  getOpenClawPublicMeta: () => ({}),
  buildOpenClawTargetUrl: (p: string) => `https://oc.test${p}`,
  getOpenClawGrowthConfig: () => ({ token: "oc-token", gatewayUrl: "https://gw.test" }),
  getOpenClawGrowthPublicMeta: () => ({}),
  buildOpenClawGrowthTargetUrl: (p: string) => `https://oc.test${p}`,
}))

const forbidden = () => ({ ok: false, res: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) })

function jsonReq(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

const SUBMISSION = {
  leagueTypeName: '<a href="https://evil.test">Claim your prize</a>\r\nBcc: x@y.z',
  tagline: "t",
  description: "d",
  sports: ["NFL"],
  recommendedSize: "12",
  seasonFormat: "s",
  draftType: "snake",
  winCondition: "w",
  hasSpecialScoring: false,
  specialMechanics: ["m"],
  weeklyFlow: "f",
  creditName: "<img src=x onerror=alert(1)>",
  email: "victim@example.com",
  permissionConsent: true,
  rightsConsent: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.consumeSharedRateLimit.mockResolvedValue({ success: true, count: 1 })
  h.submissionCreate.mockResolvedValue({ id: "sub-1" })
  h.emailsSend.mockResolvedValue({})
  h.trackMetaServerEvent.mockResolvedValue({ capi: { success: true, meta: {} } })
  vi.stubGlobal("fetch", h.fetch)
})

describe("/api/submit-league", () => {
  it("escapes caller HTML and strips line breaks from the subject", async () => {
    const { POST } = await import("@/app/api/submit-league/route")
    const res = await POST(jsonReq("https://allfantasy.test/api/submit-league", SUBMISSION))
    expect(res.status).toBeLessThan(400)
    const confirmation = h.emailsSend.mock.calls.find((c) => c[0].to === "victim@example.com")![0]
    expect(confirmation.html).not.toContain("<a href")
    expect(confirmation.html).not.toContain("<img")
    expect(confirmation.html).toContain("&lt;img src=x onerror=alert(1)&gt;")
    expect(confirmation.subject).not.toMatch(/[\r\n]/)
  })

  it("refuses once the per-recipient cap is spent, without sending", async () => {
    h.consumeSharedRateLimit.mockImplementation(async (key: string) => ({
      success: !key.startsWith("submit-league:to:"),
      count: 4,
    }))
    const { POST } = await import("@/app/api/submit-league/route")
    const res = await POST(jsonReq("https://allfantasy.test/api/submit-league", SUBMISSION))
    expect(res.status).toBe(429)
    expect(h.emailsSend).not.toHaveBeenCalled()
  })
})

describe("/api/meta/complete-registration", () => {
  it("reports nothing for an email with no fresh early-access signup", async () => {
    h.earlyAccessFindUnique.mockResolvedValue(null)
    const { POST } = await import("@/app/api/meta/complete-registration/route")
    const res = await POST(jsonReq("https://allfantasy.test/x", { event_id: "e1", email: "fake@example.com" }))
    expect(res.status).toBe(200)
    expect(h.trackMetaServerEvent).not.toHaveBeenCalled()
  })

  it("reports a fresh signup, never with caller custom_data", async () => {
    h.earlyAccessFindUnique.mockResolvedValue({ createdAt: new Date() })
    const { POST } = await import("@/app/api/meta/complete-registration/route")
    await POST(
      jsonReq("https://allfantasy.test/x", { event_id: "e1", email: "Real@Example.com", custom_data: { value: 9999 } }),
    )
    expect(h.trackMetaServerEvent).toHaveBeenCalledTimes(1)
    const arg = h.trackMetaServerEvent.mock.calls[0][0]
    expect(arg.email).toBe("real@example.com")
    expect(arg.customData).not.toHaveProperty("value")
  })

  it("does not report a signup older than the freshness window", async () => {
    h.earlyAccessFindUnique.mockResolvedValue({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
    const { POST } = await import("@/app/api/meta/complete-registration/route")
    await POST(jsonReq("https://allfantasy.test/x", { event_id: "e1", email: "old@example.com" }))
    expect(h.trackMetaServerEvent).not.toHaveBeenCalled()
  })
})

describe("/api/legacy/identity-sync", () => {
  it("refuses an anonymous caller even when ADMIN_PASSWORD is unset", async () => {
    const saved = process.env.ADMIN_PASSWORD
    delete process.env.ADMIN_PASSWORD
    h.requireAdminOrBearer.mockResolvedValue(forbidden())
    try {
      const { POST } = await import("@/server/api-route-modules/legacy/identity-sync/route")
      const res = await POST(jsonReq("https://allfantasy.test/api/legacy/identity-sync", {}))
      expect(res.status).toBe(403)
      expect(h.syncIdentityMap).not.toHaveBeenCalled()
    } finally {
      if (saved !== undefined) process.env.ADMIN_PASSWORD = saved
    }
  })
})

describe("/api/ai/openclaw/*", () => {
  for (const path of ["dev-assistant", "growth-marketing-assistant"]) {
    it(`${path}: a signed-in non-admin cannot spend the operator token`, async () => {
      h.getServerSession.mockResolvedValue({ user: { id: "regular-user" } })
      h.requireAdmin.mockResolvedValue(forbidden())
      const mod = await import(`@/app/api/ai/openclaw/${path}/route`)
      const res = await mod.POST(jsonReq(`https://allfantasy.test/api/ai/openclaw/${path}`, { message: "hi" }))
      expect(res.status).toBe(403)
      expect(h.fetch).not.toHaveBeenCalled()
      const meta = await mod.GET()
      expect(meta.status).toBe(403)
    })
  }
})
