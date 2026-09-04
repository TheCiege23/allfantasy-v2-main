import { describe, expect, it } from "vitest"
import {
  analyzeGroundedTrade,
  buildGroundedCommissionerReport,
  recommendGroundedDraftPicks,
} from "@/lib/sports-reporting/GroundedSportsOsTools"
import type { FantasyValueSnapshot } from "@/lib/sports-reporting/FantasyValueSnapshotService"

function snapshot(overrides: Partial<FantasyValueSnapshot> & { playerName: string }): FantasyValueSnapshot {
  return {
    sport: "NFL",
    playerId: overrides.playerId ?? overrides.playerName.toLowerCase().replace(/\s+/g, "-"),
    playerName: overrides.playerName,
    position: overrides.position ?? "RB",
    team: overrides.team ?? "DAL",
    leagueFormat: overrides.leagueFormat ?? "redraft",
    scoringFormat: overrides.scoringFormat ?? "ppr",
    shortTermValue: "shortTermValue" in overrides ? overrides.shortTermValue ?? null : 70,
    longTermValue: "longTermValue" in overrides ? overrides.longTermValue ?? null : 70,
    riskScore: "riskScore" in overrides ? overrides.riskScore ?? null : 10,
    injuryRisk: overrides.injuryRisk ?? "low",
    roleConfidence: overrides.roleConfidence ?? 80,
    dataFreshness: overrides.dataFreshness ?? { latestAt: new Date().toISOString(), stale: false, staleDomains: [] },
    sourcesUsed: overrides.sourcesUsed ?? ["test-cache"],
    missingData: overrides.missingData ?? [],
    confidence: overrides.confidence ?? 0.85,
  }
}

