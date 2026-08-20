/**
 * Slice 11 (honesty pass) — a synthetic ADP must never speak as market data.
 *
 * `getAdp` falls back to `overall + 20` when a player has no real ADP. That
 * prior is fine for ordering, but the engine was emitting
 * "typically drafted later (ADP ~87) — this is a reach at pick 67" from it.
 */
import { describe, expect, it } from "vitest"
import {
  computeDraftPlayerRankings,
  computeDraftRecommendation,
  type RecommendationInput,
} from "@/lib/draft-helper/RecommendationEngine"

const base = (extra: Partial<RecommendationInput>): RecommendationInput => ({
  available: [],
  teamRoster: [],
  rosterSlots: ["QB", "RB", "WR", "TE"],
  round: 6,
  pick: 7,
  totalTeams: 10,
  sport: "NFL",
  ...extra,
})

describe("synthetic ADP is flagged, not spoken", () => {
  it("marks rows with no real ADP as adpIsReal=false", () => {
    const result = computeDraftPlayerRankings(
      base({
        available: [
          { name: "Real Adp", position: "WR", team: "AAA", adp: 40 },
          { name: "No Adp", position: "WR", team: "BBB" },
        ],
      }),
    )!
    expect(result.scored.find((r) => r.player.name === "Real Adp")!.adpIsReal).toBe(true)
    expect(result.scored.find((r) => r.player.name === "No Adp")!.adpIsReal).toBe(false)
  })

  it("aiAdpByKey counts as real market data", () => {
    const result = computeDraftPlayerRankings(
      base({
        available: [{ name: "Site Adp", position: "WR", team: "CCC" }],
        aiAdpByKey: { "site adp|wr|ccc": 22 },
      }),
    )!
    const row = result.scored[0]!
    expect(row.adpIsReal).toBe(true)
    expect(row.adp).toBe(22)
  })

  it("emits NO reach/value warning and no market-edge claim for synthetic ADP", () => {
    const out = computeDraftRecommendation(
      base({ available: [{ name: "No Adp", position: "WR", team: "BBB" }] }),
    )
    expect(out.reachWarning).toBeNull()
    expect(out.valueWarning).toBeNull()
    expect(out.evidence.join(" ")).toMatch(/Market edge: unavailable/)
    expect(out.evidence.join(" ")).not.toMatch(/picks vs ADP/)
    expect(out.recommendation!.reason).not.toMatch(/value vs ADP/i)
  })

  it("still emits real reach warnings when ADP is genuine", () => {
    const out = computeDraftRecommendation(
      // overall = (6-1)*10 + 7 = 57; ADP 90 is a genuine reach.
      base({ available: [{ name: "Real Reach", position: "WR", team: "AAA", adp: 90 }] }),
    )
    expect(out.reachWarning).toMatch(/typically drafted later \(ADP ~90\)/)
    expect(out.evidence.join(" ")).toMatch(/picks vs ADP/)
  })
})
