import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMockNextRequest } from "./helpers/createMockNextRequest"

const requireAdminOrBearerMock = vi.fn()
const syncPlayerWeeklyScoresForRedraftSeasonMock = vi.fn()
const recalculateMatchupsForSeasonWeekMock = vi.fn()
const updateStandingsMock = vi.fn()

vi.mock("@/lib/adminAuth", () => ({
  requireAdminOrBearer: requireAdminOrBearerMock,
}))
vi.mock('@/lib/pirate/lineupEvidence', () => ({ capturePirateLineupEvidence: vi.fn() }))
vi.mock('@/lib/pirate/service', () => ({ seedPirateClaims: vi.fn(), queuePirateProtectionReminders: vi.fn(), maintainPirateClaims: vi.fn() }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    league: { findMany: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    zombieLeague: { findMany: vi.fn() },
    c2CLeague: { findMany: vi.fn() },
    redraftMatchup: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/c2c/scoringEngine", () => ({
  updateC2CMatchupScores: vi.fn(),
}))

vi.mock("@/lib/survivor/gameStateMachine", () => ({
  syncWeeklyScores: vi.fn(),
}))

vi.mock("@/lib/zombie/matchupCompletion", () => ({
  getZombieWeekReadiness: vi.fn(),
}))

vi.mock("@/lib/zombie/weeklyResolutionEngine", () => ({
  runWeeklyResolution: vi.fn(),
}))

vi.mock("@/lib/zombie/ZombieLeagueConfig", () => ({
  getZombieLeagueConfig: vi.fn(),
}))

vi.mock("@/lib/redraft/playerWeeklyScoreService", () => ({
  syncPlayerWeeklyScoresForRedraftSeason: syncPlayerWeeklyScoresForRedraftSeasonMock,
}))

vi.mock("@/lib/redraft/scoringEngine", () => ({
  recalculateMatchupsForSeasonWeek: recalculateMatchupsForSeasonWeekMock,
}))

vi.mock("@/lib/redraft/standingsEngine", () => ({
  updateStandings: updateStandingsMock,
}))

describe("redraft score-sync route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAdminOrBearerMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } })
    syncPlayerWeeklyScoresForRedraftSeasonMock.mockResolvedValue({
      leagueId: "league-1",
      seasonId: "season-1",
      sport: "NFL",
      season: 2026,
      week: 1,
      scoresUpserted: 2,
    })
    recalculateMatchupsForSeasonWeekMock.mockResolvedValue({ matchupsUpdated: 1 })
    updateStandingsMock.mockResolvedValue({ rostersUpdated: 2 })
  })

  it("uses PlayerGameLogCache-backed weekly score sync before matchup and standings recalculation", async () => {
    const { POST } = await import("../app/api/redraft/score-sync/route")
    const req = createMockNextRequest("http://localhost/api/redraft/score-sync", {
      method: "POST",
      body: { leagueId: "league-1", week: 1 },
    })

    const res = await POST(req as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe("synced")
    expect(syncPlayerWeeklyScoresForRedraftSeasonMock).toHaveBeenCalledWith({
      leagueId: "league-1",
      seasonId: undefined,
      week: 1,
      actorId: "admin-1",
    })
    expect(recalculateMatchupsForSeasonWeekMock).toHaveBeenCalledWith("season-1", 1)
    expect(updateStandingsMock).toHaveBeenCalledWith("season-1", 1)
  })

  it("returns unavailable instead of fabricating scores when cache rows are missing", async () => {
    syncPlayerWeeklyScoresForRedraftSeasonMock.mockResolvedValueOnce({
      leagueId: "league-1",
      seasonId: "season-1",
      sport: "NFL",
      season: 2026,
      week: 1,
      scoresUpserted: 0,
    })

    const { POST } = await import("../app/api/redraft/score-sync/route")
    const req = createMockNextRequest("http://localhost/api/redraft/score-sync", {
      method: "POST",
      body: { seasonId: "season-1", week: 1 },
    })

    const res = await POST(req as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe("unavailable")
    expect(body.message).toContain("No cached NFL weekly stats")
  })
})
