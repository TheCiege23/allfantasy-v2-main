/**
 * P0-1 BETA-GATE — admin invite API authorization & behavior.
 *
 * Proves the requireAdmin gate runs before any work, the raw token is returned only in the
 * issuance response, and issuance is email-required. The service itself is mocked (its
 * behavior is covered in beta-invite-admission.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  issueInvite: vi.fn(),
  listInvites: vi.fn(),
  revokeInvite: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock("@/lib/adminAuth", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/lib/beta-invite/betaAdmissionService", async (orig) => {
  const actual = await orig<typeof import("@/lib/beta-invite/betaAdmissionService")>()
  return {
    ...actual, // keep the real normalizeEmail
    issueInvite: mocks.issueInvite,
    listInvites: mocks.listInvites,
    revokeInvite: mocks.revokeInvite,
  }
})
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
  getClientIp: () => "127.0.0.1",
}))

async function route() {
  return import("@/app/api/admin/beta-invites/route")
}

function req(method: string, opts: { body?: unknown; qs?: string } = {}) {
  return new Request(`https://allfantasy.ai/api/admin/beta-invites${opts.qs ?? ""}`, {
    method,
    headers: { "content-type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
}

const ADMIN = { ok: true, user: { id: "admin-1", email: "admin@allfantasy.ai" } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rateLimit.mockReturnValue({ success: true })
})

describe("admin beta-invites — authorization", () => {
  for (const verb of ["GET", "POST", "DELETE"] as const) {
    it(`${verb} refuses an unauthenticated/non-admin caller before doing any work`, async () => {
      mocks.requireAdmin.mockResolvedValue({ ok: false, res: new Response("no", { status: 403 }) })
      const mod = await route()
      const res =
        verb === "GET"
          ? await mod.GET()
          : verb === "POST"
            ? await mod.POST(req("POST", { body: { email: "a@b.com" } }))
            : await mod.DELETE(req("DELETE", { qs: "?id=x" }))
      expect(res.status).toBe(403)
      expect(mocks.issueInvite).not.toHaveBeenCalled()
      expect(mocks.listInvites).not.toHaveBeenCalled()
      expect(mocks.revokeInvite).not.toHaveBeenCalled()
    })
  }
})

describe("admin beta-invites — issuance", () => {
  beforeEach(() => mocks.requireAdmin.mockResolvedValue(ADMIN))

  it("returns the raw token + one-time claim URL exactly in the issuance response", async () => {
    mocks.issueInvite.mockResolvedValue({
      id: "inv-1",
      invitedEmail: "manager@example.com",
      rawToken: "RAW-TOKEN-VALUE-1234567890",
      expiresAt: null,
    })
    const mod = await route()
    const res = await mod.POST(req("POST", { body: { email: "MANAGER@example.com", note: "wave 1" } }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.claimUrl).toContain("/api/auth/beta/claim?token=RAW-TOKEN-VALUE-1234567890")
    expect(body.rawToken).toBe("RAW-TOKEN-VALUE-1234567890")
    // The admin identity is taken from the gate, not the client body.
    expect(mocks.issueInvite.mock.calls[0][0].adminId).toBe("admin@allfantasy.ai")
    expect(mocks.issueInvite.mock.calls[0][0].email).toBe("manager@example.com")
  })

  it("rejects issuance with a missing or malformed email (400) and never calls the service", async () => {
    const mod = await route()
    expect((await mod.POST(req("POST", { body: {} }))).status).toBe(400)
    expect((await mod.POST(req("POST", { body: { email: "nope" } }))).status).toBe(400)
    expect(mocks.issueInvite).not.toHaveBeenCalled()
  })

  it("does not accept a client-supplied creator identity", async () => {
    mocks.issueInvite.mockResolvedValue({ id: "i", invitedEmail: "a@b.com", rawToken: "t".repeat(24), expiresAt: null })
    const mod = await route()
    await mod.POST(req("POST", { body: { email: "a@b.com", adminId: "attacker", createdByAdmin: "attacker" } }))
    expect(mocks.issueInvite.mock.calls[0][0].adminId).toBe("admin@allfantasy.ai") // from the gate, not the body
  })

  it("rate-limits issuance (429 when the limiter says stop) before issuing", async () => {
    mocks.rateLimit.mockReturnValue({ success: false })
    const mod = await route()
    const res = await mod.POST(req("POST", { body: { email: "a@b.com" } }))
    expect(res.status).toBe(429)
    expect(mocks.issueInvite).not.toHaveBeenCalled()
  })
})

describe("admin beta-invites — list & revoke", () => {
  beforeEach(() => mocks.requireAdmin.mockResolvedValue(ADMIN))

  it("lists invites without exposing token digests", async () => {
    mocks.listInvites.mockResolvedValue([{ id: "i1", invitedEmail: "a@b.com", status: "pending" }])
    const mod = await route()
    const body = await (await mod.GET()).json()
    expect(body.invites).toHaveLength(1)
    expect(JSON.stringify(body)).not.toContain("tokenDigest")
  })

  it("revokes a pending invite and reports a conflict for a redeemed one", async () => {
    mocks.revokeInvite.mockResolvedValueOnce({ ok: true })
    const mod = await route()
    expect((await mod.DELETE(req("DELETE", { qs: "?id=i1" }))).status).toBe(200)

    mocks.revokeInvite.mockResolvedValueOnce({ ok: false, reason: "already_redeemed" })
    expect((await mod.DELETE(req("DELETE", { qs: "?id=i1" }))).status).toBe(409)
  })

  it("requires an id to revoke", async () => {
    const mod = await route()
    expect((await mod.DELETE(req("DELETE"))).status).toBe(400)
  })
})

describe("admin beta-invites — storage not provisioned (missing table)", () => {
  beforeEach(() => mocks.requireAdmin.mockResolvedValue(ADMIN))

  // Prisma P2021 = "The table ... does not exist in the current database" — the state on a
  // Preview whose DB has not had the additive beta_invites migration applied.
  const p2021 = () => Object.assign(new Error("The table `public.beta_invites` does not exist in the current database."), { code: "P2021" })

  it("GET degrades to 200 { provisioned:false } instead of 500 (panel still renders)", async () => {
    mocks.listInvites.mockRejectedValue(p2021())
    const mod = await route()
    const res = await mod.GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.provisioned).toBe(false)
    expect(body.invites).toEqual([])
    expect(body.reason).toBe("storage_absent")
  })

  it("POST returns 503 { provisioned:false } (issuing disabled, not a crash)", async () => {
    mocks.issueInvite.mockRejectedValue(p2021())
    const mod = await route()
    const res = await mod.POST(req("POST", { body: { email: "a@b.com" } }))
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.provisioned).toBe(false)
  })

  it("DELETE returns 503 { provisioned:false } when storage is absent", async () => {
    mocks.revokeInvite.mockRejectedValue(p2021())
    const mod = await route()
    const res = await mod.DELETE(req("DELETE", { qs: "?id=i1" }))
    expect(res.status).toBe(503)
    expect((await res.json()).provisioned).toBe(false)
  })

  it("a genuine (non-P2021) error still surfaces as 500", async () => {
    mocks.listInvites.mockRejectedValue(new Error("connection refused"))
    const mod = await route()
    expect((await mod.GET()).status).toBe(500)
  })
})

describe("admin beta-invites — audit attribution (createdByAdmin)", () => {
  beforeEach(() => {
    mocks.issueInvite.mockResolvedValue({ id: "i", invitedEmail: "a@b.com", rawToken: "t".repeat(24), expiresAt: null })
  })

  it("records 'password-admin' for a shared-password session (no email/id) — never unknown-admin", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { role: "admin", authMethod: "password" } })
    const mod = await route()
    await mod.POST(req("POST", { body: { email: "a@b.com" } }))
    expect(mocks.issueInvite.mock.calls[0][0].adminId).toBe("password-admin")
  })

  it("still records the admin email when the session carries one (attribution unchanged)", async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", email: "ops@allfantasy.ai", authMethod: "password" },
    })
    const mod = await route()
    await mod.POST(req("POST", { body: { email: "a@b.com" } }))
    expect(mocks.issueInvite.mock.calls[0][0].adminId).toBe("ops@allfantasy.ai")
  })

  it("falls back to 'unknown-admin' only for a genuinely identity-less session", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { role: "admin" } })
    const mod = await route()
    await mod.POST(req("POST", { body: { email: "a@b.com" } }))
    expect(mocks.issueInvite.mock.calls[0][0].adminId).toBe("unknown-admin")
  })
})
