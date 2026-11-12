// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ findUnique: vi.fn() }))

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    { appUser: { findUnique: h.findUnique } },
    { get: (t, k) => (k in t ? (t as Record<string, unknown>)[k as string] : new Proxy({}, { get: () => vi.fn(async () => null) })) },
  ),
}))
vi.mock("@/lib/geo/accountGeoLockServer", () => ({ refreshAccountGeoLock: vi.fn(async () => undefined) }))
vi.mock("@/lib/auth/sessionRevocation", () => ({
  isSessionRevoked: vi.fn(async () => false),
  newSessionId: () => "sid-1",
  SessionRevokedError: class extends Error {},
  revokeAllSessionsForUser: vi.fn(),
}))

const ADMIN = "boss@allfantasy.test"
const saved = process.env.ADMIN_EMAILS
process.env.ADMIN_EMAILS = ADMIN
process.env.NEXTAUTH_SECRET ||= "test-secret-not-real"
afterAll(() => {
  if (saved === undefined) delete process.env.ADMIN_EMAILS
  else process.env.ADMIN_EMAILS = saved
})

async function jwt(token: Record<string, unknown>) {
  const { authOptions } = await import("@/lib/auth")
  return (await authOptions.callbacks!.jwt!({ token } as never)) as Record<string, unknown>
}

describe("an admin-allowlisted email reaches the session only once proven", () => {
  // Braces matter: a function RETURNED from beforeEach is run by vitest as a teardown hook.
  beforeEach(() => {
    h.findUnique.mockReset()
  })

  it("withholds an allowlisted email the account has NOT verified", async () => {
    h.findUnique.mockResolvedValue({ email: ADMIN, emailVerified: null })
    const out = await jwt({ id: "attacker", sid: "s", email: ADMIN })
    expect(out.email).toBeNull()
  })

  it("keeps an allowlisted email the account HAS verified", async () => {
    h.findUnique.mockResolvedValue({ email: ADMIN, emailVerified: new Date() })
    const out = await jwt({ id: "boss", sid: "s", email: ADMIN })
    expect(out.email).toBe(ADMIN)
  })

  it("withholds when the proof read fails (fail closed)", async () => {
    h.findUnique.mockRejectedValue(new Error("db down"))
    const out = await jwt({ id: "boss", sid: "s", email: ADMIN })
    expect(out.email).toBeNull()
  })

  it("never reads the database for an ordinary email", async () => {
    const out = await jwt({ id: "u", sid: "s", email: "someone@example.com" })
    expect(out.email).toBe("someone@example.com")
    expect(h.findUnique).not.toHaveBeenCalled()
  })

  it("the session callback does not back-fill a withheld email", async () => {
    const { authOptions } = await import("@/lib/auth")
    const session = (await authOptions.callbacks!.session!({
      session: { user: { email: ADMIN }, expires: "" },
      token: { id: "attacker", email: null },
    } as never)) as { user: { email: string | null } }
    expect(session.user.email).toBeNull()
  })
})
