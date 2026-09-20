import { describe, expect, it } from "vitest"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"
import {
  abbreviate,
  buildBracketGraph,
  descendantsOf,
  roundLabel,
  seriesOdds,
  seriesRecordLine,
  seriesStatusKind,
} from "@/lib/playoffs/playoffBracketGraph"
import { isPlaceholderName, teamColors } from "@/lib/playoffs/playoffTeamColors"
import { pointsForSeries, roundPointsTable, scorePlayoffEntryPicks } from "@/lib/playoffs/playoffScoring"
import type { PlayoffSeriesView } from "@/lib/playoffs/types"

function mlbSeries(): PlayoffSeriesView[] {
  return buildPlayoffTemplate({ sport: "mlb", seasonYear: 2026 }).map((series, index) => ({
    ...series,
    id: `s${index + 1}`,
  }))
}

describe("buildBracketGraph", () => {
  const graph = buildBracketGraph(mlbSeries())

  it("splits the two leagues into mirrored halves and keeps the final out of both", () => {
    expect(graph.sides).toEqual({ left: "al", right: "nl" })
    expect(graph.final?.series.seriesNumber).toBe(11)
    expect(graph.columns.some((c) => c.nodes.some((n) => n.series.seriesNumber === 11))).toBe(false)
  })

  it("orders the left half outward-in and the right half inward-out", () => {
    const left = graph.columns.filter((c) => c.side === "left").map((c) => c.roundIndex)
    const right = graph.columns.filter((c) => c.side === "right").map((c) => c.roundIndex)
    expect(left).toEqual([1, 2, 3])
    expect(right).toEqual([3, 2, 1])
  })

  it("derives every edge from the series rows rather than a hard-coded map", () => {
    // MLB does not reseed: S1 is the 3/6 wild card and feeds the #2 seed's
    // Division Series (S6), not the #1 seed's.
    expect(graph.children.get(1)).toEqual([6])
    expect(graph.children.get(2)).toEqual([5])
    expect(graph.children.get(9)).toEqual([11])
    expect(descendantsOf(1, graph)).toEqual(new Set([6, 9, 11]))
  })

  it("gives a bye seed no first-round series to lose", () => {
    const round1 = graph.columns
      .flatMap((c) => (c.roundIndex === 1 ? c.nodes : []))
      .flatMap((n) => [n.series.homeSeed, n.series.awaySeed])
    expect(round1).not.toContain(1)
    expect(round1).not.toContain(2)
  })
})

describe("seriesOdds", () => {
  const base = mlbSeries()[0]

  it("refuses to price a series with an unresolved side", () => {
    expect(seriesOdds({ ...base, homeSeed: 0, awaySeed: 0 })).toEqual({
      home: 50,
      away: 50,
      basis: "unknown",
    })
  })

  it("favours the better seed on the fixed slope, and says that is the basis", () => {
    expect(seriesOdds({ ...base, homeSeed: 1, awaySeed: 6 })).toEqual({
      home: 70,
      away: 30,
      basis: "seed",
    })
  })

  it("clamps rather than running to a certainty", () => {
    expect(seriesOdds({ ...base, homeSeed: 1, awaySeed: 30 }).home).toBe(80)
    expect(seriesOdds({ ...base, homeSeed: 30, awaySeed: 1 }).home).toBe(30)
  })
})

