/**
 * Player Command Center (Slice 3) — deterministic urgency layer.
 */
import { describe, expect, it } from "vitest"
import {
  computePlayerUrgency,
  maxUrgency,
  urgencyRank,
} from "@/lib/shared-services/league-hub/playerUrgency"
import type { CrossLeaguePlayerPortfolioItem } from "@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio"

const NOW = new Date("2026-09-13T16:00:00.000Z") // Sunday morning ET

function makeItem(overrides: {
  injuryStatus?: CrossLeaguePlayerPortfolioItem["injury"] extends infer I
    ? I extends { status: infer S }
      ? S
      : never
    : never
  nextGameAt?: string | null
  appearances: Array<{
    leagueId: string
    rosterStatus: string
    recPriority?: "critical" | "high" | "medium" | "low"
  }>
}): CrossLeaguePlayerPortfolioItem {
  return {
    canonicalPlayerId: "p1",
    displayName: "Test Player",
    sport: "NFL",
    position: "WR",
    professionalTeam: "DET",
    identityConfidence: "verified",
    headshotUrl: null,
    projection: null,
    injury: overrides.injuryStatus ? { status: overrides.injuryStatus, freshness: { state: "fresh", lastSyncedAt: null } } : null,
    schedule:
      overrides.nextGameAt !== undefined
        ? { byeWeek: null, nextOpponent: "CHI", nextGameAt: overrides.nextGameAt, gamesNext7Days: null, freshness: { state: "fresh", lastSyncedAt: null } }
        : null,
    exposure: {
      leagueCount: overrides.appearances.length,
      rosterCount: overrides.appearances.length,
      starterCount: 0,
      benchCount: 0,
      injuredReserveCount: 0,
      taxiCount: 0,
      percentageOfUserLeagues: 1,
    },
    leagueAppearances: overrides.appearances.map((a) => ({
      canonicalLeagueId: a.leagueId,
      leagueName: `League ${a.leagueId}`,
      provider: "sleeper",
      playerId: "raw-1",
      sport: "NFL",
      season: 2026,
      canonicalTeamId: null,
      teamName: null,
      rosterStatus: a.rosterStatus as never,
      leagueFormat: null,
      record: null,
      standing: null,
      recommendation: a.recPriority
        ? ({ id: "r1", leagueId: a.leagueId, domain: "lineup", type: "injured_starter", priority: a.recPriority } as never)
        : null,
      executionCapability: "recommendation_only",
      syncFreshness: { state: "fresh", lastSyncedAt: null },
    })),
    actionSummary: { criticalCount: 0, highCount: 0, topAction: null },
  } as CrossLeaguePlayerPortfolioItem
}

describe("computePlayerUrgency", () => {
  it("OUT starter with kickoff in 65 minutes is CRITICAL", () => {
    const item = makeItem({
      injuryStatus: "out",
      nextGameAt: new Date(NOW.getTime() + 65 * 60_000).toISOString(),
      appearances: [{ leagueId: "L1", rosterStatus: "starter" }],
    })
    const u = computePlayerUrgency(item, NOW)
    expect(u.overall).toBe("critical")
    expect(u.urgentLeagueCount).toBe(1)
    expect(u.minutesToLock).toBe(65)
    expect(u.appearances[0]!.actionRequired).toBe(true)
    expect(u.appearances[0]!.reasons.join(" ")).toMatch(/not expected to play/)
  })

  it("same injury, same kickoff, but BENCHED in another league → that league is low, not critical", () => {
    const item = makeItem({
      injuryStatus: "out",
      nextGameAt: new Date(NOW.getTime() + 65 * 60_000).toISOString(),
      appearances: [
        { leagueId: "L1", rosterStatus: "starter" },
        { leagueId: "L2", rosterStatus: "bench" },
        { leagueId: "L3", rosterStatus: "ir" },
      ],
    })
    const u = computePlayerUrgency(item, NOW)
    expect(u.appearances.map((a) => a.level)).toEqual(["critical", "low", "none"])
    expect(u.urgentLeagueCount).toBe(1)
  })

  it("OUT starter with a Monday-night game (30h away) is HIGH, not critical", () => {
    const item = makeItem({
      injuryStatus: "out",
      nextGameAt: new Date(NOW.getTime() + 30 * 60 * 60_000).toISOString(),
      appearances: [{ leagueId: "L1", rosterStatus: "starter" }],
    })
    expect(computePlayerUrgency(item, NOW).overall).toBe("high")
  })

  it("questionable starter far from kickoff is LOW; no schedule data stays honest (null lock)", () => {
    const item = makeItem({
      injuryStatus: "questionable",
      nextGameAt: null,
      appearances: [{ leagueId: "L1", rosterStatus: "starter" }],
    })
    const u = computePlayerUrgency(item, NOW)
    expect(u.overall).toBe("low")
    expect(u.nextLockAt).toBeNull()
    expect(u.minutesToLock).toBeNull()
  })

  it("healthy bench player with a critical league recommendation still surfaces HIGH", () => {
    const item = makeItem({
      nextGameAt: new Date(NOW.getTime() + 5 * 60 * 60_000).toISOString(),
      appearances: [{ leagueId: "L1", rosterStatus: "bench", recPriority: "critical" }],
    })
    const u = computePlayerUrgency(item, NOW)
    expect(u.overall).toBe("high")
    expect(u.appearances[0]!.reasons.join(" ")).toMatch(/flagged critical/)
  })

  it("already-kicked-off games apply no time pressure (past lock = nothing to do)", () => {
    const item = makeItem({
      injuryStatus: "out",
      nextGameAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
      appearances: [{ leagueId: "L1", rosterStatus: "starter" }],
    })
    const u = computePlayerUrgency(item, NOW)
    expect(u.overall).toBe("medium")
    expect(u.nextLockAt).toBeNull()
  })
})

describe("urgency helpers", () => {
  it("maxUrgency and urgencyRank order levels correctly", () => {
    expect(maxUrgency("low", "high")).toBe("high")
    expect(maxUrgency("critical", "high")).toBe("critical")
    expect(urgencyRank("critical")).toBeGreaterThan(urgencyRank("high"))
    expect(urgencyRank("none")).toBe(0)
  })
})
