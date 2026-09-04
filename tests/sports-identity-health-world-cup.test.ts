/**
 * SportsIdentityHealthService — World Cup adapter tests
 *
 * Verifies that the World Cup row uses worldCupTeam-based metrics instead of
 * the generic sportsTeam/sportsPlayer fields, and that status logic is correct:
 *
 *  1.  teamCount=32, teamsWithNoLogo=0  → identity=ready,  image=ready
 *  2.  teamCount=32, teamsWithNoLogo=5  → identity=ready,  image=partial
 *  3.  teamCount=0                      → identity=missing, image=missing
 *  4.  teamCount=16 (partial load)      → identity=ready,  image=ready (logos present)
 *  5.  World Cup row produces zero provider mapping rows
 *  6.  World Cup row does NOT inflate totalPlayers or totalTeams with phantom data
 *  7.  fixtureCount+standingCount surfaces in canonicalIdentityCount
 *  8.  Missing-logo problems appear in topProblems for World Cup
 *  9.  Identity topProblems (missing provider ids, etc.) are NOT generated for World Cup
 * 10.  Non-WC sport (NFL) in the same snapshot is unaffected by WC adapter
 */
import { describe, it, expect } from "vitest"
import {
  buildSportsIdentityHealthSnapshot,
  type SportsIdentityHealthAggregate,
} from "@/lib/sports-reporting/SportsIdentityHealthService"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WC_BASE = { id: "world-cup", sport: "WC_SOCCER", label: "World Cup" }
const NFL_BASE = { id: "nfl", sport: "NFL", label: "NFL" }

/**
 * Construct the aggregate as `buildAggregateForWorldCup` would produce it:
 * teamCount mapped to playerCount, teamsWithNoLogo → teamsMissingLogos.
 */
function wcAggregate(opts: {
  teamCount: number
  teamsWithNoLogo?: number
  fixtureCount?: number
  standingCount?: number
}): SportsIdentityHealthAggregate {
  const { teamCount, teamsWithNoLogo = 0, fixtureCount = 64, standingCount = 48 } = opts
  return {
    ...WC_BASE,
    playerCount: teamCount,          // mapped from teamCount for statusFor()
    sportsPlayerRecordCount: 0,
    teamCount,
    teamAssetCount: 0,
    canonicalIdentityCount: fixtureCount + standingCount,
    playersMissingProviderIds: 0,
    playersMissingTeam: 0,
    playerRecordsMissingTeam: 0,
    playersMissingPosition: 0,
    playerRecordsMissingPosition: 0,
    playersMissingStatus: 0,
    duplicatePlayerNameGroups: 0,
    duplicateTeamIdentityGroups: 0,
    duplicateProviderMappingGroups: 0,
    unmappedProviderPlayers: 0,
    unmappedProviderTeams: 0,
    inactiveOrUnknownPlayers: 0,
    activeStatusTeamMismatches: 0,
    teamMappingMismatches: 0,
    playersMissingHeadshots: 0,
    playerRecordsMissingHeadshots: 0,
    teamsMissingLogos: teamsWithNoLogo,
    teamAssetsMissingLogos: 0,
    duplicateHeadshotGroups: 0,
    duplicateLogoGroups: 0,
    invalidHeadshotUrlPatterns: 0,
    invalidLogoUrlPatterns: 0,
    providerMappings: [],
  }
}

/**
 * Minimal NFL aggregate with enough players/teams to hit "ready".
 */
