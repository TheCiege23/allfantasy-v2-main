import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  playerSeasonStats: { count: vi.fn(), findFirst: vi.fn() },
  playerGameStat: { count: vi.fn(), findFirst: vi.fn() },
  playerGameFact: { count: vi.fn(), findFirst: vi.fn() },
  statIngestionJob: { findFirst: vi.fn() },
  sportsPlayerRecord: { findMany: vi.fn() },
  sportsTeam: { findMany: vi.fn() },
}))

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

function primeHealthy() {
  prismaMock.playerSeasonStats.count.mockResolvedValue(1000)
  prismaMock.playerSeasonStats.findFirst.mockResolvedValue({ fetchedAt: new Date("2026-09-01T00:00:00.000Z") })
  prismaMock.playerGameStat.count.mockResolvedValue(2000)
  prismaMock.playerGameStat.findFirst.mockResolvedValue({ updatedAt: new Date("2026-09-02T00:00:00.000Z") })
  prismaMock.playerGameFact.count.mockResolvedValue(3000)
  prismaMock.playerGameFact.findFirst.mockResolvedValue({ createdAt: new Date("2026-09-03T00:00:00.000Z") })
  prismaMock.statIngestionJob.findFirst.mockImplementation(async ({ where }: { where: { status: string } }) =>
    where.status === "completed"
      ? { completedAt: new Date("2026-09-03T01:00:00.000Z") }
      : { completedAt: new Date("2026-09-02T12:00:00.000Z"), errorMessage: "timeout" },
  )
  prismaMock.sportsPlayerRecord.findMany.mockResolvedValue([
    { team: "ABC" },
    { team: "ZZZ" }, // unmapped
    { team: "FA" }, // free agent, excluded regardless of mapping
  ])
  prismaMock.sportsTeam.findMany.mockResolvedValue([{ shortName: "ABC" }])
}

describe("getSportsP0PipelineHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    primeHealthy()
  })

  it("reports real values for every metric when all queries succeed", async () => {
    const { getSportsP0PipelineHealth } = await import("@/lib/admin-dashboard/SportsP0PipelineHealthService")
    const health = await getSportsP0PipelineHealth()

    expect(health.playerSeasonStats).toEqual({ rowCount: 1000, newestUpdatedAt: "2026-09-01T00:00:00.000Z" })
    expect(health.playerGameStat).toEqual({ rowCount: 2000, newestUpdatedAt: "2026-09-02T00:00:00.000Z" })
    expect(health.playerGameFact).toEqual({ rowCount: 3000, newestUpdatedAt: "2026-09-03T00:00:00.000Z" })
    expect(health.statIngestionJobs).toEqual({
      lastSucceededAt: "2026-09-03T01:00:00.000Z",
      lastFailedAt: "2026-09-02T12:00:00.000Z",
      lastFailureMessage: "timeout",
    })
    expect(health.collegeTeamNormalization.unmappedTeamCodeCount).toBe(1) // ZZZ only; FA excluded
  })

  it("THE ACTUAL BUG: one failing query no longer zeroes out the other nine metrics", async () => {
    // sportsTeam.findMany (feeds only collegeTeamNormalization) throws. Before this fix, the
    // single shared Promise.all().catch() would have reported playerSeasonStats/playerGameStat/
    // playerGameFact — completely unrelated tables — as rowCount: 0, newestUpdatedAt: null too.
    prismaMock.sportsTeam.findMany.mockRejectedValue(new Error("connection reset"))

    const { getSportsP0PipelineHealth } = await import("@/lib/admin-dashboard/SportsP0PipelineHealthService")
    const health = await getSportsP0PipelineHealth()

    expect(health.playerSeasonStats).toEqual({ rowCount: 1000, newestUpdatedAt: "2026-09-01T00:00:00.000Z" })
    expect(health.playerGameStat).toEqual({ rowCount: 2000, newestUpdatedAt: "2026-09-02T00:00:00.000Z" })
    expect(health.playerGameFact).toEqual({ rowCount: 3000, newestUpdatedAt: "2026-09-03T00:00:00.000Z" })
    expect(health.statIngestionJobs.lastSucceededAt).toBe("2026-09-03T01:00:00.000Z")
  })

  it("the failing query's OWN metric falls back safely and records a note", async () => {
    prismaMock.sportsTeam.findMany.mockRejectedValue(new Error("connection reset"))

    const { getSportsP0PipelineHealth } = await import("@/lib/admin-dashboard/SportsP0PipelineHealthService")
    const health = await getSportsP0PipelineHealth()

    // knownCodes is empty (sportsTeam fetch failed), so nothing can be "known" -- every non-FA
    // row reports as unmapped rather than silently treating the failure as "everything's fine".
    expect(health.collegeTeamNormalization.unmappedTeamCodeCount).toBe(2) // ABC and ZZZ
    expect(health.notes.some((n) => n.includes("sportsTeam.findMany") && n.includes("connection reset"))).toBe(true)
  })

  it("does not add a failure note when every query succeeds", async () => {
    const { getSportsP0PipelineHealth } = await import("@/lib/admin-dashboard/SportsP0PipelineHealthService")
    const health = await getSportsP0PipelineHealth()

    expect(health.notes.some((n) => n.includes("query failed"))).toBe(false)
  })

  it("multiple independent failures each fall back on their own, without masking the others", async () => {
    prismaMock.playerGameStat.count.mockRejectedValue(new Error("stats db down"))
    // statIngestionJob.findFirst backs BOTH the completed- and failed-status lookups, so
    // rejecting it unconditionally fails both independently -- 3 failing calls in total.
    prismaMock.statIngestionJob.findFirst.mockRejectedValue(new Error("jobs table locked"))

    const { getSportsP0PipelineHealth } = await import("@/lib/admin-dashboard/SportsP0PipelineHealthService")
    const health = await getSportsP0PipelineHealth()

    expect(health.playerGameStat.rowCount).toBe(0)
    expect(health.statIngestionJobs).toEqual({ lastSucceededAt: null, lastFailedAt: null, lastFailureMessage: null })
    // Unrelated metrics are untouched by either failure.
    expect(health.playerSeasonStats.rowCount).toBe(1000)
    expect(health.playerGameFact.rowCount).toBe(3000)
    expect(health.notes.filter((n) => n.includes("query failed"))).toHaveLength(3)
  })
})
