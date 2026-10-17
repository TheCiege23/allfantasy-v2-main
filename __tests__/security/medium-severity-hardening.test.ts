// @vitest-environment node
/**
 * Medium-severity findings from the 2026-09-30 security sweep. Each case asserts
 * the ATTACK is refused. Addresses are RFC 5737 documentation values.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  assertLeagueMember: vi.fn(),
  isCommissioner: vi.fn(),
  assertCommissioner: vi.fn(),
  canAccessLeague: vi.fn(),
  survivorFindMany: vi.fn(),
  draftSessionFindFirst: vi.fn(),
  draftQueueFindMany: vi.fn(),
  rosterFindFirst: vi.fn(),
  leagueFindUnique: vi.fn(),
  leagueUpdate: vi.fn(),
  getLeaguePrivacySettings: vi.fn(),
  emailsSend: vi.fn(),
  runReminders: vi.fn(),
}))

vi.mock("next-auth", () => ({ getServerSession: m.getServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/league/league-access", () => ({ assertLeagueMember: m.assertLeagueMember }))
vi.mock("@/lib/commissioner/permissions", () => ({
  isCommissioner: m.isCommissioner,
  assertCommissioner: m.assertCommissioner,
}))
vi.mock("@/lib/draft/access", () => ({ canAccessLeague: m.canAccessLeague }))
vi.mock("@/lib/league-privacy", () => ({ getLeaguePrivacySettings: m.getLeaguePrivacySettings }))
vi.mock("@/lib/resend-client", () => ({
  getResendClient: () => ({ client: { emails: { send: m.emailsSend } }, fromEmail: "AllFantasy <no-reply@example.com>" }),
}))
vi.mock("@/lib/world-cup/worldCupLockReminderCron", () => ({ runWorldCupBracketLockReminders: m.runReminders }))
vi.mock("@/lib/telemetry/usage", () => ({ withApiUsage: () => (handler: unknown) => handler }))
// The insight route's model stack is heavy to import cold; only its auth gate is under test.
vi.mock("@/lib/ai-orchestration", () => ({ runUnifiedOrchestration: vi.fn() }))
vi.mock("@/lib/ai-tool-layer", () => ({ buildEnvelopeForTool: vi.fn(), formatToolResult: vi.fn(), validateToolOutput: vi.fn() }))
vi.mock("@/lib/simulation-engine/MatchupSimulator", () => ({ runMatchupSimulation: vi.fn() }))
vi.mock("@/lib/simulation-engine/MatchupSimulationInsightAI", () => ({ getMatchupSimulationInsight: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    survivorNotification: { findMany: m.survivorFindMany },
    draftSession: { findFirst: m.draftSessionFindFirst },
    draftQueueEntry: { findMany: m.draftQueueFindMany },
    roster: { findFirst: m.rosterFindFirst },
    league: { findUnique: m.leagueFindUnique, update: m.leagueUpdate },
  },
}))

const ME = "user-me"
const RIVAL = "user-rival"
const signedIn = () => m.getServerSession.mockResolvedValue({ user: { id: ME } })
const get = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(url), { headers: { "cf-connecting-ip": "198.51.100.90", ...headers } })

beforeEach(async () => {
  vi.clearAllMocks()
  m.getServerSession.mockResolvedValue(null)
  m.assertLeagueMember.mockResolvedValue({ ok: true, league: {} })
  m.isCommissioner.mockResolvedValue(false)
  m.canAccessLeague.mockResolvedValue(true)
  m.survivorFindMany.mockResolvedValue([])
  m.draftQueueFindMany.mockResolvedValue([])
  m.draftSessionFindFirst.mockResolvedValue({ leagueId: "lg-1" })
  process.env.CRON_SECRET = "test-cron-secret-not-a-real-credential-0002"
  const { __resetSharedRateLimitForTests } = await import("@/lib/security/sharedRateLimit")
  __resetSharedRateLimitForTests()
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
})

describe("JSON-LD cannot close its own script element", () => {
  it("escapes < in every string value", async () => {
    const { serializeJsonLd, buildStructuredDataScript } = await import("@/lib/seo/StructuredDataResolver")
    const hostile = { name: '</script><img src=x onerror="alert(1)">' }
    for (const out of [serializeJsonLd(hostile), buildStructuredDataScript(hostile)]) {
      expect(out).not.toContain("</script")
      expect(JSON.parse(out)).toEqual(hostile) // same value to a JSON parser
    }
  })
})

describe("league invite email", () => {
  it("escapes a hostile league name and never takes the link host from a header", async () => {
    signedIn()
    m.assertCommissioner.mockResolvedValue({ league: {} })
    m.getLeaguePrivacySettings.mockResolvedValue({ allowEmailInvite: true, allowUsernameInvite: true })
    m.leagueFindUnique.mockResolvedValue({
      id: "lg-1",
      name: '<a href="https://evil.example">Claim your prize</a>',
      settings: { inviteCode: "CODE1234", inviteExpiresAt: "2099-01-01T00:00:00Z" },
    })
    m.emailsSend.mockResolvedValue({ error: null })

    const { POST } = await import("@/app/api/commissioner/leagues/[leagueId]/invite/send/route")
    const res = await POST(
      new NextRequest(new URL("https://www.allfantasy.ai/api/commissioner/leagues/lg-1/invite/send"), {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-host": "evil.example" },
        body: JSON.stringify({ type: "email", email: "friend@example.com" }),
      }),
      { params: Promise.resolve({ leagueId: "lg-1" }) },
    )
    expect(res.status).toBe(200)
    const sent = m.emailsSend.mock.calls[0][0]
    expect(sent.html).not.toContain('<a href="https://evil.example"')
    expect(sent.html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;")
    expect(sent.html).not.toContain("://evil.example/")
    expect((await res.json()).inviteUrl).not.toContain("evil.example")
  })
})

describe("private per-member data needs the member (or the commissioner)", () => {
  it("a member cannot read another member's survivor notifications", async () => {
    signedIn()
    const { GET } = await import("@/app/api/survivor/notifications/route")
    const res = await GET(get(`https://www.allfantasy.ai/api/survivor/notifications?leagueId=lg-1&userId=${RIVAL}`))
    expect(res.status).toBe(403)
    expect(m.survivorFindMany).not.toHaveBeenCalled()
  })

  it("the commissioner still can", async () => {
    signedIn()
    m.isCommissioner.mockResolvedValue(true)
    const { GET } = await import("@/app/api/survivor/notifications/route")
    const res = await GET(get(`https://www.allfantasy.ai/api/survivor/notifications?leagueId=lg-1&userId=${RIVAL}`))
    expect(res.status).toBe(200)
  })

  it("a member cannot read a rival's draft queue", async () => {
    signedIn()
    const { GET } = await import("@/app/api/draft/queue/route")
    const res = await GET(get(`https://www.allfantasy.ai/api/draft/queue?draftId=d-1&userId=${RIVAL}`))
    expect(res.status).toBe(403)
    expect(m.draftQueueFindMany).not.toHaveBeenCalled()
  })

  it("league history needs a session and membership", async () => {
    const { GET } = await import("@/app/api/warehouse/league-history/route")
    expect((await GET(get("https://www.allfantasy.ai/api/warehouse/league-history?leagueId=lg-1"))).status).toBe(401)
    signedIn()
    m.assertLeagueMember.mockResolvedValue({ ok: false, status: 403 })
    expect((await GET(get("https://www.allfantasy.ai/api/warehouse/league-history?leagueId=lg-1"))).status).toBe(403)
  })

  it("zombie items need membership", async () => {
    signedIn()
    m.assertLeagueMember.mockResolvedValue({ ok: false, status: 403 })
    const { GET } = await import("@/app/api/zombie/items/route")
    const res = await GET(get(`https://www.allfantasy.ai/api/zombie/items?leagueId=lg-1&userId=${RIVAL}`))
    expect(res.status).toBe(403)
    expect(m.rosterFindFirst).not.toHaveBeenCalled()
  })
})

describe("money and machine endpoints", () => {
  it("wallet deposit no longer credits an unpaid amount", async () => {
    const { POST } = await import("@/app/api/shared/wallet/deposit/route")
    const res = await POST()
    expect(res.status).toBe(501)
  })

  it("world-cup reminders fail CLOSED when no secret is presented", async () => {
    const { GET } = await import("@/app/api/cron/world-cup-bracket-reminders/route")
    expect((await GET(get("https://www.allfantasy.ai/api/cron/world-cup-bracket-reminders"))).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await GET(get("https://www.allfantasy.ai/api/cron/world-cup-bracket-reminders"))).status).toBe(401)
    expect(m.runReminders).not.toHaveBeenCalled()
  })

  it("the matchup insight AI endpoint refuses anonymous callers", async () => {
    const { POST } = await import("@/app/api/simulation/matchup/insight/route")
    const res = await POST(
      new NextRequest(new URL("https://www.allfantasy.ai/api/simulation/matchup/insight"), {
        method: "POST",
        body: JSON.stringify({ teamA: { mean: 100 }, teamB: { mean: 90 } }),
      }),
    )
    expect(res.status).toBe(401)
  })
})

describe("shared rate limit", () => {
  it("admits exactly `max` from a parallel burst", async () => {
    const { consumeSharedRateLimit } = await import("@/lib/security/sharedRateLimit")
    const results = await Promise.all(Array.from({ length: 30 }, () => consumeSharedRateLimit("burst-test", 10, 60)))
    expect(results.filter((r) => r.success)).toHaveLength(10)
  })

  // The admin password is ONE secret, so spreading guesses over many addresses must
  // not buy more of them. The old per-IP, in-process lockout could not see this.
  it("caps admin password guesses GLOBALLY, so a fresh address is refused too", async () => {
    process.env.ADMIN_PASSWORD = "test-admin-password-not-real-0003"
    const { POST } = await import("@/app/api/auth/login/route")
    const attempt = (ip: string, i: number) =>
      POST(
        new NextRequest(new URL("https://www.allfantasy.ai/api/auth/login"), {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": ip },
          body: JSON.stringify({ password: `guess-${i}` }),
        }),
      )
    // 6 addresses x 7 guesses = 42: never enough on any one address to trip the
    // per-address lockout (8), but past the global ceiling (40).
    for (let a = 0; a < 6; a++) for (let i = 0; i < 7; i++) await attempt(`198.51.100.${100 + a}`, i)
    const fresh = await attempt("198.51.100.200", 0)
    expect(fresh.status).toBe(429)
  })
})
