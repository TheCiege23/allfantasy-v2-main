/**
 * Player Command Center (Slice 5) — replacement candidate ranking (pure).
 */
import { describe, expect, it } from "vitest"
import {
  rankReplacementCandidates,
  resolveClaimTarget,
  resolveLineupTarget,
} from "@/lib/shared-services/league-hub/replacementOptions"

const pool = [
  { playerId: "a", name: "Alpha", position: "WR", projectedPoints: 11.2 },
  { playerId: "b", name: "Bravo", position: "WR", projectedPoints: 17.5 },
  { playerId: "c", name: "Charlie", position: "WR", projectedPoints: 14.0 },
  { playerId: "d", name: "Delta", position: "WR", projectedPoints: 9.9 },
]

describe("rankReplacementCandidates", () => {
  it("sorts by projection desc, caps at limit, and computes deltas vs the affected player", () => {
    const ranked = rankReplacementCandidates(pool, 12.3, 3)
    expect(ranked.map((r) => r.playerId)).toEqual(["b", "c", "a"])
    expect(ranked[0]!.delta).toBe(5.2)
    expect(ranked[1]!.delta).toBe(1.7)
    expect(ranked[2]!.delta).toBe(-1.1)
  })

  it("is honest when the affected player has no projection: delta stays null", () => {
    const ranked = rankReplacementCandidates(pool, null, 2)
    expect(ranked).toHaveLength(2)
    expect(ranked.every((r) => r.delta === null)).toBe(true)
  })

  it("does not mutate the input array", () => {
    const before = pool.map((p) => p.playerId)
    rankReplacementCandidates(pool, 10, 4)
    expect(pool.map((p) => p.playerId)).toEqual(before)
  })
})

describe("resolveClaimTarget (Slice 7 deep-links)", () => {
  it("native platforms link to AllFantasy's own waiver wire", () => {
    for (const platform of ["manual", "allfantasy", "af", "native", ""]) {
      const target = resolveClaimTarget({ id: "L1", platform, platformLeagueId: null })
      expect(target).toEqual({ kind: "native", url: "/waiver-wire?leagueId=L1" })
    }
  })

  it("sleeper leagues link out to the provider's players page (see-and-advise: never execute)", () => {
    const target = resolveClaimTarget({ id: "L1", platform: "Sleeper", platformLeagueId: "998877" })
    expect(target).toEqual({
      kind: "provider",
      provider: "sleeper",
      url: "https://sleeper.com/leagues/998877/players",
    })
  })

  it("is honest about platforms with no known claim surface", () => {
    expect(resolveClaimTarget({ id: "L1", platform: "espn", platformLeagueId: "x" })).toEqual({ kind: "none" })
    expect(resolveClaimTarget({ id: "L1", platform: "sleeper", platformLeagueId: null })).toEqual({ kind: "none" })
  })
})

describe("resolveLineupTarget (Slice 9 bench-swap deep-links)", () => {
  it("native leagues link to the league's own Team tab", () => {
    expect(resolveLineupTarget({ id: "L1", platform: "manual", platformLeagueId: null })).toEqual({
      kind: "native",
      url: "/leagues/L1?tab=Team",
    })
  })

  it("sleeper leagues link out to the provider's team page", () => {
    expect(resolveLineupTarget({ id: "L1", platform: "sleeper", platformLeagueId: "42" })).toEqual({
      kind: "provider",
      provider: "sleeper",
      url: "https://sleeper.com/leagues/42/team",
    })
  })

  it("unknown platforms honestly return none", () => {
    expect(resolveLineupTarget({ id: "L1", platform: "yahoo", platformLeagueId: "y" })).toEqual({ kind: "none" })
  })
})
