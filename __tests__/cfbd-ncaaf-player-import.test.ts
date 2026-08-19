/**
 * Phase 7B — CFBD NCAAF player import wiring.
 *
 * The NCAAF player pool was empty because `cfbdProvider` did not support the
 * `players` dataType, so `runSportsDataImporter({ sports: ['NCAAF'] })` had no
 * source. These tests lock the fix:
 *   - cfbdProvider now claims NCAAF `players` support (so the api-chain reaches it).
 *   - the /roster row → player seed mapping is correct (camelCase + snake_case),
 *     filters to fantasy-relevant positions, and shapes ids/names the importer reads.
 */

import { describe, expect, it } from "vitest"

import { cfbdProvider, mapCfbdRosterToPlayerSeeds } from "@/lib/workers/providers/cfbd"
import { normalizeKeyValue } from "@/lib/cfbd-env"

describe("normalizeKeyValue — env quote resilience (the 401 fix)", () => {
  it("strips surrounding double quotes that break CFBD auth", () => {
    expect(normalizeKeyValue('"abc123"')).toBe("abc123")
  })
  it("strips surrounding single quotes", () => {
    expect(normalizeKeyValue("'abc123'")).toBe("abc123")
  })
  it("leaves an unquoted key untouched", () => {
    expect(normalizeKeyValue("abc123")).toBe("abc123")
  })
  it("trims whitespace and handles empty/undefined", () => {
    expect(normalizeKeyValue("  abc  ")).toBe("abc")
    expect(normalizeKeyValue(undefined)).toBe("")
    expect(normalizeKeyValue(null)).toBe("")
  })
  it("does not strip a stray leading-only quote", () => {
    expect(normalizeKeyValue('"abc')).toBe('"abc')
  })
})

describe("cfbdProvider.supports — NCAAF players", () => {
  it("supports the players dataType for NCAAF (so the chain reaches CFBD)", () => {
    expect(cfbdProvider.supports({ sport: "NCAAF", dataType: "players" })).toBe(true)
  })

  it("still supports teams/games/schedule for NCAAF", () => {
    for (const dt of ["teams", "games", "schedule"]) {
      expect(cfbdProvider.supports({ sport: "NCAAF", dataType: dt })).toBe(true)
    }
  })

  it("does not claim NFL or unrelated dataTypes", () => {
    expect(cfbdProvider.supports({ sport: "NFL", dataType: "players" })).toBe(false)
    expect(cfbdProvider.supports({ sport: "NCAAF", dataType: "injuries" })).toBe(false)
  })
})

describe("mapCfbdRosterToPlayerSeeds", () => {
  it("maps a current-API (camelCase) roster row to a player seed", () => {
    const seeds = mapCfbdRosterToPlayerSeeds([
      { id: "123", firstName: "Caleb", lastName: "Williams", team: "USC", position: "QB", jersey: 13, year: 3, height: 73, weight: 215 },
    ])
    expect(seeds).toHaveLength(1)
    expect(seeds[0]).toMatchObject({
      id: "123",
      name: "Caleb Williams",
      team: "USC",
      position: "QB",
      jersey: 13,
      classYear: 3,
      source: "cfbd",
    })
  })

  it("accepts legacy snake_case field names", () => {
    const seeds = mapCfbdRosterToPlayerSeeds([
      { id: "9", first_name: "Marvin", last_name: "Harrison", team: "Ohio State", position: "WR" },
    ])
    expect(seeds[0].name).toBe("Marvin Harrison")
    expect(seeds[0].team).toBe("Ohio State")
  })

  it("filters out non-fantasy positions (OL/DL/LB/DB)", () => {
    const seeds = mapCfbdRosterToPlayerSeeds([
      { id: "1", firstName: "Skill", lastName: "Guy", team: "A", position: "RB" },
      { id: "2", firstName: "Big", lastName: "Blocker", team: "A", position: "OL" },
      { id: "3", firstName: "Edge", lastName: "Rusher", team: "A", position: "DL" },
      { id: "4", firstName: "Corner", lastName: "Back", team: "A", position: "DB" },
    ])
    expect(seeds.map((s) => s.position)).toEqual(["RB"])
  })

  it("keeps QB/RB/WR/TE/K plus FB/PK/ATH variants", () => {
    const rows = ["QB", "RB", "FB", "WR", "TE", "K", "PK", "ATH"].map((position, i) => ({
      id: String(i),
      firstName: "P",
      lastName: String(i),
      team: "T",
      position,
    }))
    expect(mapCfbdRosterToPlayerSeeds(rows)).toHaveLength(8)
  })

  it("synthesizes a stable id when CFBD omits one", () => {
    const seeds = mapCfbdRosterToPlayerSeeds([{ firstName: "No", lastName: "Id", team: "T", position: "WR" }])
    expect(seeds[0].id).toBe("No Id-T")
  })

  it("drops rows missing a name or team", () => {
    const seeds = mapCfbdRosterToPlayerSeeds([
      { id: "1", firstName: "", lastName: "", team: "T", position: "QB" },
      { id: "2", firstName: "Has", lastName: "Name", team: "", position: "QB" },
    ])
    expect(seeds).toHaveLength(0)
  })

  it("handles null/empty input", () => {
    expect(mapCfbdRosterToPlayerSeeds(null)).toEqual([])
    expect(mapCfbdRosterToPlayerSeeds([])).toEqual([])
  })
})
