// @vitest-environment node
/**
 * The admin second factor, and the retirement of the shared-password admin login.
 *
 * Before 2026-11-13 one shared ADMIN_PASSWORD signed anyone into /admin with no identity,
 * and an allowlisted Google or email login was admin by itself. Now: the password login
 * is refused in production, and once ADMIN_TOTP_SECRETS is set no human reaches /admin
 * without an authenticator code. Addresses are RFC 5737; every secret is generated here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  getServerSession: vi.fn(),
  appUserFindUnique: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name)! } : undefined),
  }),
}))
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: { appUser: { findUnique: mocks.appUserFindUnique } } }))
vi.mock("@/lib/telemetry/usage", () => ({ withApiUsage: () => (handler: unknown) => handler }))

import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  totpAt,
  totpAuthUri,
  totpCounter,
  verifyTotp,
} from "@/lib/security/totp"
import { adminTotpRequired, adminTotpSecretFor, parseAdminTotpSecrets } from "@/lib/security/adminTotp"
import {
  ADMIN_MFA_PENDING_COOKIE,
  signAdminMagicToken,
  signAdminMfaPending,
  signAdminSessionCookie,
  verifyAdminMfaPending,
  verifyAdminSessionCookie,
} from "@/lib/adminSession"
import { __resetSharedRateLimitForTests } from "@/lib/security/sharedRateLimit"

const FOUNDER = "founder@example.com"

function codeFor(secret: string, nowMs = Date.now()) {
  return totpAt(base32Decode(secret)!, totpCounter(nowMs))
}

function cookieFrom(res: Response, name: string): string | null {
  const all = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
  const line = all.find((c) => c.startsWith(`${name}=`))
  return line ? decodeURIComponent(line.slice(name.length + 1).split(";")[0]) : null
}

beforeEach(() => {
  vi.resetModules()
  mocks.jar.clear()
  mocks.getServerSession.mockReset().mockResolvedValue(null)
  mocks.appUserFindUnique.mockReset().mockResolvedValue({ email: FOUNDER, emailVerified: new Date("2026-01-01") })
  __resetSharedRateLimitForTests()
  vi.stubEnv("ADMIN_SESSION_SECRET", "test-admin-session-secret-not-real")
  vi.stubEnv("ADMIN_EMAILS", FOUNDER)
  vi.stubEnv("ADMIN_TOTP_SECRETS", "")
})
afterEach(() => vi.unstubAllEnvs())

describe("TOTP (RFC 6238)", () => {
  // Appendix B of RFC 6238, SHA-1 rows: ASCII key "12345678901234567890", 8 digits.
  const RFC_KEY = Buffer.from("12345678901234567890", "ascii")
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("matches the RFC vector at T=%i", (t, expected) => {
    expect(totpAt(RFC_KEY, Math.floor(t / 30), 8)).toBe(expected)
  })

  it("round-trips base32 and tolerates spaces, dashes and lower case", () => {
    const encoded = base32Encode(RFC_KEY)
    expect(base32Decode(encoded)!.equals(RFC_KEY)).toBe(true)
    const messy = encoded.toLowerCase().replace(/(.{4})/g, "$1 -")
    expect(base32Decode(messy)!.equals(RFC_KEY)).toBe(true)
    expect(base32Decode("not base32!")).toBeNull()
  })

  it("generates a distinct 160-bit secret each time", () => {
    const a = generateTotpSecret()
    expect(a).not.toBe(generateTotpSecret())
    expect(base32Decode(a)).toHaveLength(20)
  })

  it("accepts the current step and one either side, and nothing further", () => {
    const secret = generateTotpSecret()
    const now = 1_800_000_000_000
    expect(verifyTotp(secret, codeFor(secret, now), now)).toBe(totpCounter(now))
    expect(verifyTotp(secret, codeFor(secret, now - 30_000), now)).toBe(totpCounter(now) - 1)
    expect(verifyTotp(secret, codeFor(secret, now + 30_000), now)).toBe(totpCounter(now) + 1)
    expect(verifyTotp(secret, codeFor(secret, now - 90_000), now)).toBeNull()
  })

  it("refuses malformed codes and secrets", () => {
    const secret = generateTotpSecret()
    expect(verifyTotp(secret, "12345")).toBeNull()
    expect(verifyTotp(secret, "abcdef")).toBeNull()
    expect(verifyTotp(secret, "")).toBeNull()
    expect(verifyTotp("SHORT", "123456")).toBeNull()
  })

  it("builds an otpauth URI an authenticator app can scan", () => {
    const uri = totpAuthUri("ABCDEFGHIJKLMNOP", FOUNDER)
    expect(uri.startsWith("otpauth://totp/AllFantasy%20Admin%3Afounder%40example.com?")).toBe(true)
    expect(uri).toContain("secret=ABCDEFGHIJKLMNOP")
    expect(uri).toContain("period=30")
  })
})

describe("ADMIN_TOTP_SECRETS", () => {
  it("is off when unset, and on as soon as one valid entry exists", () => {
    expect(adminTotpRequired()).toBe(false)
    vi.stubEnv("ADMIN_TOTP_SECRETS", `${FOUNDER}=${generateTotpSecret()}`)
    expect(adminTotpRequired()).toBe(true)
  })

  it("skips malformed entries rather than treating them as 'no code needed'", () => {
    const good = generateTotpSecret()
    const map = parseAdminTotpSecrets(`junk, =${good}, nosecret=, bad=not!base32, Founder@Example.com=${good.toLowerCase()}`)
    expect([...map.keys()]).toEqual([FOUNDER])
    expect(map.get(FOUNDER)).toBe(good)
  })

  it("finds the secret under any identity the admin has", () => {
    const s = generateTotpSecret()
    vi.stubEnv("ADMIN_TOTP_SECRETS", `somehandle=${s}`)
    expect(adminTotpSecretFor([FOUNDER, "SomeHandle"])).toEqual({ identity: "somehandle", secret: s })
    expect(adminTotpSecretFor([FOUNDER])).toBeNull()
  })
})

describe("the access gate", () => {
  it("refuses a session from the retired password login, in production only", async () => {
    const { isAdminSessionPayloadUsable } = await import("@/lib/adminAuth")
    const legacy = { authenticated: true, role: "admin", authMethod: "password" }
    expect(isAdminSessionPayloadUsable(legacy)).toBe(true)
    vi.stubEnv("NODE_ENV", "production")
    expect(isAdminSessionPayloadUsable(legacy)).toBe(false)
    expect(isAdminSessionPayloadUsable({ authenticated: true, role: "admin" })).toBe(true)
  })

  it("while codes are required, refuses every admin session not minted by the code check", async () => {
    vi.stubEnv("ADMIN_TOTP_SECRETS", `${FOUNDER}=${generateTotpSecret()}`)
    const { isAdminSessionPayloadUsable } = await import("@/lib/adminAuth")
    expect(isAdminSessionPayloadUsable({ authenticated: true, role: "admin", email: FOUNDER })).toBe(false)
    expect(isAdminSessionPayloadUsable({ authenticated: true, role: "admin", mfa: true })).toBe(true)
  })

  it("an allowlisted account is admin without codes, and only a candidate with them", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { id: "u1", email: FOUNDER, username: "Founder" } })
    let mod = await import("@/lib/adminAuth")
    await expect(mod.getAdminAccessState()).resolves.toMatchObject({ status: "admin", source: "app_session" })

    vi.stubEnv("ADMIN_TOTP_SECRETS", `${FOUNDER}=${generateTotpSecret()}`)
    vi.resetModules()
    mod = await import("@/lib/adminAuth")
    await expect(mod.getAdminAccessState()).resolves.toMatchObject({ status: "unauthenticated" })
    await expect(mod.getAppSessionAdminCandidate()).resolves.toMatchObject({ status: "admin" })
    const gate = await mod.requireAdmin()
    expect(gate.ok).toBe(false)
  })

  it("a code-backed admin_session passes every gate, a plain one passes none", async () => {
    vi.stubEnv("ADMIN_TOTP_SECRETS", `${FOUNDER}=${generateTotpSecret()}`)
    const mod = await import("@/lib/adminAuth")
    const req = (cookie: string) =>
      new Request("https://www.allfantasy.ai/api/admin/x", { headers: { cookie: `admin_session=${encodeURIComponent(cookie)}` } })

    const plain = signAdminSessionCookie({ authenticated: true, role: "admin", email: FOUNDER })
    mocks.jar.set("admin_session", plain)
    await expect(mod.getAdminAccessState()).resolves.toMatchObject({ status: "unauthenticated" })
    expect(mod.isAuthorizedRequest(req(plain))).toBe(false)

    const strong = signAdminSessionCookie({ authenticated: true, role: "admin", email: FOUNDER, mfa: true })
    mocks.jar.set("admin_session", strong)
    await expect(mod.getAdminAccessState()).resolves.toMatchObject({ status: "admin", source: "admin_session" })
    expect(mod.isAuthorizedRequest(req(strong))).toBe(true)
  })

  it("a pending-code cookie is never an admin session, and vice versa", () => {
    const pending = signAdminMfaPending(FOUNDER)
    expect(verifyAdminSessionCookie(pending)).toBeNull()
    expect(verifyAdminMfaPending(pending)).toEqual({ email: FOUNDER })
    expect(verifyAdminMfaPending(signAdminSessionCookie({ authenticated: true, role: "admin" }))).toBeNull()
    expect(verifyAdminMfaPending(signAdminMagicToken(FOUNDER))).toBeNull()
  })
})

describe("POST /api/auth/login (shared password)", () => {
  it("is retired in production — 410, and no session cookie", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ADMIN_PASSWORD", "test-admin-password-not-real-0004")
    const { POST } = await import("@/app/api/auth/login/route")
    const res = await POST(
      new NextRequest("https://www.allfantasy.ai/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.7" },
        body: JSON.stringify({ password: "test-admin-password-not-real-0004" }),
      }),
    )
    expect(res.status).toBe(410)
    expect(cookieFrom(res, "admin_session")).toBeNull()
  })
})

describe("magic link while codes are required", () => {
  it("leads to the code step with a pending cookie, not an admin session", async () => {
    vi.stubEnv("ADMIN_TOTP_SECRETS", `${FOUNDER}=${generateTotpSecret()}`)
    const { GET } = await import("@/app/api/auth/admin-magic/consume/route")
    const token = signAdminMagicToken(FOUNDER, "/admin/moderation")
    const res = await GET(new Request(`https://www.allfantasy.ai/api/auth/admin-magic/consume?token=${encodeURIComponent(token)}`))
    const location = new URL(res.headers.get("location")!)
    expect(location.pathname).toBe("/admin-login")
    expect(location.searchParams.get("step")).toBe("code")
    expect(location.searchParams.get("next")).toBe("/admin/moderation")
    expect(cookieFrom(res, "admin_session")).toBeNull()
    expect(verifyAdminMfaPending(cookieFrom(res, ADMIN_MFA_PENDING_COOKIE))).toEqual({ email: FOUNDER })
  })

  it("still signs straight in when codes are off", async () => {
    const { GET } = await import("@/app/api/auth/admin-magic/consume/route")
    const token = signAdminMagicToken(FOUNDER)
    const res = await GET(new Request(`https://www.allfantasy.ai/api/auth/admin-magic/consume?token=${encodeURIComponent(token)}`))
    expect(verifyAdminSessionCookie(cookieFrom(res, "admin_session")!)).toMatchObject({ authenticated: true })
  })
})

describe("POST /api/auth/admin-totp", () => {
  function post(code: string, ip = "198.51.100.20") {
    return new Request("https://www.allfantasy.ai/api/auth/admin-totp", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ code, next: "/admin/moderation" }),
    })
  }

  it("is closed while codes are off", async () => {
    const { POST } = await import("@/app/api/auth/admin-totp/route")
    expect((await POST(post("123456"))).status).toBe(404)
  })

  it("refuses when nobody has proved who they are yet", async () => {
    vi.stubEnv("ADMIN_TOTP_SECRETS", `${FOUNDER}=${generateTotpSecret()}`)
    const { POST } = await import("@/app/api/auth/admin-totp/route")
    expect((await POST(post("123456"))).status).toBe(401)
  })

  it("an allowlisted account + the right code = a 12-hour, code-backed admin session; the same code twice fails", async () => {
    const secret = generateTotpSecret()
    vi.stubEnv("ADMIN_TOTP_SECRETS", `${FOUNDER}=${secret}`)
    mocks.getServerSession.mockResolvedValue({ user: { id: "u1", email: FOUNDER, username: "Founder" } })
    const { POST } = await import("@/app/api/auth/admin-totp/route")

    const code = codeFor(secret)
    const ok = await POST(post(code))
    expect(ok.status).toBe(200)
    await expect(ok.json()).resolves.toEqual({ ok: true, next: "/admin/moderation" })
    const session = verifyAdminSessionCookie(cookieFrom(ok, "admin_session")!)
    expect(session).toMatchObject({ authenticated: true, role: "admin", id: "u1", email: FOUNDER, mfa: true, authMethod: "totp" })
    expect(session!.expiresAt! - Date.now()).toBeLessThanOrEqual(12 * 60 * 60 * 1000)

    // Replay inside the same step: refused.
    expect((await POST(post(code))).status).toBe(401)
  })

  it("finishes a magic-link sign-in from the pending cookie", async () => {
    const secret = generateTotpSecret()
    vi.stubEnv("ADMIN_TOTP_SECRETS", `${FOUNDER}=${secret}`)
    mocks.jar.set(ADMIN_MFA_PENDING_COOKIE, signAdminMfaPending(FOUNDER))
    const { POST } = await import("@/app/api/auth/admin-totp/route")
    const res = await POST(post(codeFor(secret)))
    expect(res.status).toBe(200)
    expect(verifyAdminSessionCookie(cookieFrom(res, "admin_session")!)).toMatchObject({ email: FOUNDER, mfa: true })
  })

  it("a pending cookie for an address since removed from the allowlist gets nothing", async () => {
    const secret = generateTotpSecret()
    vi.stubEnv("ADMIN_TOTP_SECRETS", `${FOUNDER}=${secret}`)
    mocks.jar.set(ADMIN_MFA_PENDING_COOKIE, signAdminMfaPending("former@example.com"))
    const { POST } = await import("@/app/api/auth/admin-totp/route")
    expect((await POST(post(codeFor(secret)))).status).toBe(401)
  })

  it("a wrong code fails, and five wrong codes lock that admin out for a while", async () => {
    const secret = generateTotpSecret()
    vi.stubEnv("ADMIN_TOTP_SECRETS", `${FOUNDER}=${secret}`)
    mocks.getServerSession.mockResolvedValue({ user: { id: "u1", email: FOUNDER, username: "Founder" } })
    const { POST } = await import("@/app/api/auth/admin-totp/route")
    const wrong = codeFor(secret) === "000000" ? "111111" : "000000"
    for (let i = 0; i < 5; i++) expect((await POST(post(wrong, `198.51.100.${30 + i}`))).status).toBe(401)
    // Even the right code, from a fresh address, is refused until the window passes.
    expect((await POST(post(codeFor(secret), "198.51.100.99"))).status).toBe(429)
  })

  it("an admin with no enrolled secret is refused while codes are on", async () => {
    vi.stubEnv("ADMIN_TOTP_SECRETS", `someone-else@example.com=${generateTotpSecret()}`)
    mocks.getServerSession.mockResolvedValue({ user: { id: "u1", email: FOUNDER, username: "Founder" } })
    const { POST } = await import("@/app/api/auth/admin-totp/route")
    expect((await POST(post("123456"))).status).toBe(403)
  })
})
