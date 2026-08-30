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
})

/**
 * 🛑 REAL ADP ALWAYS WINS — `aiAdpByKey` is a FALLBACK, never an override.
 *
 * `getAdp` used to return `aiAdpByKey[key]` in preference to `p.adp`, so an AllFantasy board
 * built from as few as nine in-house drafts silently replaced the market board for every
 * player it covered, and `hasRealAdp` then reported the substitute as real. Nothing in the
 * suite would have caught a re-inversion, which is what these tests are for.
 */
describe("real ADP outranks the AI board", () => {
  it("uses the market ADP when both are present", () => {
    const result = computeDraftPlayerRankings(
      base({
        available: [{ name: "Both Adp", position: "WR", team: "DDD", adp: 40 }],
        aiAdpByKey: { "both adp|wr|ddd": 12 },
      }),
    )!
    const row = result.scored[0]!
    expect(row.adp).toBe(40)
    expect(row.adp).not.toBe(12)
    expect(row.adpIsReal).toBe(true)
  })

  it("still uses the AI board where the market has no price — the rookie gap it exists for", () => {
    const result = computeDraftPlayerRankings(
      base({
        available: [
          { name: "Both Adp", position: "WR", team: "DDD", adp: 40 },
          { name: "Rookie Only", position: "RB", team: "EEE" },
        ],
        aiAdpByKey: { "both adp|wr|ddd": 12, "rookie only|rb|eee": 31.7 },
      }),
    )!
    expect(result.scored.find((r) => r.player.name === "Both Adp")!.adp).toBe(40)
    expect(result.scored.find((r) => r.player.name === "Rookie Only")!.adp).toBe(31.7)
  })

  it("does not let an AI value change the pick order of a market-priced player", () => {
    /*
     * The behavioural version of the same rule: an AI board that rates B far higher must not
     * reorder two players the market has already priced.
     */
    const withoutAi = computeDraftPlayerRankings(
      base({
        available: [
          { name: "Early A", position: "WR", team: "AAA", adp: 10 },
          { name: "Late B", position: "WR", team: "BBB", adp: 90 },
        ],
      }),
    )!
    const withAi = computeDraftPlayerRankings(
      base({
        available: [
          { name: "Early A", position: "WR", team: "AAA", adp: 10 },
          { name: "Late B", position: "WR", team: "BBB", adp: 90 },
        ],
        aiAdpByKey: { "late b|wr|bbb": 1 },
      }),
    )!
    const order = (r: typeof withoutAi) => r.scored.map((s) => s.player.name)
    expect(order(withAi)).toEqual(order(withoutAi))
  })

  it("falls through to the AI board when p.adp is present but unusable", () => {
    const result = computeDraftPlayerRankings(
      base({
        available: [
          { name: "Nan Adp", position: "WR", team: "FFF", adp: Number.NaN as unknown as number },
        ],
        aiAdpByKey: { "nan adp|wr|fff": 55 },
      }),
    )!
    // A NaN adp used to produce a NaN adpEdge and poison the score.
    expect(result.scored[0]!.adp).toBe(55)
    expect(Number.isFinite(result.scored[0]!.adp)).toBe(true)
  })
})

describe("synthetic ADP is flagged, not spoken (cont.)", () => {
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
