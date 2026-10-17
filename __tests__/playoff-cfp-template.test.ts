import { describe, expect, it } from "vitest"

import { buildPlayoffTemplate, getPlayoffRoundOrder } from "@/lib/playoffs/playoffTemplate"
import {
  buildProjectedPlayoffSeries,
  isOfficialTeamName,
  isPlayoffSeriesResolved,
} from "@/lib/playoffs/playoffBracketProjection"
import { getPlayoffSeriesLockedReason } from "@/lib/playoffs/playoffLocking"
import { seriesRecordLine, roundLabel, sideLabel } from "@/lib/playoffs/playoffBracketGraph"
import { formatLabel, isSingleGameSeries, matchupNoun } from "@/lib/playoffs/singleGame"
import type { PlayoffPickView, PlayoffSeriesView, PlayoffTemplateSeries } from "@/lib/playoffs/types"

/**
 * The 12-team College Football Playoff template.
 *
 * A wrong pairing here is the failure that "looks right and pays out wrong" —
 * so the structure is pinned against the REAL 2024-25 bracket, not against the
 * template's own description of itself.
 */

const real = buildPlayoffTemplate({ sport: "ncaaf", seasonYear: 2026 })
const test = buildPlayoffTemplate({ sport: "ncaaf", seasonYear: 2026, isTestMode: true })
const bySeries = (rows: PlayoffTemplateSeries[]) => new Map(rows.map((r) => [r.seriesNumber, r]))

/** Template rows as views, the shape the board and projection consume. */
function asViews(rows: PlayoffTemplateSeries[]): PlayoffSeriesView[] {
  return rows.map((r) => ({ ...r, id: `s${r.seriesNumber}` }))
}

