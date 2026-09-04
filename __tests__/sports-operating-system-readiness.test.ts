import { describe, expect, it } from "vitest"
import {
  buildSportsOperatingSystemAudit,
  type SportsOperatingSystemAudit,
} from "@/lib/sports-reporting/SportsOperatingSystemReadinessService"
import type {
  DashboardAiToolAvailability,
  SportImportMatrixCell,
  SportImportMatrixRow,
} from "@/lib/admin-dashboard/SportImportMatrixService"

function cell(
  label: string,
  status: SportImportMatrixCell["status"],
  count: number | null = null,
  lastSyncedAt: string | null = null
): SportImportMatrixCell {
  return {
    label,
    status,
    count,
    lastSyncedAt,
    providers: status === "not_tracked_yet" ? [] : ["test-provider"],
    storage: "test_cache",
    note: "test",
    stale: false,
  }
}

function row(id: string, label: string, overrides: Partial<SportImportMatrixRow["cells"]> = {}): SportImportMatrixRow {
  const ready = "active_importer" as const
  const missing = "not_tracked_yet" as const
  return {
    id,
    sport: id.toUpperCase(),
    label,
    cells: {
      teams: cell("Teams", ready, 30, "2026-06-04T12:00:00.000Z"),
      players: cell("Players", ready, 900, "2026-06-04T12:00:00.000Z"),
      schedules: cell("Schedules", ready, 100, "2026-06-04T12:00:00.000Z"),
      liveScores: cell("Live scores", ready, 20, "2026-06-04T12:00:00.000Z"),
      standings: cell("Standings", ready, 30, "2026-06-04T12:00:00.000Z"),
      injuries: cell("Injuries", missing),
      news: cell("News", missing),
      playerStats: cell("Player stats", ready, 2000, "2026-06-04T12:00:00.000Z"),
      projectionsRankings: cell("Projections/rankings", missing),
      odds: cell("Odds", missing),
      ...overrides,
    },
  }
}

const tools: DashboardAiToolAvailability[] = [
  {
    id: "trade",
    label: "Trade Value",
    status: "active",
    lastSyncedAt: "2026-06-04T12:00:00.000Z",
    supportedSports: ["NFL"],
    requiredAccess: "AF Pro or tokens.",
    missingData: [],
    note: "ready",
  },
  {
    id: "startSit",
    label: "Start/Sit",
    status: "preview",
    lastSyncedAt: null,
    supportedSports: ["NFL"],
    requiredAccess: "AF Pro or tokens.",
    missingData: ["Schedules"],
    note: "partial",
  },
  {
    id: "injury",
    label: "Injury Impact",
    status: "missing_data",
    lastSyncedAt: null,
    supportedSports: [],
    requiredAccess: "AF Pro or tokens.",
    missingData: ["Injuries"],
    note: "missing",
  },
  {
    id: "worldCupAnalysis",
    label: "World Cup Analysis",
    status: "preview",
    lastSyncedAt: null,
    supportedSports: ["World Cup"],
    requiredAccess: "AF Pro or tokens.",
    missingData: ["Standings"],
    note: "partial",
  },
]

function audit(): SportsOperatingSystemAudit {
  return buildSportsOperatingSystemAudit({
    importMatrix: [
      row("nfl", "NFL"),
      row("world-cup", "World Cup", {
        players: cell("Players", "not_tracked_yet"),
        teams: cell("Teams", "active_importer", 48, "2026-06-04T12:00:00.000Z"),
      }),
    ],
    aiToolAvailability: tools,
  })
}

describe("Sports Operating System readiness audit", () => {
  it("reports real data holes instead of pretending all sports data is ready", () => {
    const result = audit()

    expect(result.biggestDataHoles.join(" ")).toMatch(/Injuries incomplete/)
    expect(result.biggestDataHoles.join(" ")).toMatch(/News incomplete/)
    expect(result.summary.missing).toBeGreaterThan(0)
    expect(result.imageLogoFindings[0]?.status).toBe("partial")
  })

  it("reuses the existing specialty league registry for commissioner support", () => {
    const result = audit()
    const ids = result.leagueFormats.map((format) => format.id)

    expect(ids).toContain("dynasty")
    expect(ids).toContain("c2c")
    expect(ids).toContain("big_brother")
    expect(result.leagueFormats.find((format) => format.id === "c2c")?.premiumAiFeatures.length).toBeGreaterThan(0)
  })

  it("defines safe Chimmy intent routes for commissioner, bracket, injury, weather, and start/sit", () => {
    const result = audit()
    const intents = Object.fromEntries(result.chimmyIntentRoutes.map((route) => [route.intent, route]))

    expect(intents.commissioner?.targetEngine).toBe("Commissioner Copilot")
    expect(intents.bracket?.targetEngine).toBe("Bracket Intelligence")
    expect(intents.injury?.tokenPolicy).toMatch(/No charge|AF Pro\/tokens/i)
    expect(intents.weather?.status).toBe("partial")
    expect(intents.start_sit?.targetEngine).toBe("Lineup Advisor")
  })
})
