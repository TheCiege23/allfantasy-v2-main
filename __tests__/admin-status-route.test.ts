import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getAdminAccessState: vi.fn(),
  getAdminProductionReadiness: vi.fn(),
}))

vi.mock("@/lib/adminAuth", () => ({
  getAdminAccessState: mocks.getAdminAccessState,
}))

vi.mock("@/lib/admin-dashboard/AdminProductionReadinessService", () => ({
  getAdminProductionReadiness: mocks.getAdminProductionReadiness,
}))

describe("admin status route", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.getAdminProductionReadiness.mockResolvedValue({
      env: [],
      crons: [],
      trafficLocations: [],
      trafficNotes: [],
    })
  })

  it("returns 401 for unauthenticated users", async () => {
    mocks.getAdminAccessState.mockResolvedValueOnce({ status: "unauthenticated", source: "none" })

    const { GET } = await import("@/app/api/admin/status/route")
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toMatchObject({ authenticated: false, admin: false })
    // Deployment/database identity must never reach an unauthenticated caller.
    expect(body).not.toHaveProperty("deployment")
  })

  it("returns 403 for authenticated non-admin users", async () => {
    mocks.getAdminAccessState.mockResolvedValueOnce({
      status: "forbidden",
      source: "app_session",
      user: { id: "user-1", email: "member@example.com", username: "MemberOne" },
    })

    const { GET } = await import("@/app/api/admin/status/route")
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({
      authenticated: true,
      admin: false,
      user: { id: "user-1", username: "MemberOne", emailMasked: "me***@example.com" },
    })
    expect(JSON.stringify(body)).not.toContain("member@example.com")
    expect(body).not.toHaveProperty("deployment")
  })

  it("returns masked admin status for admins", async () => {
    mocks.getAdminAccessState.mockResolvedValueOnce({
      status: "admin",
      source: "app_session",
      user: { id: "admin-1", email: "founder@example.com", username: "TheCiege26", role: "admin" },
    })

    const { GET } = await import("@/app/api/admin/status/route")
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      authenticated: true,
      admin: true,
      source: "app_session",
      readiness: { missingCriticalEnv: [], missingCronJobs: [] },
      user: { id: "admin-1", username: "TheCiege26", emailMasked: "fo***@example.com" },
    })
    expect(JSON.stringify(body)).not.toContain("founder@example.com")
  })

  it("exposes deployment and database identity to admins without leaking credentials", async () => {
    process.env.VERCEL_ENV = "production"
    process.env.VERCEL_GIT_COMMIT_SHA = "e61a63886189c65e3aeea5ff7f6017f5cc70dae8"
    process.env.DATABASE_URL =
      "postgresql://db_owner:npg_FAKE_TEST_VALUE@ep-fixture-endpoint-00000000.c-2.us-east-1.aws.neon.tech/appdb"

    mocks.getAdminAccessState.mockResolvedValueOnce({
      status: "admin",
      source: "app_session",
      user: { id: "admin-1", email: "founder@example.com", username: "TheCiege26", role: "admin" },
    })

    const { GET } = await import("@/app/api/admin/status/route")
    const body = await (await GET()).json()

    expect(body.deployment).toMatchObject({
      environment: "production",
      commitShaShort: "e61a638",
      database: { endpointLabel: "ep-fixture-endpoint-00000000", databaseName: "appdb", unavailable: false },
    })
    expect(JSON.stringify(body)).not.toContain("npg_FAKE_TEST_VALUE")
    expect(JSON.stringify(body)).not.toContain("db_owner")

    delete process.env.VERCEL_ENV
    delete process.env.VERCEL_GIT_COMMIT_SHA
    delete process.env.DATABASE_URL
  })
})
