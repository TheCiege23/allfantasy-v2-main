// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import crypto from "crypto"
import { NextRequest } from "next/server"

const h = vi.hoisted(() => ({
  put: vi.fn(),
  consumeSharedRateLimit: vi.fn(),
  leagueTeamFindMany: vi.fn(),
  leagueTeamUpdate: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock("@/lib/telemetry/usage", () => ({ withApiUsage: () => (fn: unknown) => fn }))
vi.mock("@vercel/blob", () => ({ put: h.put }))
vi.mock("@/lib/security/sharedRateLimit", () => ({ consumeSharedRateLimit: h.consumeSharedRateLimit }))
vi.mock("@/lib/prisma", () => ({
  prisma: { leagueTeam: { findMany: h.leagueTeamFindMany, update: h.leagueTeamUpdate } },
}))

beforeEach(() => {
  vi.clearAllMocks()
  h.consumeSharedRateLimit.mockResolvedValue({ success: true, count: 1 })
  h.put.mockResolvedValue({ url: "https://blob.test/x.png" })
  vi.stubGlobal("fetch", h.fetch)
})
afterEach(() => vi.unstubAllGlobals())

function upload(bytes: Uint8Array, name: string, type: string) {
  const form = new FormData()
  form.set("file", new File([bytes], name, { type }))
  return new NextRequest("https://allfantasy.test/api/legacy/feedback/upload", { method: "POST", body: form })
}

describe("legacy feedback upload", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token"
  })

  it("refuses an SVG even when the client calls it an image", async () => {
    const { POST } = await import("@/server/api-route-modules/legacy/feedback/upload/route")
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const res = await POST(upload(svg, "x.svg", "image/svg+xml"))
    expect(res.status).toBe(400)
    expect(h.put).not.toHaveBeenCalled()
  })

  it("stores a real PNG with the server's extension and type, not the client's", async () => {
    const { POST } = await import("@/server/api-route-modules/legacy/feedback/upload/route")
    const res = await POST(upload(PNG, "evil.html", "image/x-anything"))
    expect(res.status).toBe(200)
    const [key, , opts] = h.put.mock.calls[0]
    expect(key).toMatch(/\.png$/)
    expect(opts.contentType).toBe("image/png")
  })

  it("is rate limited per IP", async () => {
    h.consumeSharedRateLimit.mockResolvedValue({ success: false, count: 11 })
    const { POST } = await import("@/server/api-route-modules/legacy/feedback/upload/route")
    const res = await POST(upload(PNG, "a.png", "image/png"))
    expect(res.status).toBe(429)
  })
})

describe("admin session cookie expiry", () => {
  beforeEach(() => {
    process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret"
  })

  it("stamps an expiry on every cookie it signs", async () => {
    const { signAdminSessionCookie, verifyAdminSessionCookie } = await import("@/lib/adminSession")
    const payload = verifyAdminSessionCookie(signAdminSessionCookie({ authenticated: true, role: "admin" }))
    expect(payload?.expiresAt).toBeGreaterThan(Date.now())
  })

  it("refuses a validly signed cookie that carries no expiry", async () => {
    const { verifyAdminSessionCookie } = await import("@/lib/adminSession")
    const b64 = Buffer.from(JSON.stringify({ authenticated: true, role: "admin" })).toString("base64url")
    const sig = crypto.createHmac("sha256", "test-admin-session-secret").update(b64).digest("base64url")
    expect(verifyAdminSessionCookie(`${b64}.${sig}`)).toBeNull()
  })
})

describe("requireCronAuth", () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  function req(secret: string) {
    return new NextRequest("https://allfantasy.test/api/cron/x", { headers: { "x-cron-secret": secret } })
  }

  it("accepts the right secret and refuses a wrong or missing one", async () => {
    process.env.CRON_SECRET = "the-cron-secret-value"
    delete process.env.IMPORT_WORKER_SECRET
    delete process.env.BRACKET_ADMIN_SECRET
    delete process.env.ADMIN_PASSWORD
    const { requireCronAuth } = await import("@/app/api/cron/_auth")
    expect(requireCronAuth(req("the-cron-secret-value"))).toBe(true)
    expect(requireCronAuth(req("the-cron-secret-valuX"))).toBe(false)
    expect(requireCronAuth(req(""))).toBe(false)
  })

  it("refuses everything when no secret is configured (fails closed)", async () => {
    delete process.env.CRON_SECRET
    delete process.env.LEAGUE_CRON_SECRET
    delete process.env.IMPORT_WORKER_SECRET
    delete process.env.BRACKET_ADMIN_SECRET
    delete process.env.ADMIN_PASSWORD
    const { requireCronAuth } = await import("@/app/api/cron/_auth")
    expect(requireCronAuth(req("anything"))).toBe(false)
  })
})

describe("avatar mirror SSRF guard", () => {
  const uploader = vi.fn(async () => "https://cdn.allfantasy.test/a.png")

  it("never fetches a URL that resolves to a private or metadata address", async () => {
    h.leagueTeamFindMany.mockResolvedValue([
      { id: "t1", avatarUrl: "https://169.254.169.254/latest/meta-data/" },
      { id: "t2", avatarUrl: "https://internal.example/" },
      { id: "t3", avatarUrl: "http://plain-http.example/a.png" },
    ])
    const { mirrorImportAvatars } = await import("@/lib/league-import/avatarMirror")
    const result = await mirrorImportAvatars("league-1", uploader, async () => ["10.0.0.5"])
    expect(h.fetch).not.toHaveBeenCalled()
    expect(result.failed).toBe(3)
  })

  it("fetches a public https avatar without following redirects", async () => {
    h.leagueTeamFindMany.mockResolvedValue([{ id: "t1", avatarUrl: "https://sleepercdn.example/a.png" }])
    h.fetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }))
    h.leagueTeamUpdate.mockResolvedValue({})
    const { mirrorImportAvatars } = await import("@/lib/league-import/avatarMirror")
    await mirrorImportAvatars("league-1", uploader, async () => ["93.184.216.34"])
    expect(h.fetch).toHaveBeenCalledWith("https://sleepercdn.example/a.png", { redirect: "manual" })
  })

  it("does no outbound fetching at all while no storage uploader is wired", async () => {
    h.leagueTeamFindMany.mockResolvedValue([{ id: "t1", avatarUrl: "https://sleepercdn.example/a.png" }])
    const { mirrorImportAvatars } = await import("@/lib/league-import/avatarMirror")
    await mirrorImportAvatars("league-1")
    expect(h.fetch).not.toHaveBeenCalled()
  })
})
