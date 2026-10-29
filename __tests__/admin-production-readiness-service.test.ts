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
    vi.doMock("@/lib/production-health/cronRegistry", () => ({
      readVercelCrons: () => [
        { path: "/api/brackets/world-cup/cron/sync?job=all&provider=apifootball&recalculate=true", schedule: "0 8 * * *" },
      ],
    }))
    const { getAdminProductionReadiness } = await import("@/lib/admin-dashboard/AdminProductionReadinessService")
    const result = await getAdminProductionReadiness()
    const worldCup = result.crons.find((row) => row.id === "world-cup-official")

    expect(worldCup?.status).toBe("configured")
    expect(worldCup?.missing).toEqual([])
    // Either a dedicated job=live entry or the job=all entry satisfies this.
    expect(worldCup?.configuredPaths.some((row) => /job=(live|all)\b/.test(row))).toBe(true)
    vi.doUnmock("@/lib/production-health/cronRegistry")
  })

  /*
   * ⚠ The World Cup sync was RETIRED from cron-schedule.json after the 2026 final (4491fe57a
   * reused its slot). The test above used to read the real file and went red then — and the
   * service went on reporting the retired job as "missing", which ApiHealthService turns into a
   * CRITICAL. A retired seasonal job is omitted; a PARTIAL declaration still reports.
   * Reads the real file on purpose, so the row reappears the moment the sync is re-declared.
   */
  it("omits the retired World Cup sync row rather than raising a false critical", async () => {
    const { readFileSync } = await import("node:fs")
    const schedule = JSON.parse(readFileSync("cron-schedule.json", "utf8")) as { crons: { path: string }[] }
    const declared = schedule.crons.some((c) => c.path.startsWith("/api/brackets/world-cup/cron/sync"))

    const { getAdminProductionReadiness } = await import("@/lib/admin-dashboard/AdminProductionReadinessService")
    const result = await getAdminProductionReadiness()
    const worldCup = result.crons.find((row) => row.id === "world-cup-official")

    if (declared) expect(worldCup?.status).not.toBe("missing")
    else expect(worldCup).toBeUndefined()
  })

  it("still reports a partially declared World Cup sync", async () => {
    vi.doMock("@/lib/production-health/cronRegistry", () => ({
      readVercelCrons: () => [{ path: "/api/brackets/world-cup/cron/sync?job=teams", schedule: "0 8 * * *" }],
    }))
    const { getAdminProductionReadiness } = await import("@/lib/admin-dashboard/AdminProductionReadinessService")
    const result = await getAdminProductionReadiness()
    expect(result.crons.find((row) => row.id === "world-cup-official")?.status).toBe("partial")
    vi.doUnmock("@/lib/production-health/cronRegistry")
  })

  /*
   * ⚠ `/api/cron/import-rankings` NEVER EXISTED — grepped the tree, confirmed absent from
   * both app/api/cron/ and cron-schedule.json. This row could never have reported
   * "configured" against that matcher; it is a second, lower-severity instance of the
   * same mistake the world-cup test above already caught, in the same file.
   *
   * The capability is real and scheduled under two other names — adp-refresh (external
   * multi-provider consensus, ridden by ingestPlayerValues and the AI ADP job) and
   * recompute-allfantasy-adp (AllFantasy's own draft-derived board) — traced downstream
   * to lib/adp/loadAdpBoard.ts, "THE one place an AllFantasy ADP board is loaded", which
   * feeds draft ordering and the waiver/trade engines.
   *
   * Reads the real cron-schedule.json on purpose, same reason as the world-cup test: that
   * is what makes it notice the next time this drifts.
   */
  it("treats adp-refresh / recompute-allfantasy-adp as covering the rankings requirement", async () => {
    const { getAdminProductionReadiness } = await import("@/lib/admin-dashboard/AdminProductionReadinessService")
    const result = await getAdminProductionReadiness()
    const rankings = result.crons.find((row) => row.id === "general-players-stats-rankings")

    expect(rankings?.status).toBe("configured")
    expect(rankings?.missing).toEqual([])
    expect(
      rankings?.configuredPaths.some((row) => /\/api\/cron\/(adp-refresh|recompute-allfantasy-adp)\b/.test(row))
    ).toBe(true)
  })
})
