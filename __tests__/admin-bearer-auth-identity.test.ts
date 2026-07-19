import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  getServerSession: vi.fn(),
  verifyAdminSessionCookie: vi.fn(),
  resolveAdminApiToken: vi.fn(),
}))

vi.mock("next/headers", () => ({ cookies: () => ({ get: mocks.cookieGet }) }))
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/adminSession", () => ({ verifyAdminSessionCookie: mocks.verifyAdminSessionCookie }))

// Mocked wholesale rather than partially: the real module imports @/lib/prisma, and
// pulling that in would drag the generated client into a unit test that has no database.
vi.mock("@/lib/admin/adminApiTokens", () => ({
  resolveAdminApiToken: mocks.resolveAdminApiToken,
  extractBearerToken: (request: Request) => {
    const header = request.headers.get("authorization")
    if (!header?.startsWith("Bearer ")) return null
    return header.slice(7).trim() || null
  },
}))

function req(headers: Record<string, string>): Request {
  return new Request("https://example.test/api/admin/thing", { headers })
}

const TOKEN_OWNER = {
  tokenId: "tok_1",
  label: "deploy bot",
  ownerEmail: "admin@example.com",
  ownerUserId: "user_1",
}

describe("requireAdminOrBearer — identity on bearer calls", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.getServerSession.mockResolvedValue(null)
    mocks.resolveAdminApiToken.mockResolvedValue(null)
    process.env.ADMIN_PASSWORD = "shared-password"
    process.env.ADMIN_EMAILS = "admin@example.com"
    delete process.env.ADMIN_SHARED_SECRET_FALLBACK
    delete process.env.BRACKET_ADMIN_SECRET
  })

  it("resolves a per-admin token to its owner's identity", async () => {
    mocks.resolveAdminApiToken.mockResolvedValue(TOKEN_OWNER)
    const { requireAdminOrBearer } = await import("@/lib/adminAuth")

    const gate = await requireAdminOrBearer(req({ authorization: "Bearer afadm_raw" }))

    expect(gate.ok).toBe(true)
    if (gate.ok) {
      // The whole point: a bearer call now says WHO, not just "someone knew a secret".
      expect(gate.user?.email).toBe("admin@example.com")
      expect(gate.user?.id).toBe("user_1")
      expect((gate as { source?: string }).source).toBe("admin_api_token")
      expect((gate as { tokenId?: string }).tokenId).toBe("tok_1")
    }
  })

  it("prefers the identity-bearing token over the shared secret", async () => {
    mocks.resolveAdminApiToken.mockResolvedValue(TOKEN_OWNER)
    const { requireAdminOrBearer } = await import("@/lib/adminAuth")

    // Presenting the shared password as a bearer would also authenticate, but the
    // token path runs first so the request is attributed rather than anonymous.
    const gate = await requireAdminOrBearer(req({ authorization: "Bearer shared-password" }))

    expect(gate.ok).toBe(true)
    if (gate.ok) expect((gate as { source?: string }).source).toBe("admin_api_token")
  })

  it("falls back to the shared secret while the flag is on (Phase 1 default)", async () => {
    const { requireAdminOrBearer } = await import("@/lib/adminAuth")

    const gate = await requireAdminOrBearer(req({ authorization: "Bearer shared-password" }))

    expect(gate.ok).toBe(true)
    if (gate.ok) {
      expect((gate as { source?: string }).source).toBe("shared_secret")
      // No identity available on this path — that is the gap tokens exist to close.
      expect(gate.user?.email).toBeUndefined()
    }
  })

  it("rejects an unknown token once the shared-secret fallback is off", async () => {
    process.env.ADMIN_SHARED_SECRET_FALLBACK = "off"
    const { requireAdminOrBearer } = await import("@/lib/adminAuth")

    const gate = await requireAdminOrBearer(req({ authorization: "Bearer shared-password" }))

    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.res.status).toBe(401)
  })

  it("rejects a revoked/unknown token even with the fallback on", async () => {
    mocks.resolveAdminApiToken.mockResolvedValue(null)
    const { requireAdminOrBearer } = await import("@/lib/adminAuth")

    const gate = await requireAdminOrBearer(req({ authorization: "Bearer afadm_revoked" }))

    // Not a valid token AND not the shared password — no way in.
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.res.status).toBe(401)
  })

  it("keeps the cron x-admin-secret header working when the fallback is off", async () => {
    // Regression guard for a deliberate scoping decision: the fallback flag governs the
    // ADMIN_PASSWORD *bearer* path only. checkAdminSecret resolves BRACKET_ADMIN_SECRET
    // first — a separate cron credential — so turning the flag off in Phase 2 must not
    // silently take every cron down with it.
    process.env.ADMIN_SHARED_SECRET_FALLBACK = "off"
    process.env.BRACKET_ADMIN_SECRET = "cron-secret"
    const { requireAdminOrBearer } = await import("@/lib/adminAuth")

    const gate = await requireAdminOrBearer(req({ "x-admin-secret": "cron-secret" }))

    expect(gate.ok).toBe(true)
  })
})
