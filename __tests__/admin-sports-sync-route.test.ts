import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  requireAdminOrBearer: vi.fn(),
  runAdminSportsSync: vi.fn(),
  getAdminPerSportDataReliabilityRows: vi.fn(),
  getSportImportMatrix: vi.fn(),
  getDashboardAiToolAvailability: vi.fn(),
  getPlayerGameLogHealthDashboard: vi.fn(),
  getSportsP0PipelineHealth: vi.fn(),
}))

vi.mock("@/lib/adminAuth", () => ({
  requireAdminOrBearer: mocks.requireAdminOrBearer,
}))

vi.mock("@/lib/admin-dashboard/AdminSportsSyncService", () => ({
  runAdminSportsSync: mocks.runAdminSportsSync,
}))

vi.mock("@/lib/admin-dashboard/AdminProviderHealthService", () => ({
  getAdminPerSportDataReliabilityRows: mocks.getAdminPerSportDataReliabilityRows,
}))

vi.mock("@/lib/admin-dashboard/SportImportMatrixService", () => ({
  getSportImportMatrix: mocks.getSportImportMatrix,
  getDashboardAiToolAvailability: mocks.getDashboardAiToolAvailability,
}))

// The GET status payload gained these two health reads after this suite was written; unmocked,
// they reached the real Prisma client from a unit test.
vi.mock("@/lib/sports-reporting/PlayerGameLogImportService", () => ({
  getPlayerGameLogHealthDashboard: mocks.getPlayerGameLogHealthDashboard,
}))

vi.mock("@/lib/admin-dashboard/SportsP0PipelineHealthService", () => ({
  getSportsP0PipelineHealth: mocks.getSportsP0PipelineHealth,
}))

function req(url: string, init?: RequestInit) {
  return new NextRequest(url, init)
}

describe("/api/admin/sports/sync", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.requireAdminOrBearer.mockResolvedValue({ ok: true, userId: "admin-1" })
    mocks.getAdminPerSportDataReliabilityRows.mockResolvedValue([])
    mocks.getSportImportMatrix.mockReturnValue([])
    mocks.getDashboardAiToolAvailability.mockReturnValue([])
    mocks.getPlayerGameLogHealthDashboard.mockResolvedValue({ generatedAt: "t", rows: [] })
    mocks.getSportsP0PipelineHealth.mockResolvedValue({ rows: [] })
  })

  it("blocks unauthenticated/non-admin callers server-side", async () => {
    mocks.requireAdminOrBearer.mockResolvedValueOnce({
      ok: false,
      res: Response.json({ error: "Unauthorized" }, { status: 401 }),
    })
    const { GET } = await import("@/app/api/admin/sports/sync/route")

    const response = await GET(req("http://localhost/api/admin/sports/sync"))

    expect(response.status).toBe(401)
    expect(mocks.getAdminPerSportDataReliabilityRows).not.toHaveBeenCalled()
  })

  it("returns current import matrix and AI tool availability for admins", async () => {
    mocks.getSportImportMatrix.mockReturnValueOnce([{ id: "nfl" }])
    mocks.getDashboardAiToolAvailability.mockReturnValueOnce([{ id: "startSit" }])
    const { GET } = await import("@/app/api/admin/sports/sync/route")

    const response = await GET(req("http://localhost/api/admin/sports/sync"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.importMatrix).toEqual([{ id: "nfl" }])
    expect(body.aiToolAvailability).toEqual([{ id: "startSit" }])
    expect(body.playerGameLogHealth).toEqual({ generatedAt: "t", rows: [] })
    expect(body.p0PipelineHealth).toEqual({ rows: [] })
  })

  it("runs dry-run admin sync without exposing provider keys", async () => {
    mocks.runAdminSportsSync.mockResolvedValueOnce({
      ok: true,
      type: "schedules",
      sports: ["NBA"],
      dryRun: true,
      jobs: [{ type: "schedules", imported: 0, sports: ["NBA"], warning: "Dry run only." }],
      warnings: [],
      blockedByBudget: [],
    })
    const { POST } = await import("@/app/api/admin/sports/sync/route")

    const response = await POST(
      req("http://localhost/api/admin/sports/sync", {
        method: "POST",
        body: JSON.stringify({ type: "schedules", sports: ["NBA"], dryRun: true }),
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.runAdminSportsSync).toHaveBeenCalledWith({
      type: "schedules",
      sports: ["NBA"],
      season: null,
      dryRun: true,
    })
    expect(JSON.stringify(body)).not.toMatch(/API_KEY|SECRET|sk-/i)
  })
})
