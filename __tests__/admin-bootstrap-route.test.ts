import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  appUserFindFirst: vi.fn(),
  appUserUpdate: vi.fn(),
  appUserCreate: vi.fn(),
  bcryptHash: vi.fn(),
  signAdminSessionCookie: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appUser: {
      findFirst: mocks.appUserFindFirst,
      update: mocks.appUserUpdate,
      create: mocks.appUserCreate,
    },
  },
}))

vi.mock("bcryptjs", () => ({
  default: { hash: mocks.bcryptHash },
  hash: mocks.bcryptHash,
}))

vi.mock("@/lib/adminSession", () => ({
  signAdminSessionCookie: mocks.signAdminSessionCookie,
}))

describe("admin bootstrap route", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.ADMIN_BOOTSTRAP_ENABLED
    delete process.env.ADMIN_BOOTSTRAP_EMAIL
    delete process.env.ADMIN_BOOTSTRAP_PASSWORD
    delete process.env.ADMIN_BOOTSTRAP_USERNAME
    delete process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME
    delete process.env.ADMIN_SESSION_SECRET
    mocks.bcryptHash.mockResolvedValue("hashed-bootstrap-password")
    mocks.signAdminSessionCookie.mockReturnValue("signed-admin-session")
  })

  /** Mirrors BOOTSTRAP_MAX_ATTEMPTS in the route. */
  const MAX_ATTEMPTS = 5

  const bootstrapRequest = (ip: string, body: Record<string, unknown>) =>
    new Request("http://localhost/api/admin/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    })

  function enableBootstrap() {
    process.env.ADMIN_BOOTSTRAP_ENABLED = "true"
    process.env.ADMIN_BOOTSTRAP_EMAIL = "founder@example.com"
    process.env.ADMIN_BOOTSTRAP_PASSWORD = "long-secret-password"
    process.env.ADMIN_SESSION_SECRET = "signed-session-secret"
  }

  it("is unavailable unless explicitly enabled", async () => {
    const { POST } = await import("@/app/api/admin/bootstrap/route")

    const res = await POST(
      new Request("http://localhost/api/admin/bootstrap", {
        method: "POST",
        body: JSON.stringify({ email: "founder@example.com", password: "long-secret-password" }),
      })
    )

    expect(res.status).toBe(404)
    expect(mocks.appUserFindFirst).not.toHaveBeenCalled()
  })

  it("hashes the bootstrap password and signs an admin session when enabled", async () => {
    process.env.ADMIN_BOOTSTRAP_ENABLED = "true"
    process.env.ADMIN_BOOTSTRAP_EMAIL = "Founder@Example.com"
    process.env.ADMIN_BOOTSTRAP_PASSWORD = "long-secret-password"
    process.env.ADMIN_SESSION_SECRET = "signed-session-secret"
    mocks.appUserFindFirst.mockResolvedValueOnce({ id: "user-1", username: "TheCiege26" })
    mocks.appUserUpdate.mockResolvedValueOnce({ id: "user-1", username: "TheCiege26" })

    const { POST } = await import("@/app/api/admin/bootstrap/route")
    const res = await POST(
      new Request("http://localhost/api/admin/bootstrap", {
        method: "POST",
        body: JSON.stringify({ email: "founder@example.com", password: "long-secret-password" }),
      })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, userId: "user-1", username: "TheCiege26", next: "/admin" })
    expect(mocks.bcryptHash).toHaveBeenCalledWith("long-secret-password", 12)
    expect(mocks.appUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({ passwordHash: "hashed-bootstrap-password" }),
      })
    )
    expect(mocks.signAdminSessionCookie).toHaveBeenCalledWith(
      expect.objectContaining({ authenticated: true, email: "founder@example.com", role: "admin" })
    )
    expect(res.headers.get("set-cookie")).toContain("admin_session=signed-admin-session")
  })

  it("rejects wrong bootstrap credentials without touching users", async () => {
    process.env.ADMIN_BOOTSTRAP_ENABLED = "true"
    process.env.ADMIN_BOOTSTRAP_EMAIL = "founder@example.com"
    process.env.ADMIN_BOOTSTRAP_PASSWORD = "long-secret-password"
    process.env.ADMIN_SESSION_SECRET = "signed-session-secret"

    const { POST } = await import("@/app/api/admin/bootstrap/route")
    const res = await POST(
      new Request("http://localhost/api/admin/bootstrap", {
        method: "POST",
        body: JSON.stringify({ email: "founder@example.com", password: "wrong-password" }),
      })
    )

    expect(res.status).toBe(401)
    expect(mocks.appUserUpdate).not.toHaveBeenCalled()
    expect(mocks.appUserCreate).not.toHaveBeenCalled()
  })

  it("fails clearly when the session secret is missing", async () => {
    process.env.ADMIN_BOOTSTRAP_ENABLED = "true"
    process.env.ADMIN_BOOTSTRAP_EMAIL = "founder@example.com"
    process.env.ADMIN_BOOTSTRAP_PASSWORD = "long-secret-password"

    const { POST } = await import("@/app/api/admin/bootstrap/route")
    const res = await POST(
      new Request("http://localhost/api/admin/bootstrap", {
        method: "POST",
        body: JSON.stringify({ email: "founder@example.com", password: "long-secret-password" }),
      })
    )
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toContain("ADMIN_SESSION_SECRET")
    expect(mocks.appUserUpdate).not.toHaveBeenCalled()
    expect(mocks.signAdminSessionCookie).not.toHaveBeenCalled()
  })

  it("stops the credential comparison after the attempt budget is spent from one IP", async () => {
    enableBootstrap()
    const { POST } = await import("@/app/api/admin/bootstrap/route")

    const statuses: number[] = []
    for (let i = 0; i <= MAX_ATTEMPTS; i++) {
      const res = await POST(
        bootstrapRequest("203.0.113.7", { email: "founder@example.com", password: `guess-${i}` })
      )
      statuses.push(res.status)
    }

    // The first MAX_ATTEMPTS must reach the comparison — asserting them proves the limiter did not
    // simply fire early, which a too-tight budget would look identical to.
    expect(statuses.slice(0, MAX_ATTEMPTS)).toEqual(Array(MAX_ATTEMPTS).fill(401))
    expect(statuses[MAX_ATTEMPTS]).toBe(429)
    expect(mocks.appUserUpdate).not.toHaveBeenCalled()
    expect(mocks.appUserCreate).not.toHaveBeenCalled()
  })

  it("budgets attempts per IP rather than in one global window", async () => {
    enableBootstrap()
    const { POST } = await import("@/app/api/admin/bootstrap/route")

    for (let i = 0; i <= MAX_ATTEMPTS; i++) {
      await POST(bootstrapRequest("203.0.113.8", { email: "founder@example.com", password: `guess-${i}` }))
    }

    const exhaustedIp = await POST(
      bootstrapRequest("203.0.113.8", { email: "founder@example.com", password: "one-more" })
    )
    const untouchedIp = await POST(
      bootstrapRequest("198.51.100.4", { email: "founder@example.com", password: "wrong-password" })
    )

    // A limiter keyed on a constant would lock out the second IP too. Asserting the second caller
    // still reaches the comparison is what separates a per-IP bucket from a shared one.
    expect(exhaustedIp.status).toBe(429)
    expect(untouchedIp.status).toBe(401)
  })

  it("returns an identical 429 whether the email or the password was wrong", async () => {
    enableBootstrap()
    const { POST } = await import("@/app/api/admin/bootstrap/route")

    const exhaust = async (ip: string, body: Record<string, unknown>) => {
      const responses = []
      for (let i = 0; i <= MAX_ATTEMPTS; i++) responses.push(await POST(bootstrapRequest(ip, body)))
      return responses[responses.length - 1]!
    }

    const wrongEmail = await exhaust("203.0.113.21", {
      email: "intruder@example.com",
      password: "long-secret-password",
    })
    const wrongPassword = await exhaust("203.0.113.22", {
      email: "founder@example.com",
      password: "not-the-real-password",
    })

    expect(wrongEmail.status).toBe(429)
    expect(wrongPassword.status).toBe(429)
    expect(await wrongEmail.json()).toEqual(await wrongPassword.json())
  })

  it("never answers 429 while disabled, so the endpoint stays indistinguishable from a missing one", async () => {
    const { POST } = await import("@/app/api/admin/bootstrap/route")

    const statuses: number[] = []
    for (let i = 0; i < MAX_ATTEMPTS * 2 + 2; i++) {
      const res = await POST(
        bootstrapRequest("203.0.113.9", { email: "founder@example.com", password: `guess-${i}` })
      )
      statuses.push(res.status)
    }

    expect(Array.from(new Set(statuses))).toEqual([404])
  })
})