describe("grounded Sports OS tools", () => {
  it("grounds trade analysis in resolved player value snapshots", async () => {
    const lookup = new Map([
      ["Player One", snapshot({ playerName: "Player One", shortTermValue: 60, longTermValue: 95 })],
      ["Player Two", snapshot({ playerName: "Player Two", shortTermValue: 78, longTermValue: 70 })],
    ])

    const result = await analyzeGroundedTrade({
      sport: "NFL",
      leagueFormat: "dynasty",
      sideA: [{ playerName: "Player One" }],
      sideB: [{ playerName: "Player Two" }],
      snapshotLoader: async (request) => lookup.get(request.playerName ?? "")!,
    })

    expect(result.status).toBe("ready")
    expect(result.recommendation).toBe("reject")
    expect(result.snapshots.sideA[0]?.playerName).toBe("Player One")
    expect(result.tokenCharge.canCharge).toBe(true)
  })

  it("changes trade valuation when dynasty long-term value matters more than redraft", async () => {
    const lookup = new Map([
      ["Young Star", snapshot({ playerName: "Young Star", shortTermValue: 60, longTermValue: 95 })],
      ["Win Now Vet", snapshot({ playerName: "Win Now Vet", shortTermValue: 90, longTermValue: 45 })],
    ])
    const loader = async (request: { playerName?: string | null }) => lookup.get(request.playerName ?? "")!

    const dynasty = await analyzeGroundedTrade({
      sport: "NFL",
      leagueFormat: "dynasty",
      sideA: [{ playerName: "Young Star" }],
      sideB: [{ playerName: "Win Now Vet" }],
      snapshotLoader: loader as any,
    })
    const redraft = await analyzeGroundedTrade({
      sport: "NFL",
      leagueFormat: "redraft",
      sideA: [{ playerName: "Young Star" }],
      sideB: [{ playerName: "Win Now Vet" }],
      snapshotLoader: loader as any,
    })

    expect(dynasty.recommendation).toBe("reject")
    expect(redraft.recommendation).toBe("accept")
  })

  it("refuses unsupported trade claims and blocks token charge when cached value is missing", async () => {
    const result = await analyzeGroundedTrade({
      sport: "MLB",
      leagueFormat: "redraft",
      sideA: [{ playerName: "Unknown One" }],
      sideB: [{ playerName: "Unknown Two" }],
      snapshotLoader: async (request) =>
        snapshot({
          playerName: request.playerName ?? "Unknown",
          playerId: null,
          shortTermValue: null,
          longTermValue: null,
          riskScore: null,
          injuryRisk: "unknown",
          missingData: ["short-term projection/stat value", "long-term/dynasty value", "injury status"],
          confidence: 0.2,
        }),
    })

    expect(result.status).toBe("unsupported")
    expect(result.recommendation).toBe("insufficient_data")
    expect(result.tokenCharge.canCharge).toBe(false)
  })

  it("grounds draft advice and lets rookie/dynasty weighting differ from redraft", async () => {
    const lookup = new Map([
      ["Rookie Upside", snapshot({ playerName: "Rookie Upside", position: "WR", shortTermValue: 55, longTermValue: 95 })],
      ["Steady Vet", snapshot({ playerName: "Steady Vet", position: "WR", shortTermValue: 82, longTermValue: 55 })],
    ])
    const loader = async (request: { playerName?: string | null }) => lookup.get(request.playerName ?? "")!

    const rookieDraft = await recommendGroundedDraftPicks({
      sport: "NFL",
      leagueFormat: "dynasty",
      draftType: "rookie",
      rosterNeeds: ["WR"],
      candidates: [{ playerName: "Rookie Upside" }, { playerName: "Steady Vet" }],
      snapshotLoader: loader as any,
    })
    const redraft = await recommendGroundedDraftPicks({
      sport: "NFL",
      leagueFormat: "redraft",
      draftType: "snake",
      rosterNeeds: ["WR"],
      candidates: [{ playerName: "Rookie Upside" }, { playerName: "Steady Vet" }],
      snapshotLoader: loader as any,
    })

    expect(rookieDraft.recommendations[0]?.playerName).toBe("Rookie Upside")
    expect(redraft.recommendations[0]?.playerName).toBe("Steady Vet")
  })

  it("does not charge for unsupported draft advice when ADP/rankings/value are absent", async () => {
    const result = await recommendGroundedDraftPicks({
      sport: "NCAAB",
      leagueFormat: "redraft",
      draftType: "snake",
      candidates: [{ playerName: "Unknown Guard" }],
      snapshotLoader: async (request) =>
        snapshot({
          playerName: request.playerName ?? "Unknown Guard",
          shortTermValue: null,
          longTermValue: null,
          missingData: ["short-term projection/stat value", "long-term/dynasty value"],
          confidence: 0.15,
        }),
    })

    expect(result.status).toBe("unsupported")
    expect(result.recommendations).toHaveLength(0)
    expect(result.tokenCharge.canCharge).toBe(false)
  })

  it("generates commissioner reports only for AF Commissioner/admin/token access and uses real pool data", () => {
    const blocked = buildGroundedCommissionerReport({
      access: { isPoolOwner: true },
      pool: {
        poolName: "World Cup Pool",
        memberCount: 12,
        finalizedEntryCount: 8,
        inviteSentCount: 20,
        inviteAcceptedCount: 10,
      },
    })
    expect(blocked.status).toBe("blocked")
    expect(blocked.tokenCharge.canCharge).toBe(false)
    expect(blocked.accessReason).toMatch(/AF Commissioner/i)

    const report = buildGroundedCommissionerReport({
      access: { isPoolOwner: true, hasAfCommissioner: true },
      pool: {
        poolName: "World Cup Pool",
        memberCount: 12,
        finalizedEntryCount: 8,
        inviteSentCount: 20,
        inviteAcceptedCount: 10,
        chatMessageCount: 14,
        leaderboard: [{ username: "TheCiege26", rank: 1, points: 42 }],
        incompleteBrackets: [{ username: "member1" }, { username: "member2" }],
      },
    })

    expect(report.status).toBe("ready")
    expect(report.metrics).toMatchObject({
      memberCount: 12,
      finalizedEntryCount: 8,
      inviteAcceptedCount: 10,
      inviteAcceptanceRate: 50,
      incompleteBracketCount: 2,
      chatMessageCount: 14,
    })
    expect(report.lines.join(" ")).toMatch(/TheCiege26/)
    expect(report.suggestedAnnouncement).toMatch(/finalize/i)
    expect(report.tokenCharge.canCharge).toBe(true)
  })
})