describe("CFP template — shape", () => {
  it("is 11 single games: 4 first round, 4 quarterfinals, 2 semifinals, 1 championship", () => {
    expect(real).toHaveLength(11)
    const perRound = (key: string) => real.filter((r) => r.round === key).length
    expect(perRound("cfp_first_round")).toBe(4)
    expect(perRound("cfp_quarterfinals")).toBe(4)
    expect(perRound("cfp_semifinals")).toBe(2)
    expect(perRound("cfp_championship")).toBe(1)
    expect(real.every((r) => r.bestOf === 1)).toBe(true)
  })

  it("uses its own round order", () => {
    expect(getPlayoffRoundOrder("ncaaf")).toEqual([
      "cfp_first_round",
      "cfp_quarterfinals",
      "cfp_semifinals",
      "cfp_championship",
    ])
  })

  it("seats every seed 1-12 exactly once, and seeds 1-4 get BYES (absent from round 1)", () => {
    const seeds = real.flatMap((r) => [r.homeSeed, r.awaySeed]).filter((s) => s > 0).sort((a, b) => a - b)
    expect(seeds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const firstRoundSeeds = real.filter((r) => r.roundIndex === 1).flatMap((r) => [r.homeSeed, r.awaySeed])
    for (const bye of [1, 2, 3, 4]) expect(firstRoundSeeds).not.toContain(bye)
  })

  it("pairs the first round 8v9, 5v12, 7v10, 6v11 with the higher seed hosting", () => {
    const pairs = real
      .filter((r) => r.roundIndex === 1)
      .map((r) => [r.homeSeed, r.awaySeed])
    expect(pairs).toEqual([
      [8, 9],
      [5, 12],
      [7, 10],
      [6, 11],
    ])
  })

  it("sends each first-round winner to the right bye seed — fixed bracket, NOT reseeded", () => {
    const s = bySeries(real)
    // #1 v W(8/9) · #4 v W(5/12) · #2 v W(7/10) · #3 v W(6/11)
    const expected: Array<[number, number, number, number]> = [
      [5, 1, 1, 9],
      [6, 4, 2, 9],
      [7, 2, 3, 10],
      [8, 3, 4, 10],
    ]
    for (const [qf, byeSeed, from, semi] of expected) {
      const row = s.get(qf)!
      expect(row.round).toBe("cfp_quarterfinals")
      expect(row.homeSeed).toBe(byeSeed)
      expect(row.sourceSeriesAway).toBe(from)
      expect(row.awayTeamName).toBe(`Winner S${from}`)
      expect(row.nextSeriesNumber).toBe(semi)
    }
    // Semifinals: the 1/4 side meets itself, the 2/3 side meets itself.
    expect([s.get(9)!.sourceSeriesHome, s.get(9)!.sourceSeriesAway]).toEqual([5, 6])
    expect([s.get(10)!.sourceSeriesHome, s.get(10)!.sourceSeriesAway]).toEqual([7, 8])
    expect([s.get(11)!.sourceSeriesHome, s.get(11)!.sourceSeriesAway]).toEqual([9, 10])
    expect(s.get(11)!.nextSeriesNumber).toBeNull()
  })

  it("wires every winner forward consistently (next pointer agrees with the destination's source)", () => {
    const s = bySeries(real)
    for (const row of real) {
      if (row.nextSeriesNumber == null) continue
      const dest = s.get(row.nextSeriesNumber)!
      const source = row.nextSeriesSlot === "home" ? dest.sourceSeriesHome : dest.sourceSeriesAway
      expect(source, `S${row.seriesNumber} → S${dest.seriesNumber} ${row.nextSeriesSlot}`).toBe(row.seriesNumber)
    }
  })

  it("keeps each half on its own side until the championship", () => {
    const half = (n: number) => bySeries(real).get(n)!.conference
    for (const n of [1, 2, 5, 6, 9]) expect(half(n)).toBe("upper")
    for (const n of [3, 4, 7, 8, 10]) expect(half(n)).toBe("lower")
    expect(half(11)).toBe("finals")
  })
})

describe("CFP template — names and pickability", () => {
  it("names real-pool seeds CFP1…CFP12, which count as settled (pickable once seeded)", () => {
    const s = bySeries(real)
    expect([s.get(1)!.homeTeamName, s.get(1)!.awayTeamName]).toEqual(["CFP8", "CFP9"])
    expect(s.get(5)!.homeTeamName).toBe("CFP1")
    for (const name of ["CFP1", "CFP12"]) expect(isOfficialTeamName(name)).toBe(true)
  })

  it("keeps the championship unpickable until both semifinals are decided", () => {
    const final = bySeries(real).get(11)!
    expect(isOfficialTeamName(final.homeTeamName)).toBe(false)
    expect(isOfficialTeamName(final.awayTeamName)).toBe(false)
    expect(isPlayoffSeriesResolved({ ...final, id: "s11" })).toBe(false)
  })

  it("test mode replays the real 2024-25 bracket: Ohio State (8) v Tennessee (9), then Oregon (1)", () => {
    const s = bySeries(test)
    expect([s.get(1)!.homeTeamName, s.get(1)!.awayTeamName]).toEqual(["Ohio State", "Tennessee"])
    expect(s.get(5)!.homeTeamName).toBe("Oregon")
    expect([s.get(2)!.homeTeamName, s.get(2)!.awayTeamName]).toEqual(["Texas", "Clemson"])
    expect(s.get(6)!.homeTeamName).toBe("Arizona State")
  })

  it("a pick advances through the projection: picking Ohio State in S1 fills S5's away side", () => {
    const views = asViews(test)
    const picks: PlayoffPickView[] = [
      { id: "p1", entryId: "e1", seriesId: "s1", pickTeamName: "Ohio State", createdAt: "", updatedAt: "" },
    ]
    const projected = new Map(buildProjectedPlayoffSeries(views, picks).map((r) => [r.seriesNumber, r]))
    expect(projected.get(5)!.awayTeamName).toBe("Ohio State")
    expect(isPlayoffSeriesResolved(projected.get(5)!)).toBe(true)
    // S6 has no pick for its feeder yet, so it stays unresolved.
    expect(isPlayoffSeriesResolved(projected.get(6)!)).toBe(false)
  })
})

describe("single-game wording", () => {
  const game = { ...bySeries(real).get(1)!, id: "s1" }
  const series7 = { ...game, bestOf: 7 }

  it("says 'Single game', not 'Best of 1' — and leaves series sports untouched", () => {
    expect(isSingleGameSeries(game)).toBe(true)
    expect(formatLabel(1)).toBe("Single game")
    expect(formatLabel(7)).toBe("Best of 7")
    expect(matchupNoun(game)).toBe("Game")
    expect(matchupNoun(series7)).toBe("Series")
  })

  it("lock reasons say 'Game' for a single game and 'Series' for a series", () => {
    expect(getPlayoffSeriesLockedReason({ ...game, status: "final" }, "series_start")).toBe("Game completed")
    expect(getPlayoffSeriesLockedReason({ ...series7, status: "final" }, "series_start")).toBe("Series completed")
    expect(getPlayoffSeriesLockedReason({ ...game, status: "in_progress" }, "series_start")).toBe(
      "Game already started/locked",
    )
  })

  it("a decided single game reads 'X won', not 'leads 1-0'", () => {
    expect(seriesRecordLine({ ...game, homeTeamWins: 1, awayTeamWins: 0, seriesSummary: null })).toBe("CFP8 won")
    expect(seriesRecordLine({ ...series7, homeTeamWins: 2, awayTeamWins: 1, seriesSummary: null })).toBe("CFP8 leads 2-1")
  })

  it("labels CFP rounds and halves in football terms", () => {
    expect(roundLabel("ncaaf", "cfp_championship")).toBe("Title Game")
    expect(roundLabel("ncaaf", "cfp_quarterfinals")).toBe("Quarterfinal")
    expect(sideLabel("upper")).toBe("Upper Bracket")
    expect(sideLabel("lower")).toBe("Lower Bracket")
  })
})
