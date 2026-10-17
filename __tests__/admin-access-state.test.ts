import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  getServerSession: vi.fn(),
  verifyAdminSessionCookie: vi.fn(),
  appUserFindUnique: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { appUser: { findUnique: mocks.appUserFindUnique } },
}))

vi.mock("next/headers", () => ({
  cookies: () => ({ get: mocks.cookieGet }),
}))

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

vi.mock("@/lib/adminSession", () => ({
  verifyAdminSessionCookie: mocks.verifyAdminSessionCookie,
}))

describe("admin access state", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.ADMIN_EMAILS
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.getServerSession.mockResolvedValue(null)
    // By default the account row holds the session's email, verified.
    mocks.appUserFindUnique.mockImplementation(async () => ({
      email: "founder@example.com",
      emailVerified: new Date("2026-01-01T00:00:00Z"),
    }))
  })

  // An allowlisted address on an account that never proved it: registration and
  // email-change both allow that, so trusting the session email made anyone who
  // claimed an unused allowlisted address a full admin.
  it("refuses an allowlisted email the account has not verified", async () => {
    process.env.ADMIN_EMAILS = "founder@example.com"
    mocks.appUserFindUnique.mockResolvedValue({ email: "founder@example.com", emailVerified: null })
    mocks.getServerSession.mockResolvedValue({
      user: { id: "squatter-1", email: "founder@example.com", username: "Squatter" },
    })

    const { getAdminAccessState, requireAdmin } = await import("@/lib/adminAuth")
    await expect(getAdminAccessState()).resolves.toMatchObject({ status: "forbidden" })
    const gate = await requireAdmin()
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.res.status).toBe(403)
  })

  it("refuses when the session email is not the email on the account row", async () => {
    process.env.ADMIN_EMAILS = "founder@example.com"
    mocks.appUserFindUnique.mockResolvedValue({
      email: "someone-else@example.com",
      emailVerified: new Date("2026-01-01T00:00:00Z"),
    })
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-9", email: "founder@example.com", username: "Nine" },
    })

    const { getAdminAccessState } = await import("@/lib/adminAuth")
    await expect(getAdminAccessState()).resolves.toMatchObject({ status: "forbidden" })
  })

  it("blocks unauthenticated users", async () => {
    const { getAdminAccessState, requireAdmin } = await import("@/lib/adminAuth")

    await expect(getAdminAccessState()).resolves.toMatchObject({ status: "unauthenticated" })
    const gate = await requireAdmin()

    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.res.status).toBe(401)
  })

  it("blocks authenticated regular users with a forbidden state", async () => {
    mocks.getServerSession.mockResolvedValueOnce({
      user: { id: "user-1", email: "member@example.com", username: "MemberOne" },
    })

    const { getAdminAccessState, requireAdmin } = await import("@/lib/adminAuth")
    await expect(getAdminAccessState()).resolves.toMatchObject({
      status: "forbidden",
      source: "app_session",
      user: { id: "user-1", email: "member@example.com" },
    })

    mocks.getServerSession.mockResolvedValueOnce({
      user: { id: "user-1", email: "member@example.com", username: "MemberOne" },
    })
    const gate = await requireAdmin()
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.res.status).toBe(403)
  })

  it("allows normal app sessions for allowlisted admin emails", async () => {
    process.env.ADMIN_EMAILS = "founder@example.com"
    mocks.getServerSession.mockResolvedValueOnce({
      user: { id: "admin-1", email: "Founder@Example.com", username: "Founder" },
    })

    const { getAdminAccessState } = await import("@/lib/adminAuth")

    await expect(getAdminAccessState()).resolves.toMatchObject({
      status: "admin",
      source: "app_session",
      user: { id: "admin-1", role: "admin" },
    })
  })

  it("allows the founder username without requiring a separate hidden admin cookie", async () => {
    mocks.getServerSession.mockResolvedValueOnce({
      user: { id: "admin-2", email: "theciege@example.com", username: "TheCiege26" },
    })

    const { getAdminAccessState } = await import("@/lib/adminAuth")

    await expect(getAdminAccessState()).resolves.toMatchObject({
      status: "admin",
      source: "app_session",
      user: { id: "admin-2", role: "admin", username: "TheCiege26" },
    })
  })

  it("still allows signed admin session cookies", async () => {
    mocks.cookieGet.mockReturnValueOnce({ value: "signed-cookie" })
    mocks.verifyAdminSessionCookie.mockReturnValueOnce({
      authenticated: true,
      id: "admin-cookie",
      email: "ops@example.com",
      role: "admin",
    })

    const { getAdminAccessState } = await import("@/lib/adminAuth")

    await expect(getAdminAccessState()).resolves.toMatchObject({
      status: "admin",
      source: "admin_session",
      user: { id: "admin-cookie", role: "admin" },
    })
    expect(mocks.getServerSession).not.toHaveBeenCalled()
  })

  it("passes authMethod through for a shared-password admin cookie (no email/id)", async () => {
    mocks.cookieGet.mockReturnValueOnce({ value: "signed-cookie" })
    mocks.verifyAdminSessionCookie.mockReturnValueOnce({
      authenticated: true,
      role: "admin",
      authMethod: "password",
      // deliberately no id / email — a shared-password login has no per-person identity
    })

    const { getAdminAccessState } = await import("@/lib/adminAuth")
    const state = await getAdminAccessState()

    expect(state.status).toBe("admin")
    if (state.status === "admin") {
      expect(state.source).toBe("admin_session")
      expect(state.user).toMatchObject({ role: "admin", authMethod: "password" })
      expect(state.user.email).toBeUndefined()
      expect(state.user.id).toBeUndefined()
    }
  })
})
