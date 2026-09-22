import { describe, expect, it, vi } from "vitest"
import { getSportImportMatrix } from "@/lib/admin-dashboard/SportImportMatrixService"
import { buildSportsOperatingSystemAudit } from "@/lib/sports-reporting/SportsOperatingSystemReadinessService"
import type { AdminSportDataReliabilityRow } from "@/lib/admin-dashboard/AdminProviderHealthService"

vi.mock("server-only", () => ({}))

/**
 * The admin per-sport grounding panel's "Missing" column, 2026-09-22.
 *
 * Every sport listed Projections/rankings as missing — NFL included — because its count was
 * hard-coded null, and soccer listed it although nothing can compute soccer projections.
 */
const T = "2026-09-20T12:00:00.000Z"

function reliability(id: string, sport: string, projections: number | null | undefined): AdminSportDataReliabilityRow {
  return {
    id,
    sport,
    label: sport,
    counts: {
      teams: 30,
      players: 900,
      schedules: 200,
      games: 200,
      liveScores: 10,
      standings: 30,
      injuries: 50,
      news: 50,
      playerStats: 500,
      ...(projections === undefined ? {} : { projections }),
    },
    lastSyncAtByType: {
      teams: T,
      players: T,
      schedules: T,
      games: T,
      injuries: T,
      news: T,
      playerStats: T,
      projections: projections ? T : null,
    },
    staleWarnings: [],
    configuredProviders: ["test"],
    missingProviders: [],
    note: "test",
  }
}

function missingFor(rows: AdminSportDataReliabilityRow[], id: string): string[] {
  const audit = buildSportsOperatingSystemAudit({ importMatrix: getSportImportMatrix(rows), aiToolAvailability: [] })
  return audit.sports.find((s) => s.id === id)?.missingData ?? []
}

describe("per-sport grounding detector", () => {
  it("projections read Ready once projection rows exist, on their own timestamp", () => {
    const [nfl] = getSportImportMatrix([reliability("nfl", "NFL", 4200)])
    expect(nfl?.cells.projectionsRankings).toMatchObject({ status: "active_importer", count: 4200, lastSyncedAt: T })
    expect(missingFor([reliability("nfl", "NFL", 4200)], "nfl")).not.toContain("Projections/rankings")
  })

  it("still reports projections missing where no rows exist", () => {
    expect(missingFor([reliability("mlb", "MLB", 0)], "mlb")).toContain("Projections/rankings")
  })

  it("soccer projections are not applicable, so they are not a gap", () => {
    expect(missingFor([reliability("soccer", "SOCCER", 0)], "soccer")).not.toContain("Projections/rankings")
  })
})
