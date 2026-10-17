// @vitest-environment node
/**
 * High-severity findings from the 2026-09-30 security sweep, one block each.
 * Every case asserts the ATTACK is refused, not merely that the happy path works.
 * Phone numbers and IPs are RFC 5737 / 555 documentation values; this repo is public.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const m = vi.hoisted(() => ({
  bracketFindMany: vi.fn(),
  bracketFindUnique: vi.fn(),
  lockTournamentBrackets: vi.fn(),
  userProfileFindUnique: vi.fn(),
  resetDeleteMany: vi.fn(),
  resetCreate: vi.fn(),
  emailPrefFindFirst: vi.fn(),
  requireLegacySleeperIdentity: vi.fn(),
  verificationsCreate: vi.fn(),
  messagesCreate: vi.fn(),
  logPasswordResetAudit: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bracketTournament: { findMany: m.bracketFindMany, findUnique: m.bracketFindUnique },
    userProfile: { findUnique: m.userProfileFindUnique },
    passwordResetToken: { deleteMany: m.resetDeleteMany, create: m.resetCreate },
    emailPreference: { findFirst: m.emailPrefFindFirst },
  },
}))
vi.mock("@/lib/brackets/lock", () => ({ lockTournamentBrackets: m.lockTournamentBrackets }))
vi.mock("@/lib/legacy/requireLegacySleeperIdentity", () => ({
  requireLegacySleeperIdentity: m.requireLegacySleeperIdentity,
}))
vi.mock("@/lib/telemetry/usage", () => ({ withApiUsage: () => (handler: unknown) => handler }))
vi.mock("@/lib/twilio-client", () => ({
  getTwilioClient: async () => ({
    verify: { v2: { services: () => ({ verifications: { create: m.verificationsCreate } }) } },
    messages: { create: m.messagesCreate },
  }),
}))
vi.mock("@/lib/auth/password-reset-audit", () => ({ logPasswordResetAudit: m.logPasswordResetAudit }))

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(url), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = "test-cron-secret-not-a-real-credential-0001"
  delete process.env.ADMIN_PASSWORD
  delete process.env.BRACKET_ADMIN_SECRET
  delete process.env.IMPORT_WORKER_SECRET
  m.bracketFindMany.mockResolvedValue([])
  m.verificationsCreate.mockResolvedValue({})
  m.messagesCreate.mockResolvedValue({})
})

describe("bracket worker routes require the worker secret", () => {
  it("refuses an anonymous early lock of every entry in a tournament", async () => {
    const { POST } = await import("@/app/api/bracket/workers/lock/route")
    const res = await POST(post("https://www.allfantasy.ai/api/bracket/workers/lock", { tournamentId: "t-1" }))
    expect(res.status).toBe(401)
    expect(m.bracketFindUnique).not.toHaveBeenCalled()
    expect(m.lockTournamentBrackets).not.toHaveBeenCalled()
  })

  it("still runs for a caller holding CRON_SECRET", async () => {
    const { POST } = await import("@/app/api/bracket/workers/lock/route")
    const res = await POST(
      post("https://www.allfantasy.ai/api/bracket/workers/lock", {}, { "x-cron-secret": process.env.CRON_SECRET! }),
    )
    expect(res.status).toBe(200)
    expect(m.bracketFindMany).toHaveBeenCalled()
  })

  it("gates every worker route and the feed ingest", async () => {
    const routes = [
      "auto-import", "health", "leaderboard", "live-ingest", "lock", "popularity", "simulate-league",
    ].map((w) => `@/app/api/bracket/workers/${w}/route`)
    routes.push("@/app/api/feed/ingest/route")
    for (const path of routes) {
      const { POST } = await import(/* @vite-ignore */ path)
      const res = await POST(post("https://www.allfantasy.ai/x", {}))
      expect({ path, status: res.status }).toEqual({ path, status: 401 })
    }
  })
})

describe("OpenClaw upstreamPath is pinned to the configured gateway", () => {
  it.each([
    ["//evil.example/steal", "protocol-relative"],
    ["/\\evil.example/steal", "backslash host"],
    ["//169.254.169.254/latest/meta-data", "metadata address"],
  ])("refuses %s (%s)", async (path) => {
    process.env.OPENCLAW_TOKEN = "test-openclaw-token-not-real"
    const { buildOpenClawTargetUrl, buildOpenClawGrowthTargetUrl } = await import("@/lib/openclaw/config")
    expect(() => buildOpenClawTargetUrl(path)).toThrow(/configured gateway|not allowed/)
    process.env.OPENCLAW_GROWTH_TOKEN = "test-openclaw-growth-token-not-real"
    expect(() => buildOpenClawGrowthTargetUrl(path)).toThrow(/configured gateway|not allowed/)
  })

  it("still resolves an ordinary path on the gateway", async () => {
    process.env.OPENCLAW_TOKEN = "test-openclaw-token-not-real"
    const { buildOpenClawTargetUrl } = await import("@/lib/openclaw/config")
    expect(new URL(buildOpenClawTargetUrl("/api/chat")).origin).toBe("https://webui.clawship.ai")
  })
})