describe("series presentation helpers", () => {
  const base = mlbSeries()[0]

  it("reads a record off the provider summary first, then the win columns", () => {
    expect(seriesRecordLine({ ...base, seriesSummary: "NYY lead 2-1" })).toBe("NYY lead 2-1")
    expect(
      seriesRecordLine({ ...base, homeTeamName: "Cleveland Guardians", homeTeamWins: 2, awayTeamWins: 1 }),
    ).toBe("Cleveland Guardians leads 2-1")
    expect(seriesRecordLine({ ...base, homeTeamWins: 0, awayTeamWins: 0 })).toBeNull()
  })

  it("calls an unresolved series tbd whatever its status says", () => {
    expect(seriesStatusKind({ ...base, status: "in_progress" }, false)).toBe("tbd")
    expect(seriesStatusKind({ ...base, status: "in_progress" }, true)).toBe("live")
    expect(seriesStatusKind({ ...base, winnerTeamName: "Houston Astros" }, true)).toBe("final")
  })

  it("abbreviates on the nickname, and leaves an existing short code alone", () => {
    expect(abbreviate("New York Yankees")).toBe("YAN")
    expect(abbreviate("NYY")).toBe("NYY")
    expect(abbreviate("AL1")).toBe("AL1")
    expect(abbreviate(null)).toBe("—")
  })

  it("labels rounds in the sport's own vocabulary", () => {
    expect(roundLabel("mlb", "world_series")).toBe("World Series")
    expect(roundLabel("nhl", "finals")).toBe("Stanley Cup")
    // An unknown pairing degrades to the key, never to another sport's word.
    expect(roundLabel("mlb", "finals")).toBe("finals")
  })
})

describe("teamColors", () => {
  it("gives every club a readable pair, named or not", () => {
    expect(teamColors("NYY")).toEqual({ bg: "#10213b", fg: "#9fd4ff" })
    const unknown = teamColors("Sacramento Solons")
    expect(unknown.bg).toMatch(/^#[0-9a-f]{6}$/i)
    expect(unknown.fg).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it("is deterministic, so a club is the same colour on every device", () => {
    expect(teamColors("Sacramento Solons")).toEqual(teamColors("Sacramento Solons"))
  })

  it("draws a seed slot as chrome rather than as a club", () => {
    expect(isPlaceholderName("AL1")).toBe(true)
    expect(isPlaceholderName("Winner S5")).toBe(true)
    expect(isPlaceholderName("Houston Astros")).toBe(false)
    expect(teamColors("AL1").fg).toBe("#8f97bd")
  })
})

describe("round-weighted scoring", () => {
  it("weights MLB rounds, and the table the UI renders is the scorer's own", () => {
    expect(roundPointsTable("mlb")).toEqual([
      { round: "wild_card", points: 5 },
      { round: "division_series", points: 10 },
      { round: "league_championship", points: 18 },
      { round: "world_series", points: 30 },
    ])
    expect(pointsForSeries({ round: "world_series" }, "mlb")).toBe(30)
  })

  it("leaves NBA and NHL flat — 26 live pools must not be restated", () => {
    expect(roundPointsTable("nba")).toEqual([])
    expect(roundPointsTable("nhl")).toEqual([])
    expect(pointsForSeries({ round: "finals" }, "nba")).toBe(1)
    expect(pointsForSeries({ round: "finals" }, undefined)).toBe(1)
  })

  it("scores an unknown round as 1, not as 0", () => {
    // Out-of-date table, not a void pick: the honest failure is "scored the
    // way it always was".
    expect(pointsForSeries({ round: "round_1" }, "mlb")).toBe(1)
  })

  it("totals an entry by the round each series belongs to", () => {
    const series = [
      { id: "a", winnerTeamName: "Houston Astros", round: "wild_card" as const },
      { id: "b", winnerTeamName: "New York Yankees", round: "world_series" as const },
      { id: "c", winnerTeamName: null, round: "division_series" as const },
    ]
    const picks = [
      { seriesId: "a", pickTeamName: "Houston Astros" },
      { seriesId: "b", pickTeamName: "Los Angeles Dodgers" },
      { seriesId: "c", pickTeamName: "Cleveland Guardians" },
    ]
    expect(scorePlayoffEntryPicks(series, picks, "mlb")).toEqual({
      totalScore: 5,
      correctPicks: 1,
      resolvedPicks: 2,
    })
    expect(scorePlayoffEntryPicks(series, picks, "nba")).toEqual({
      totalScore: 1,
      correctPicks: 1,
      resolvedPicks: 2,
    })
  })
})
