import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  canCall: vi.fn(),
  runScheduleImporter: vi.fn(),
  runInjuryImporter: vi.fn(),
  runNewsImporter: vi.fn(),
  runSportsDataImporter: vi.fn(),
  recordProviderSync: vi.fn(),
  getSportsIdentityHealthSnapshot: vi.fn(),
}))

vi.mock("@/lib/workers/rate-limit-manager", () => ({
  rateLimitManager: { canCall: mocks.canCall },
}))

vi.mock("@/lib/workers/schedule-importer", () => ({
  runScheduleImporter: mocks.runScheduleImporter,
}))

vi.mock("@/lib/workers/injury-importer", () => ({
  runInjuryImporter: mocks.runInjuryImporter,
}))

vi.mock("@/lib/workers/news-importer", () => ({
  runNewsImporter: mocks.runNewsImporter,
}))

vi.mock("@/lib/workers/sports-data-importer", () => ({
  runSportsDataImporter: mocks.runSportsDataImporter,
}))

vi.mock("@/lib/provider-sync-logger", () => ({
  recordProviderSync: mocks.recordProviderSync,
}))

vi.mock("@/lib/sports-reporting/SportsIdentityHealthService", () => ({
  getSportsIdentityHealthSnapshot: mocks.getSportsIdentityHealthSnapshot,
}))

describe("admin sports sync actions", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.canCall.mockResolvedValue(true)
    mocks.getSportsIdentityHealthSnapshot.mockResolvedValue({
      summary: { identityProblems: 7, imageProblems: 11, providerMappingProblems: 3, sportsAudited: 2 },
      rows: [{ sport: "NFL" }, { sport: "MLB" }],
      imageRows: [{ sport: "NFL" }, { sport: "MLB" }],
      providerRows: [{ sport: "NFL", provider: "Sleeper" }],
    })
  })

  it("adds cache-only identity/image/fantasy value actions to dry-run planning", async () => {
    const { runAdminSportsSync } = await import("@/lib/admin-dashboard/AdminSportsSyncService")

    const result = await runAdminSportsSync({ type: "all", dryRun: true, sports: ["NFL"] })

    expect(result.ok).toBe(true)
    expect(result.jobs.map((job) => job.type)).toEqual(
      expect.arrayContaining(["identity_health", "image_audit", "fantasy_value_snapshots"])
    )
    expect(mocks.runScheduleImporter).not.toHaveBeenCalled()
    expect(mocks.getSportsIdentityHealthSnapshot).not.toHaveBeenCalled()
  })

  it("runs image audit from cached metadata without provider importers", async () => {
    const { runAdminSportsSync } = await import("@/lib/admin-dashboard/AdminSportsSyncService")

    const result = await runAdminSportsSync({ type: "image_audit", dryRun: false })

    expect(result.ok).toBe(true)
    expect(result.jobs[0]).toMatchObject({
      type: "image_audit",
      imported: 0,
      warning: expect.stringMatching(/External image URLs were not probed/i),
    })
    expect(mocks.getSportsIdentityHealthSnapshot).toHaveBeenCalledTimes(1)
    expect(mocks.runScheduleImporter).not.toHaveBeenCalled()
    expect(mocks.runInjuryImporter).not.toHaveBeenCalled()
    expect(mocks.runNewsImporter).not.toHaveBeenCalled()
    expect(mocks.runSportsDataImporter).not.toHaveBeenCalled()
  })
})
