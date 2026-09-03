import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const prismaMock = vi.hoisted(() => ({
  visitorLocation: {
    groupBy: vi.fn(),
  },
}))

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}))

describe("AdminProductionReadinessService", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.DATABASE_URL
    delete process.env.NEXTAUTH_SECRET
    delete process.env.AUTH_SECRET
    delete process.env.ADMIN_EMAILS
    delete process.env.ADMIN_SESSION_SECRET
    prismaMock.visitorLocation.groupBy.mockResolvedValue([])
  })

  it("reports configured/missing env groups without exposing values", async () => {
    process.env.DATABASE_URL = "postgres://secret-host/db"
    process.env.NEXTAUTH_SECRET = "super-secret"
    process.env.ADMIN_EMAILS = "founder@example.com"

    const { getAdminProductionReadiness } = await import("@/lib/admin-dashboard/AdminProductionReadinessService")
    const result = await getAdminProductionReadiness()

    const database = result.env.find((row) => row.id === "database")
    const admin = result.env.find((row) => row.id === "admin")

    expect(database).toMatchObject({ status: "configured", required: "DATABASE_URL" })
    expect(admin).toMatchObject({ status: "missing" })
    expect(JSON.stringify(result)).not.toContain("postgres://secret-host/db")
    expect(JSON.stringify(result)).not.toContain("super-secret")
  })

  /*
   * ⚠ RENAMED AND RE-AIMED. This asserted a literal `job=live` entry and read the
   * real cron-schedule.json from disk, so it broke when the schedule consolidated
   * to a single `job=all` — and it was RIGHT to break: the service was reporting a
   * false CRITICAL for the same reason. But the old assertion pinned the SHAPE of
   * the schedule (four separate entries) when what matters is the PROPERTY (live
   * sync is covered). `job=all` covers it, per the route's `|| job === "all"`
   * branches, so the property holds and the shape assertion was the stale half.
   *
   * It still reads the real file on purpose: that is what makes it notice when the
   * schedule and the readiness matchers drift apart, which is exactly what happened.
   */
  it("treats the consolidated job=all entry as covering live sync", async () => {
    const { getAdminProductionReadiness } = await import("@/lib/admin-dashboard/AdminProductionReadinessService")
    const result = await getAdminProductionReadiness()
    const worldCup = result.crons.find((row) => row.id === "world-cup-official")

    expect(worldCup?.status).toBe("configured")
    expect(worldCup?.missing).toEqual([])
    // Either a dedicated job=live entry or the job=all entry satisfies this.
    expect(worldCup?.configuredPaths.some((row) => /job=(live|all)\b/.test(row))).toBe(true)
  })
})
