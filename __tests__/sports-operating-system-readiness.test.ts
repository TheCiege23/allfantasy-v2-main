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


describe("Sports OS readiness — reads the measured identity health, not constants", () => {
  function snapshot(overrides: {
    imageRows?: Array<{ id: string; label: string; playersMissingHeadshots: number; playersAudited: number; teamsMissingLogos: number }>
    providerRows?: Array<{ label: string; provider: string; unmappedProviderPlayers: number; status: string }>
    providerMappingProblems?: number
  }) {
    return {
      generatedAt: "2026-09-22T13:00:00.000Z",
      summary: {
        sportsAudited: 1,
        totalPlayers: 100,
        totalTeams: 32,
        identityProblems: 0,
        imageProblems: 0,
        providerMappingProblems: overrides.providerMappingProblems ?? 0,
        readySports: 1,
        partialSports: 0,
        missingSports: 0,
      },
      rows: [],
      imageRows: (overrides.imageRows ?? []).map((row) => ({
        sport: row.label,
        duplicateHeadshotGroups: 0,
        duplicateLogoGroups: 0,
        invalidHeadshotUrlPatterns: 0,
        invalidLogoUrlPatterns: 0,
        status: "ready" as const,
        topProblems: [],
        ...row,
      })),
      providerRows: (overrides.providerRows ?? []).map((row, i) => ({
        id: `p${i}`,
        sport: row.label,
        providerPlayerRows: 0,
        mappedPlayerIds: 0,
        providerTeamRows: 0,
        mappedTeamRows: 0,
        unmappedProviderTeams: 0,
        teamMappingMeasured: true,
        duplicatePlayerMappingGroups: 0,
        duplicateTeamMappingGroups: 0,
        ...row,
      })),
      topProblems: [],
    } as never
  }

  function auditWith(identityHealth: ReturnType<typeof snapshot>) {
    return buildSportsOperatingSystemAudit({
      importMatrix: [row("nfl", "NFL")],
      aiToolAvailability: tools,
      identityHealth,
    })
  }

  it("reads images Ready for a sport whose people nearly all have a photo and whose teams all have logos", () => {
    const result = auditWith(
      snapshot({ imageRows: [{ id: "nfl", label: "NFL", playersMissingHeadshots: 28, playersAudited: 12_218, teamsMissingLogos: 0 }] })
    )
    expect(result.sports.find((sport) => sport.id === "nfl")?.imageLogoStatus).toBe("ready")
  })

  it("keeps images Partial where a real share of people have no photo", () => {
    const result = auditWith(
      snapshot({ imageRows: [{ id: "nfl", label: "NFL", playersMissingHeadshots: 6_068, playersAudited: 7_314, teamsMissingLogos: 0 }] })
    )
    expect(result.sports.find((sport) => sport.id === "nfl")?.imageLogoStatus).toBe("partial")
  })

  it("lists the real unmapped provider pairs as the mapping card's gaps, largest first", () => {
    const result = auditWith(
      snapshot({
        providerMappingProblems: 52_158,
        providerRows: [
          { label: "NFL", provider: "Sleeper", unmappedProviderPlayers: 2_996, status: "partial" },
          { label: "NCAAF", provider: "Rolling Insights", unmappedProviderPlayers: 48_888, status: "partial" },
          { label: "NFL", provider: "CFBD", unmappedProviderPlayers: 0, status: "not_applicable" },
        ],
      })
    )
    const card = result.identityFindings.find((item) => item.id === "external-provider-mappings")
    expect(card?.status).toBe("partial")
    expect(card?.gaps[0]).toMatch(/^NCAAF Rolling Insights: 48888/)
    expect(card?.gaps.join(" ")).not.toMatch(/still aggregated/)
    expect(card?.evidence[0]).toMatch(/^2 provider\/sport pairs hold data/)
  })

  it("reads the mapping card Ready when nothing is unmapped", () => {
    const card = auditWith(snapshot({ providerMappingProblems: 0 })).identityFindings.find(
      (item) => item.id === "external-provider-mappings"
    )
    expect(card?.status).toBe("ready")
  })
})
