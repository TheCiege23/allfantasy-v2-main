/**
 * Slice 15 — findPlayerByName must not bind the wrong athlete.
 * This function feeds trade valuation, waiver scoring and player outlook.
 */
import { describe, expect, it } from "vitest"
import { findPlayerByName } from "@/lib/fantasycalc"

type Row = Parameters<typeof findPlayerByName>[0][number]

const mk = (name: string, position: string, maybeTeam: string | null, value: number): Row =>
  ({
    player: { id: value, name, mflId: "", sleeperId: String(value), position, maybeTeam },
    value,
    overallRank: 1,
    positionRank: 1,
    trend30Day: 0,
    redraftDynastyValueDifference: 0,
  }) as unknown as Row

const players = [
  mk("Josh Allen", "QB", "BUF", 9000),
  mk("Josh Allen", "LB", "JAX", 300),
  mk("Michael Pittman Jr.", "WR", "IND", 4000),
  mk("Marvin Harrison Jr.", "WR", "ARI", 6000),
]

describe("findPlayerByName — collisions", () => {
  it("uses the position hint to pick the right Josh Allen", () => {
    expect(findPlayerByName(players, "Josh Allen", { position: "QB" })?.value).toBe(9000)
    expect(findPlayerByName(players, "Josh Allen", { position: "LB" })?.value).toBe(300)
  })

  it("uses the team hint when position is unknown", () => {
    expect(findPlayerByName(players, "Josh Allen", { team: "JAX" })?.value).toBe(300)
  })

  it("REFUSES an unhinted collision instead of returning the first row", () => {
    // Old behavior returned the QB (9000) — a real market value for the wrong
    // athlete, silently feeding trade grades.
    expect(findPlayerByName(players, "Josh Allen")).toBeNull()
  })
})

describe("findPlayerByName — normal matching still works", () => {
  it("matches unique names exactly, ignoring generational suffixes", () => {
    expect(findPlayerByName(players, "Marvin Harrison")?.value).toBe(6000)
    expect(findPlayerByName(players, "michael pittman jr")?.value).toBe(4000)
  })

  it("returns null for unknown players rather than a loose substring hit", () => {
    expect(findPlayerByName(players, "Nobody Here")).toBeNull()
  })

  it("does not bind an ambiguous substring to an arbitrary row", () => {
    // "Harrison" is a substring of exactly one name here, so it resolves...
    expect(findPlayerByName(players, "Harrison")?.value).toBe(6000)
    // ...but a substring shared by two rows must refuse without hints.
    expect(findPlayerByName(players, "Allen")).toBeNull()
  })
})
