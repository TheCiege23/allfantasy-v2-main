import { describe, expect, it } from "vitest"
import { buildSportsIdentityHealthSnapshot } from "@/lib/sports-reporting/SportsIdentityHealthService"

/**
 * The identity headline counts DEFECTS, not every column the panel displays.
 *
 * Prod read 194,318 identity problems across 293,222 player rows because the headline summed
 * free agents with no team, retired players, one "duplicate name" per person carried by two
 * providers, and every unmapped provider row — which the provider-mapping headline already
 * counts. See identityDefectCount.
 */
describe("identity defect count", () => {
  const base = {
    id: "nfl",
    sport: "NFL",
    label: "NFL",
    playerCount: 1000,
    teamCount: 32,
  }

  it("does not count non-defects: no team, inactive status, raw duplicate names, unmapped provider rows", () => {
    const snapshot = buildSportsIdentityHealthSnapshot({
      rows: [
        {
          ...base,
          playersMissingTeam: 500,
          inactiveOrUnknownPlayers: 300,
          duplicatePlayerNameGroups: 200,
          unmappedProviderPlayers: 90,
          unmappedProviderTeams: 9,
        },
      ],
    })
    expect(snapshot.summary.identityProblems).toBe(0)
    expect(snapshot.rows[0]?.status).toBe("ready")
    // Still displayed — only no longer summed as defects.
    expect(snapshot.rows[0]).toMatchObject({ playersMissingTeam: 500, inactiveOrUnknownPlayers: 300 })
  })

  it("counts every real defect exactly once", () => {
    const snapshot = buildSportsIdentityHealthSnapshot({
      rows: [
        {
          ...base,
          playersMissingProviderIds: 1,
          playersMissingPosition: 2,
          playersMissingStatus: 4,
          activeStatusTeamMismatches: 8,
          duplicateTeamIdentityGroups: 16,
          duplicateProviderMappingGroups: 32,
          teamMappingMismatches: 64,
        },
      ],
    })
    expect(snapshot.summary.identityProblems).toBe(127)
    expect(snapshot.rows[0]?.status).toBe("partial")
    expect(snapshot.rows[0]?.topProblems).toContain("Active without team: 8")
  })

  it("an unmapped provider row lands in the provider headline only", () => {
    const snapshot = buildSportsIdentityHealthSnapshot({
      rows: [
        {
          ...base,
          unmappedProviderPlayers: 3,
          providerMappings: [
            {
              provider: "CFBD",
              providerPlayerRows: 10,
              mappedPlayerIds: 7,
              unmappedProviderPlayers: 3,
              providerTeamRows: 0,
              mappedTeamRows: 0,
              unmappedProviderTeams: 0,
              duplicatePlayerMappingGroups: 0,
              duplicateTeamMappingGroups: 0,
            },
          ],
        },
      ],
    })
    expect(snapshot.summary.providerMappingProblems).toBe(3)
    expect(snapshot.summary.identityProblems).toBe(0)
  })
})
