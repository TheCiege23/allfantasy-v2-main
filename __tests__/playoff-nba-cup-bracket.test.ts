import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { buildPlayoffTemplate, getPlayoffRoundOrder } from "@/lib/playoffs/playoffTemplate"
import { buildProjectedPlayoffSeries } from "@/lib/playoffs/playoffBracketProjection"
import { pointsForSeries, scorePlayoffEntryPicks } from "@/lib/playoffs/playoffScoring"
import { nbaCupSeedMap, validateNbaCupField } from "@/lib/playoffs/nbaCupSeeds"
import { validateSingleGameSchedule } from "@/lib/playoffs/singleGameSchedule"
import { visiblePlayoffPicks } from "@/lib/playoffs/shareVisibility"

describe("NBA Cup knockout bracket", () => {
  const rows = buildPlayoffTemplate({ sport: "nba_cup", seasonYear: 2026 })
  const byNumber = new Map(rows.map((row) => [row.seriesNumber, row]))

  it("has four quarterfinals, two semifinals and one championship, all single games", () => {
    expect(rows).toHaveLength(7)
    expect(rows.map((row) => row.roundIndex)).toEqual([1, 1, 1, 1, 2, 2, 3])
    expect(rows.every((row) => row.bestOf === 1)).toBe(true)
    expect(getPlayoffRoundOrder("nba_cup")).toEqual([
      "cup_quarterfinals", "cup_semifinals", "cup_championship",
    ])
  })

  it("pairs conference seeds 1v4 and 2v3 without reseeding", () => {
    expect(rows.slice(0, 4).map((row) => [row.conference, row.homeSeed, row.awaySeed])).toEqual([
      ["east", 1, 4], ["east", 2, 3], ["west", 1, 4], ["west", 2, 3],
    ])
    expect([byNumber.get(5)?.sourceSeriesHome, byNumber.get(5)?.sourceSeriesAway]).toEqual([1, 2])
    expect([byNumber.get(6)?.sourceSeriesHome, byNumber.get(6)?.sourceSeriesAway]).toEqual([3, 4])
    expect([byNumber.get(7)?.sourceSeriesHome, byNumber.get(7)?.sourceSeriesAway]).toEqual([5, 6])
  })

  it("advances picks into the next round and scores every round as shown", () => {
    const series = rows.map((row) => ({ ...row, id: `s${row.seriesNumber}` }))
    const picks = [{
      id: "p1", entryId: "e1", seriesId: "s1", pickTeamName: "EAST1",
      createdAt: "", updatedAt: "",
    }]
    const projected = buildProjectedPlayoffSeries(series, picks)
    expect(projected.find((row) => row.seriesNumber === 5)?.homeTeamName).toBe("EAST1")
    expect(pointsForSeries(rows[0], "nba_cup")).toBe(1)
    expect(pointsForSeries(rows[4], "nba_cup")).toBe(2)
    expect(pointsForSeries(rows[6], "nba_cup")).toBe(4)
    expect(scorePlayoffEntryPicks(
      [{ id: "s1", winnerTeamName: "EAST1", round: "cup_quarterfinals" }],
      picks, "nba_cup",
    )).toEqual({ totalScore: 1, correctPicks: 1, resolvedPicks: 1 })
  })
})

describe("NBA Cup field validation", () => {
  const east = ["Celtics", "Knicks", "Cavaliers", "Magic"]
  const west = ["Thunder", "Nuggets", "Rockets", "Lakers"]

  it("maps four seeds into each conference", () => {
    const result = validateNbaCupField({ east, west })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const map = nbaCupSeedMap(result)
    expect(map.get("east")?.get(4)).toBe("Magic")
    expect(map.get("west")?.get(1)).toBe("Thunder")
  })

  it("rejects duplicate or placeholder names", () => {
    expect(validateNbaCupField({ east, west: ["Celtics", ...west.slice(1)] }).ok).toBe(false)
    expect(validateNbaCupField({ east: ["EAST1", ...east.slice(1)], west }).ok).toBe(false)
    expect(validateNbaCupField({ east: east.slice(1), west }).ok).toBe(false)
  })
})

describe("new CFP scoring", () => {
  it("weights each single-game round 1, 2, 4, 8", () => {
    const rows = buildPlayoffTemplate({ sport: "ncaaf", seasonYear: 2026 })
    expect([1, 2, 3, 4].map((index) =>
      pointsForSeries(rows.find((row) => row.roundIndex === index)!, "ncaaf"),
    )).toEqual([1, 2, 4, 8])
  })
})

describe("single-game schedule and shared pick privacy", () => {
  it("requires every game and explicit timezone start times", () => {
    const games = Array.from({ length: 7 }, (_, index) => ({
      seriesNumber: index + 1,
      startsAt: `2026-12-${String(index + 4).padStart(2, "0")}T19:00:00-05:00`,
    }))
    const valid = validateSingleGameSchedule("nba_cup", games)
    expect(valid.ok).toBe(true)
    expect(validateSingleGameSchedule("nba_cup", games.slice(1)).ok).toBe(false)
    expect(validateSingleGameSchedule("nba_cup", [
      { ...games[0], startsAt: "2026-12-04T19:00:00" }, ...games.slice(1),
    ]).ok).toBe(false)
  })

  it("reveals only locked games when someone opens a shared entry", () => {
    const now = Date.parse("2026-12-05T00:00:00Z")
    const series = [
      { id: "s1", status: "scheduled" as const, startsAt: "2026-12-04T23:00:00Z" },
      { id: "s2", status: "scheduled" as const, startsAt: "2026-12-06T23:00:00Z" },
    ]
    const picks = ["s1", "s2"].map((seriesId) => ({
      id: seriesId, entryId: "e1", seriesId, pickTeamName: "Team",
      createdAt: "", updatedAt: "",
    }))
    expect(visiblePlayoffPicks(series, picks, now).map((pick) => pick.seriesId)).toEqual(["s1"])
  })
})