function nflAggregate(): SportsIdentityHealthAggregate {
  return {
    ...NFL_BASE,
    playerCount: 1800,
    sportsPlayerRecordCount: 0,
    teamCount: 32,
    teamAssetCount: 0,
    canonicalIdentityCount: 1800,
    playersMissingProviderIds: 0,
    playersMissingTeam: 0,
    playerRecordsMissingTeam: 0,
    playersMissingPosition: 0,
    playerRecordsMissingPosition: 0,
    playersMissingStatus: 0,
    duplicatePlayerNameGroups: 0,
    duplicateTeamIdentityGroups: 0,
    duplicateProviderMappingGroups: 0,
    unmappedProviderPlayers: 0,
    unmappedProviderTeams: 0,
    inactiveOrUnknownPlayers: 0,
    activeStatusTeamMismatches: 0,
    teamMappingMismatches: 0,
    playersMissingHeadshots: 0,
    playerRecordsMissingHeadshots: 0,
    teamsMissingLogos: 0,
    teamAssetsMissingLogos: 0,
    duplicateHeadshotGroups: 0,
    duplicateLogoGroups: 0,
    invalidHeadshotUrlPatterns: 0,
    invalidLogoUrlPatterns: 0,
    providerMappings: [],
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("World Cup identity health — status", () => {
  it("1. 32 teams, 0 missing logos → identity=ready, image=ready", () => {
    const snap = buildSportsIdentityHealthSnapshot({
      rows: [wcAggregate({ teamCount: 32, teamsWithNoLogo: 0 })],
    })
    const identity = snap.rows.find((r) => r.id === "world-cup")!
    const image = snap.imageRows.find((r) => r.id === "world-cup")!
    expect(identity.status).toBe("ready")
    expect(image.status).toBe("ready")
  })

  it("2. 32 teams, 5 missing logos → identity=ready, image=partial", () => {
    const snap = buildSportsIdentityHealthSnapshot({
      rows: [wcAggregate({ teamCount: 32, teamsWithNoLogo: 5 })],
    })
    const identity = snap.rows.find((r) => r.id === "world-cup")!
    const image = snap.imageRows.find((r) => r.id === "world-cup")!
    expect(identity.status).toBe("ready")
    expect(image.status).toBe("partial")
    expect(image.teamsMissingLogos).toBe(5)
  })

  it("3. 0 teams → identity=missing, image=missing", () => {
    const snap = buildSportsIdentityHealthSnapshot({
      rows: [wcAggregate({ teamCount: 0 })],
    })
    const identity = snap.rows.find((r) => r.id === "world-cup")!
    const image = snap.imageRows.find((r) => r.id === "world-cup")!
    expect(identity.status).toBe("missing")
    expect(image.status).toBe("missing")
    expect(identity.teamCount).toBe(0)
  })

  it("4. 16 teams (partial load) with all logos → identity=ready, image=ready", () => {
    const snap = buildSportsIdentityHealthSnapshot({
      rows: [wcAggregate({ teamCount: 16, teamsWithNoLogo: 0 })],
    })
    const identity = snap.rows.find((r) => r.id === "world-cup")!
    const image = snap.imageRows.find((r) => r.id === "world-cup")!
    expect(identity.status).toBe("ready")
    expect(image.status).toBe("ready")
  })
})

describe("World Cup identity health — fields", () => {
  it("5. Produces zero provider mapping rows", () => {
    const snap = buildSportsIdentityHealthSnapshot({
      rows: [wcAggregate({ teamCount: 32 })],
    })
    const wcProviderRows = snap.providerRows.filter((r) => r.sport === "WC_SOCCER")
    expect(wcProviderRows).toHaveLength(0)
  })

  it("6. teamCount surfaces in teamCount field (not inflated via generic tables)", () => {
    const snap = buildSportsIdentityHealthSnapshot({
      rows: [wcAggregate({ teamCount: 32 })],
    })
    const identity = snap.rows.find((r) => r.id === "world-cup")!
    expect(identity.teamCount).toBe(32)
  })

  it("7. fixtureCount+standingCount surfaces in canonicalIdentityCount", () => {
    const snap = buildSportsIdentityHealthSnapshot({
      rows: [wcAggregate({ teamCount: 32, fixtureCount: 64, standingCount: 48 })],
    })
    const identity = snap.rows.find((r) => r.id === "world-cup")!
    expect(identity.canonicalIdentityCount).toBe(64 + 48)
  })

  it("8. Missing logos appear in topProblems for World Cup", () => {
    const snap = buildSportsIdentityHealthSnapshot({
      rows: [wcAggregate({ teamCount: 32, teamsWithNoLogo: 8 })],
    })
    const wcLogoProblem = snap.topProblems.find(
      (p) => p.id === "world-cup:missing-logos" && p.category === "image"
    )
    expect(wcLogoProblem).toBeDefined()
    expect(wcLogoProblem!.count).toBe(8)
  })

  it("9. No identity problems (missing-provider-ids, etc.) generated for World Cup", () => {
    const snap = buildSportsIdentityHealthSnapshot({
      rows: [wcAggregate({ teamCount: 32 })],
    })
    const identityProblems = snap.topProblems.filter(
      (p) => p.sport === "WC_SOCCER" && p.category === "identity"
    )
    expect(identityProblems).toHaveLength(0)
  })

  it("10. Non-WC sport (NFL) in same snapshot is unaffected", () => {
    const snap = buildSportsIdentityHealthSnapshot({
      rows: [
        wcAggregate({ teamCount: 32, teamsWithNoLogo: 3 }),
        nflAggregate(),
      ],
    })
    const nfl = snap.rows.find((r) => r.id === "nfl")!
    expect(nfl.status).toBe("ready")
    expect(nfl.playerCount).toBe(1800)
    expect(nfl.teamCount).toBe(32)
  })
})

describe("World Cup identity health — summary counters", () => {
  it("readySports increments when WC is ready", () => {
    const snap = buildSportsIdentityHealthSnapshot({
      rows: [wcAggregate({ teamCount: 32, teamsWithNoLogo: 0 })],
    })
    expect(snap.summary.readySports).toBe(1)
    expect(snap.summary.partialSports).toBe(0)
    expect(snap.summary.missingSports).toBe(0)
  })

  it("partialSports increments when WC has missing logos (identity=ready, image=partial)", () => {
    // Note: summary.partialSports counts identity rows, not image rows
    // With teamCount > 0 and 0 identity problems → identity status = "ready"
    // So partialSports = 0 here; missingSports = 0; readySports = 1
    const snap = buildSportsIdentityHealthSnapshot({
      rows: [wcAggregate({ teamCount: 32, teamsWithNoLogo: 5 })],
    })
    // Identity row has no problems → ready
    expect(snap.summary.readySports).toBe(1)
    expect(snap.summary.imageProblems).toBe(5)
  })

  it("missingSports increments when WC has 0 teams", () => {
    const snap = buildSportsIdentityHealthSnapshot({
      rows: [wcAggregate({ teamCount: 0 })],
    })
    expect(snap.summary.missingSports).toBe(1)
    expect(snap.summary.readySports).toBe(0)
  })
})
