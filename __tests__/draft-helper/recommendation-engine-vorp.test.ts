/**
 * Draft VORP slice — replacement value + tier cliff in computeDraftPlayerRankings.
 *
 * Key contract: 'observe' (the default) computes and exposes VORP fields but
 * leaves totalScore bit-identical to 'off' — no consumer's scoring changes
 * until DRAFT_VORP_MODE=active.
 */
import { describe, expect, it } from "vitest"
import {
  computeDraftPlayerRankings,
  type RecommendationInput,
} from "@/lib/draft-helper/RecommendationEngine"

// 10-team league, round 1 pick 5 → overall 5; next-turn window = 5 + 10 = 15.
const baseInput = (extra: Partial<RecommendationInput>): RecommendationInput => ({
  available: [],
  teamRoster: [],
  rosterSlots: ["QB", "RB", "WR", "TE"],
  round: 1,
  pick: 5,
  totalTeams: 10,
  sport: "NFL",
  ...extra,
})

const qbPool = [
  { name: "QB Alpha", position: "QB", team: "AAA", adp: 3, projectedPoints: 320 },
  { name: "QB Bravo", position: "QB", team: "BBB", adp: 12, projectedPoints: 300 },
  { name: "QB Charlie", position: "QB", team: "CCC", adp: 30, projectedPoints: 250 },
  { name: "QB Delta", position: "QB", team: "DDD", adp: 40, projectedPoints: 240 },
]

// WRs deliberately WITHOUT projections → adp_gap fallback territory.
const wrPool = [
  { name: "WR Echo", position: "WR", team: "EEE", adp: 5 },
  { name: "WR Foxtrot", position: "WR", team: "FFF", adp: 18 },
  { name: "WR Golf", position: "WR", team: "GGG", adp: 20 },
]

function rowFor(result: NonNullable<ReturnType<typeof computeDraftPlayerRankings>>, name: string) {
  const row = result.scored.find((r) => r.player.name === name)
  expect(row, `row for ${name}`).toBeDefined()
  return row!
}

describe("VORP replacement level (projection signal)", () => {
  it("replacement = best same-pos projection likely still available at the next turn", () => {
    const result = computeDraftPlayerRankings(
      baseInput({ available: [...qbPool, ...wrPool], vorpMode: "observe" }),
    )!
    // ADP <= 15 → Alpha + Bravo likely gone before the next turn; replacement
    // is Charlie (250), the best QB projected to survive the window.
    const alpha = rowFor(result, "QB Alpha")
    expect(alpha.replacementProjection).toBe(250)
    expect(alpha.vorp).toBe(70)
    expect(alpha.valueSignal).toBe("projection")
    expect(rowFor(result, "QB Bravo").vorp).toBe(50)
    expect(rowFor(result, "QB Delta").vorp).toBe(-10)
  })

  it("falls back to the ADP-gap tier signal when a position lacks projections", () => {
    const result = computeDraftPlayerRankings(
      baseInput({ available: [...qbPool, ...wrPool], vorpMode: "observe" }),
    )!
    const echo = rowFor(result, "WR Echo")
    expect(echo.valueSignal).toBe("adp_gap")
    expect(echo.tierDropoff).toBe(13) // next WR ADP 18 − 5
    expect(echo.vorp).toBeNull()
  })
})

describe("vorpMode contract", () => {
  it("'observe' totalScores are bit-identical to 'off' (zero scoring change)", () => {
    const off = computeDraftPlayerRankings(
      baseInput({ available: [...qbPool, ...wrPool], vorpMode: "off" }),
    )!
    const observe = computeDraftPlayerRankings(
      baseInput({ available: [...qbPool, ...wrPool], vorpMode: "observe" }),
    )!
    expect(observe.scored.map((r) => [r.player.name, r.totalScore])).toEqual(
      off.scored.map((r) => [r.player.name, r.totalScore]),
    )
    // But observe exposes the fields off leaves empty.
    expect(rowFor(observe, "QB Alpha").vorp).toBe(70)
    expect(rowFor(off, "QB Alpha").vorp).toBeNull()
    expect(rowFor(off, "QB Alpha").valueSignal).toBe("none")
  })

  it("'active' adds scaled VORP to totalScore (clamped)", () => {
    const observe = computeDraftPlayerRankings(
      baseInput({ available: [...qbPool, ...wrPool], vorpMode: "observe" }),
    )!
    const active = computeDraftPlayerRankings(
      baseInput({ available: [...qbPool, ...wrPool], vorpMode: "active" }),
    )!
    const obsAlpha = rowFor(observe, "QB Alpha")
    const actAlpha = rowFor(active, "QB Alpha")
    // vorp 70 × 0.3 = 21 → clamped ceiling is 30, so +21.
    expect(actAlpha.vorpScore).toBe(21)
    expect(actAlpha.totalScore).toBeCloseTo(obsAlpha.totalScore + 21, 6)
    // Fallback tier signal also joins in active mode: (13 − 4) × 0.6 = 5.4.
    const actEcho = rowFor(active, "WR Echo")
    expect(actEcho.tierDropoffScore).toBeCloseTo(5.4, 6)
  })

  it("negative VORP is clamped at −8 in active mode", () => {
    const deepQbPool = [
      ...qbPool,
      { name: "QB Hotel", position: "QB", team: "HHH", adp: 90, projectedPoints: 100 },
    ]
    const active = computeDraftPlayerRankings(
      baseInput({ available: deepQbPool, vorpMode: "active" }),
    )!
    // Hotel: vorp = 100 − 250 = −150 → clamp(−45, −8, 30) = −8.
    expect(rowFor(active, "QB Hotel").vorpScore).toBe(-8)
  })

  it("positions need ≥3 real projections for the projection signal", () => {
    const thinPool = [
      { name: "TE India", position: "TE", team: "III", adp: 25, projectedPoints: 180 },
      { name: "TE Juliet", position: "TE", team: "JJJ", adp: 55 },
    ]
    const result = computeDraftPlayerRankings(
      baseInput({ available: [...qbPool, ...thinPool], vorpMode: "observe" }),
    )!
    const india = rowFor(result, "TE India")
    expect(india.replacementProjection).toBeNull()
    expect(india.valueSignal).toBe("adp_gap")
  })
})