describe("Stripe client_reference_id SKU must match what was bought", () => {
  const env = { STRIPE_PRICE_AF_SUPREME_YEARLY: "price_supreme_y" } as unknown as NodeJS.ProcessEnv
  const stripeBuying = (priceId: string) =>
    ({ checkout: { sessions: { listLineItems: vi.fn(async () => ({ data: [{ price: { id: priceId } }] })) } } }) as any

  it("refuses the cheapest purchase claiming Supreme", async () => {
    const { verifyClientReferenceSkuPurchase } = await import("@/lib/monetization/clientReferencePurchaseGuard")
    const verdict = await verifyClientReferenceSkuPurchase(stripeBuying("price_tokens_5"), { id: "cs_1" }, "af_supreme_yearly", env)
    expect(verdict.ok).toBe(false)
  })

  it("refuses a SKU with no configured price rather than trusting the claim", async () => {
    const { verifyClientReferenceSkuPurchase } = await import("@/lib/monetization/clientReferencePurchaseGuard")
    const verdict = await verifyClientReferenceSkuPurchase(stripeBuying("price_x"), { id: "cs_2" }, "af_supreme_yearly", {} as any)
    expect(verdict.ok).toBe(false)
  })

  it("accepts a session that bought the claimed SKU's price", async () => {
    const { verifyClientReferenceSkuPurchase } = await import("@/lib/monetization/clientReferencePurchaseGuard")
    const verdict = await verifyClientReferenceSkuPurchase(stripeBuying("price_supreme_y"), { id: "cs_3" }, "af_supreme_yearly", env)
    expect(verdict).toEqual({ ok: true })
  })
})

describe("legacy email-preferences no longer maps a handle to an email", () => {
  it("never returns the email, even for the caller's own handle", async () => {
    m.requireLegacySleeperIdentity.mockResolvedValue({
      ok: true,
      identity: { sleeperUsername: "somemanager", actorId: "a-1", source: "guest" },
    })
    m.emailPrefFindFirst.mockResolvedValue({
      email: "private@example.com", tradeAlerts: true, weeklyDigest: false, productUpdates: true,
    })
    const { GET } = await import("@/server/api-route-modules/legacy/email-preferences/route")
    const res = await GET(new NextRequest("https://www.allfantasy.ai/api/legacy/email-preferences?sleeper_username=somemanager"))
    const body = await res.json()
    expect(body.found).toBe(true)
    expect(JSON.stringify(body)).not.toContain("private@example.com")
    expect(m.emailPrefFindFirst.mock.calls[0][0].where.sleeperUsername.equals).toBe("somemanager")
  })

  it("refuses an anonymous caller before touching the table", async () => {
    m.requireLegacySleeperIdentity.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "UNAUTHENTICATED" }, { status: 401 }),
    })
    const { GET, POST } = await import("@/server/api-route-modules/legacy/email-preferences/route")
    const get = await GET(new NextRequest("https://www.allfantasy.ai/api/legacy/email-preferences?sleeper_username=victim"))
    const postRes = await POST(post("https://www.allfantasy.ai/api/legacy/email-preferences", { email: "victim@example.com" }))
    expect(get.status).toBe(401)
    expect(postRes.status).toBe(401)
    expect(m.emailPrefFindFirst).not.toHaveBeenCalled()
  })
})

describe("SMS cost and reset hardening", () => {
  it("sends no reset code to an UNVERIFIED phone", async () => {
    m.userProfileFindUnique.mockResolvedValue({ userId: "u-1", phoneVerifiedAt: null })
    const { POST } = await import("@/app/api/auth/password/reset/request/route")
    const res = await POST(
      post("https://www.allfantasy.ai/api/auth/password/reset/request", { type: "sms", phone: "+15555550123" }, {
        "cf-connecting-ip": "198.51.100.71",
      }),
    )
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(m.messagesCreate).not.toHaveBeenCalled()
    expect(m.resetCreate).not.toHaveBeenCalled()
    expect(m.logPasswordResetAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "sms_phone_unverified" }))
  })

  it("caps signup codes per IP even when every number is different", async () => {
    process.env.TWILIO_VERIFY_SERVICE_SID = "VA-test-not-real"
    const { POST } = await import("@/app/api/auth/phone/signup/start/route")
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) {
      const res = await POST(
        post("https://www.allfantasy.ai/api/auth/phone/signup/start", { phone: `+1555555${String(1000 + i)}` }, {
          "cf-connecting-ip": "198.51.100.72",
        }),
      )
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
    expect(statuses.slice(10)).toEqual([429, 429])
    expect(m.verificationsCreate).toHaveBeenCalledTimes(10)
  })
})
