import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Launch-hardening: the resend-verification endpoint must not report success when the provider
 * rejects the email, must drop the undelivered token, and must keep its auth / cooldown / rate
 * limits intact. Never leak the token, verification URL, recipient, or secrets.
 */
const mocks = vi.hoisted(() => ({
  getSessionAndProfile: vi.fn(),
  rateLimit: vi.fn(),
  getResendClient: vi.fn(),
  send: vi.fn(),
  userFindUnique: vi.fn(),
  tokenFindFirst: vi.fn(),
  tokenDeleteMany: vi.fn(),
  tokenCreate: vi.fn(),
  tokenDelete: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appUser: { findUnique: mocks.userFindUnique },
    emailVerifyToken: {
      findFirst: mocks.tokenFindFirst,
      deleteMany: mocks.tokenDeleteMany,
      create: mocks.tokenCreate,
      delete: mocks.tokenDelete,
    },
  },
}))
vi.mock("@/lib/auth-guard", () => ({ getSessionAndProfile: mocks.getSessionAndProfile }))
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit, getClientIp: () => "127.0.0.1" }))
vi.mock("@/lib/site-public-origin", () => ({ getDeploymentLinkOrigin: () => "https://preview.example" }))
vi.mock("@/lib/auth/user-facing-site-origin", () => ({ USER_FACING_SITE_ORIGIN: "https://www.allfantasy.ai" }))
vi.mock("@/lib/email/verification-email-html", () => ({ buildVerificationEmailHtml: () => "<html></html>" }))
vi.mock("@/lib/email/idempotency", () => ({ buildEmailIdempotencyKey: () => "idem-key" }))
vi.mock("@/lib/resend-client", async (orig) => {
  const actual = await orig<typeof import("@/lib/resend-client")>()
  return { ...actual, getResendClient: mocks.getResendClient } // real resendSendError, mocked client
})

async function route() {
  return import("@/app/api/auth/verify-email/send/route")
}
function req(body: unknown = { returnTo: "/dashboard" }) {
  return new Request("https://preview.example/api/auth/verify-email/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const RECIPIENT = "manager+beta2@gmail.com"
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  // authed, unverified user; no cooldown; rate limit ok
  mocks.getSessionAndProfile.mockResolvedValue({ userId: "user-1", email: RECIPIENT })
  mocks.rateLimit.mockReturnValue({ success: true })
  mocks.userFindUnique.mockResolvedValue({ emailVerified: null, email: RECIPIENT })
  mocks.tokenFindFirst.mockResolvedValue(null)
  mocks.tokenDeleteMany.mockResolvedValue({ count: 0 })
  mocks.tokenCreate.mockResolvedValue({ id: "token-1" })
  mocks.tokenDelete.mockResolvedValue({ id: "token-1" })
  mocks.getResendClient.mockResolvedValue({
    client: { emails: { send: mocks.send } },
    fromEmail: "AllFantasy <noreply@allfantasy.ai>",
  })
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

describe("verify-email/send — provider error handling", () => {
  it("returns { ok: true } on a successful send and keeps the token", async () => {
    mocks.send.mockResolvedValue({ data: { id: "email-1" }, error: null })
    const res = await (await route()).POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.tokenDelete).not.toHaveBeenCalled()
  })

  it("does NOT report success when Resend returns { error } without throwing", async () => {
    mocks.send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "domain not verified" } })
    const res = await (await route()).POST(req())
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.ok).toBeUndefined()
    expect(body.error).toBe("EMAIL_SEND_FAILED")
    expect(mocks.tokenDelete).toHaveBeenCalledWith({ where: { id: "token-1" } }) // undelivered token dropped
  })

  it("treats a thrown provider/client exception as a failed send (502)", async () => {
    mocks.send.mockRejectedValue(new Error("network down"))
    const res = await (await route()).POST(req())
    expect(res.status).toBe(502)
    expect((await res.json()).ok).toBeUndefined()
    expect(mocks.tokenDelete).toHaveBeenCalledWith({ where: { id: "token-1" } })
  })

  it("never leaks the token, verification URL, or recipient in the response or logs", async () => {
    mocks.send.mockResolvedValue({ data: null, error: { name: "x", message: "domain not verified" } })
    const res = await (await route()).POST(req())
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain("token-1")
    expect(body).not.toContain(RECIPIENT)
    expect(body).not.toContain("/verify/email?token=")

    const logged = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n")
    expect(logged).toContain("domain not verified") // sanitized provider message is allowed
    expect(logged).not.toContain("token-1")
    expect(logged).not.toContain(RECIPIENT)
    expect(logged).not.toContain("/verify/email?token=")
  })
})

describe("verify-email/send — auth, cooldown, and rate limits remain intact", () => {
  it("still returns 401 without a session (no send attempted)", async () => {
    mocks.getSessionAndProfile.mockResolvedValue({ userId: null, email: null })
    const res = await (await route()).POST(req())
    expect(res.status).toBe(401)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("still returns 429 when the rate limiter says stop (no token created, no send)", async () => {
    mocks.rateLimit.mockReturnValue({ success: false })
    const res = await (await route()).POST(req())
    expect(res.status).toBe(429)
    expect(mocks.tokenCreate).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("still enforces the 60s cooldown (a recent token → 429, no send)", async () => {
    mocks.tokenFindFirst.mockResolvedValue({ createdAt: new Date() })
    const res = await (await route()).POST(req())
    expect(res.status).toBe(429)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("short-circuits an already-verified user without sending", async () => {
    mocks.userFindUnique.mockResolvedValue({ emailVerified: new Date(), email: RECIPIENT })
    const res = await (await route()).POST(req())
    expect(res.status).toBe(200)
    expect((await res.json()).alreadyVerified).toBe(true)
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
