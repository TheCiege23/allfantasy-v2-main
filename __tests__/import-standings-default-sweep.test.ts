import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/*
 * The scheduled registry entry calls /api/cron/import-standings with NO `sport` parameter, and
 * the registry is full (60 of 60), so the default sweep is the ONLY way a sport's standings get
 * written. NCAAF sat outside it — its writer ran only on an explicit `?sport=NCAAF` nothing
 * passed — and college standings were never written. This pins the default list.
 */

const syncEspn = vi.hoisted(() => vi.fn())

vi.mock("@/app/api/cron/_auth", () => ({ requireCronAuth: () => true }))
vi.mock("@/lib/standings/espnStandings", () => ({ syncEspnStandingsToDb: syncEspn }))
vi.mock("@/lib/api-sports", () => ({
  syncAPISportsStandingsToDb: vi.fn(async () => 0),
  clearAPISportsDiagnostics: vi.fn(),
  getAPISportsDiagnostics: vi.fn(() => ({})),
}))
vi.mock("@/lib/production-health/syncJobRunTelemetry", () => ({
  withSyncJobRun: async (_ctx: unknown, work: () => Promise<unknown>) => work(),
}))

describe("/api/cron/import-standings — the scheduled (parameterless) sweep", () => {
  beforeEach(() => {
    syncEspn.mockReset()
    syncEspn.mockImplementation(async ({ sport }: { sport: string }) => ({
      sport,
      fetched: 1,
      written: 1,
      skipped: 0,
      errors: [],
    }))
  })

  it("writes standings for every sport the product reports on, college included", async () => {
    const { GET } = await import("@/app/api/cron/import-standings/route")
    const res = await GET(new NextRequest("http://localhost/api/cron/import-standings"))
    const body = await res.json()

    const swept = syncEspn.mock.calls.map((call) => call[0].sport)
    expect(swept).toEqual(["NFL", "MLB", "NCAAF", "NBA", "NHL", "NCAAB"])
    expect(body.ok).toBe(true)
    expect(body.emptySports).toEqual([])
  })

  it("still pins an explicit ?sport=NCAAB to that one sport", async () => {
    const { GET } = await import("@/app/api/cron/import-standings/route")
    await GET(new NextRequest("http://localhost/api/cron/import-standings?sport=ncaab"))
    expect(syncEspn.mock.calls.map((call) => call[0].sport)).toEqual(["NCAAB"])
  })

  it("reports a sport that wrote nothing as a failure, by name", async () => {
    syncEspn.mockImplementation(async ({ sport }: { sport: string }) => ({
      sport,
      fetched: 0,
      written: sport === "NCAAB" ? 0 : 1,
      skipped: 0,
      errors: [],
    }))
    const { GET } = await import("@/app/api/cron/import-standings/route")
    const res = await GET(new NextRequest("http://localhost/api/cron/import-standings"))
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.emptySports).toEqual(["NCAAB"])
  })
})
