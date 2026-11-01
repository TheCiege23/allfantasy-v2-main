import { describe, expect, it } from "vitest"
import wildCard from "../../contracts/espn/fixtures/scoreboard.NFL.20260110.json"
import divisional from "../../contracts/espn/fixtures/scoreboard.NFL.20260117.json"
import conference from "../../contracts/espn/fixtures/scoreboard.NFL.20260125.json"
import superBowl from "../../contracts/espn/fixtures/scoreboard.NFL.20260208.json"
import {
  assignNflSlots,
  buildNflTemplate,
  nflDivisionalMatchups,
  orientToSlot,
  parseNflPlayoffScoreboard,
} from "@/lib/playoffs/nflPlayoffs"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"
import { buildBracketGraph, roundLabel } from "@/lib/playoffs/playoffBracketGraph"
import {
  buildProjectedPlayoffSeries,
  getDependentPlayoffSeriesIds,
  isPlayoffSeriesResolved,
} from "@/lib/playoffs/playoffBracketProjection"
import { roundPointsTable } from "@/lib/playoffs/playoffScoring"
import { defaultPlayoffSeasonYear, firstGameDeadline, isSingleGameBracketSport } from "@/lib/playoffs/playoffCompetition"
import type { PlayoffPickView, PlayoffSeriesView } from "@/lib/playoffs/types"

/**
 * A field consistent with every captured 2025 postseason game (CAR v LAR is 4v5, CHI v GB 2v7,
 * DEN v BUF 1v6, SEA v SF 1v6). Test data, not a claim about the official seeds.
 */
const FIELD = new Map([
  ["afc", new Map([[1, "Denver Broncos"], [2, "New England Patriots"], [3, "Jacksonville Jaguars"], [4, "Pittsburgh Steelers"], [5, "Houston Texans"], [6, "Buffalo Bills"], [7, "Los Angeles Chargers"]])],
  ["nfc", new Map([[1, "Seattle Seahawks"], [2, "Chicago Bears"], [3, "Philadelphia Eagles"], [4, "Carolina Panthers"], [5, "Los Angeles Rams"], [6, "San Francisco 49ers"], [7, "Green Bay Packers"]])],
])

/** The live (non-test) template with the field filled in, as seeding would leave it. */
function seededRows(): PlayoffSeriesView[] {
  return buildPlayoffTemplate({ sport: "nfl", seasonYear: 2025 }).map((row) => {
    const fill = (name: string) => {
      const hit = /^(AFC|NFC)(\d)$/.exec(name)
      return hit ? FIELD.get(hit[1].toLowerCase())!.get(Number(hit[2]))! : name
    }
    return { ...row, id: `s${row.seriesNumber}`, homeTeamName: fill(row.homeTeamName), awayTeamName: fill(row.awayTeamName) }
  }) as PlayoffSeriesView[]
}

const pick = (seriesNumber: number, team: string): PlayoffPickView =>
  ({ id: `p${seriesNumber}`, entryId: "e", seriesId: `s${seriesNumber}`, pickTeamName: team, createdAt: "", updatedAt: "" })

describe("NFL playoff template", () => {
  it("is fourteen teams in thirteen single games, AFC on one side and NFC on the other, meeting in the Super Bowl", () => {
    const rows = buildNflTemplate(false)
    expect(rows).toHaveLength(13)
    expect(rows.every((r) => r.bestOf === 1)).toBe(true)
    expect(rows.filter((r) => r.round === "nfl_wild_card").map((r) => `${r.conference}:${r.homeTeamName}v${r.awayTeamName}`)).toEqual([
      "afc:AFC2vAFC7", "afc:AFC3vAFC6", "afc:AFC4vAFC5", "nfc:NFC2vNFC7", "nfc:NFC3vNFC6", "nfc:NFC4vNFC5",
    ])
    const graph = buildBracketGraph(rows.map((r) => ({ ...r, id: String(r.seriesNumber) })) as PlayoffSeriesView[])
    expect(graph.sides).toEqual({ left: "afc", right: "nfc" })
    expect(graph.final?.series.round).toBe("nfl_super_bowl")
    expect(roundLabel("nfl", "nfl_divisional")).toBe("Divisional")
    expect(roundPointsTable("nfl").map((t) => t.points)).toEqual([1, 2, 4, 8])
    expect(isSingleGameBracketSport("nfl")).toBe(true)
  })

  it("puts the 1 seeds in the divisional round and nowhere earlier", () => {
    const rows = buildNflTemplate(false)
    expect(rows.filter((r) => /^(AFC|NFC)1$/.test(r.homeTeamName)).map((r) => r.round)).toEqual(["nfl_divisional", "nfl_divisional"])
  })
})

describe("divisional reseeding", () => {
  it("sends the 1 seed against the LOWEST seed left, and the other two winners to the second game", () => {
    const rows = seededRows()
    // AFC chalk except the 7 seed beats the 2: winners are 7, 3, 4 -> 1 v 7, 3 v 4.
    const winners = new Map([[1, "Los Angeles Chargers"], [2, "Jacksonville Jaguars"], [3, "Pittsburgh Steelers"]])
    const m = nflDivisionalMatchups(rows, winners)
    expect(m.get(7)).toEqual({ homeTeamName: "Denver Broncos", homeSeed: 1, awayTeamName: "Los Angeles Chargers", awaySeed: 7 })
    expect(m.get(8)).toEqual({ homeTeamName: "Jacksonville Jaguars", homeSeed: 3, awayTeamName: "Pittsburgh Steelers", awaySeed: 4 })
  })

  it("matches what actually happened in the captured NFC bracket: 1 v 6 after the 6 seed advanced", () => {
    const rows = seededRows()
    // Captured: SF (6) and LAR (5) won; CHI (2) beat GB (7). Lowest left is SF -> SEA v SF, as ESPN shows.
    const m = nflDivisionalMatchups(rows, new Map([[4, "Chicago Bears"], [5, "San Francisco 49ers"], [6, "Los Angeles Rams"]]))
    expect(m.get(9)).toMatchObject({ homeTeamName: "Seattle Seahawks", awayTeamName: "San Francisco 49ers", awaySeed: 6 })
    expect(m.get(10)).toMatchObject({ homeTeamName: "Chicago Bears", awayTeamName: "Los Angeles Rams" })
  })

  it("decides nothing until all three Wild Card games of a conference are decided", () => {
    const m = nflDivisionalMatchups(seededRows(), new Map([[1, "New England Patriots"], [2, "Jacksonville Jaguars"]]))
    expect(m.has(7)).toBe(false)
    expect(m.has(8)).toBe(false)
  })

  it("projects an entry's divisional games from its own Wild Card picks, and leaves them unpickable until then", () => {
    const rows = seededRows()
    const partial = buildProjectedPlayoffSeries(rows, [pick(1, "New England Patriots")])
    expect(isPlayoffSeriesResolved(partial.find((r) => r.seriesNumber === 7)!)).toBe(false)
    expect(isPlayoffSeriesResolved(partial.find((r) => r.seriesNumber === 8)!)).toBe(false)

    const full = buildProjectedPlayoffSeries(rows, [pick(1, "New England Patriots"), pick(2, "Buffalo Bills"), pick(3, "Houston Texans")])
    // Winners 2, 6, 5 -> 1 v 6, 2 v 5.
    expect(full.find((r) => r.seriesNumber === 7)).toMatchObject({ homeTeamName: "Denver Broncos", awayTeamName: "Buffalo Bills", awaySeed: 6 })
    expect(full.find((r) => r.seriesNumber === 8)).toMatchObject({ homeTeamName: "New England Patriots", awayTeamName: "Houston Texans" })
    expect(isPlayoffSeriesResolved(full.find((r) => r.seriesNumber === 8)!)).toBe(true)
  })

  it("keeps a published official matchup in official mode", () => {
    const rows = seededRows().map((r) => r.seriesNumber === 7 ? { ...r, awayTeamName: "Buffalo Bills", awaySeed: 6 } : r)
    const official = buildProjectedPlayoffSeries(rows, [], { includeUserPicks: false })
    expect(official.find((r) => r.seriesNumber === 7)?.awayTeamName).toBe("Buffalo Bills")
  })

  it("clears BOTH divisional picks (and everything after them) when any Wild Card pick in that conference changes", () => {
    const dependents = getDependentPlayoffSeriesIds("s3", seededRows())
    expect([...dependents].sort()).toEqual(["s11", "s13", "s7", "s8"])
    // The other conference's divisional games are untouched.
    expect(dependents.has("s9")).toBe(false)
  })
})

describe("ESPN postseason scoreboard", () => {
  it("reads every captured round, its conference and its winner", () => {
    const games = [wildCard, divisional, conference, superBowl].flatMap((f) => parseNflPlayoffScoreboard(f, 2025))
    expect(games.map((g) => `${g.round}:${g.conference}:${g.winnerTeamName}`)).toEqual([
      "nfl_wild_card:nfc:Los Angeles Rams",
      "nfl_wild_card:nfc:Chicago Bears",
      "nfl_divisional:afc:Denver Broncos",
      "nfl_divisional:nfc:Seattle Seahawks",
      "nfl_conference:afc:New England Patriots",
      "nfl_conference:nfc:Seattle Seahawks",
      "nfl_super_bowl:finals:Seattle Seahawks",
    ])
    expect(games[0]).toMatchObject({ homeTeamName: "Carolina Panthers", awayTeamName: "Los Angeles Rams", homeScore: 31, awayScore: 34, status: "final", venue: "Bank of America Stadium" })
  })

  it("ignores another season and any event without a playoff headline", () => {
    expect(parseNflPlayoffScoreboard(wildCard, 2026)).toEqual([])
    const regular = structuredClone(wildCard) as any
    regular.events[0].competitions[0].notes = []
    expect(parseNflPlayoffScoreboard(regular, 2025)).toHaveLength(1)
  })

  it("places each game in its slot by the seeded field, and the Super Bowl with the AFC side home", () => {
    const games = [wildCard, divisional, conference, superBowl].flatMap((f) => parseNflPlayoffScoreboard(f, 2025))
    const { placed, rejected } = assignNflSlots(games, FIELD)
    expect(rejected).toEqual([])
    expect(placed.map((g) => `${g.seriesNumber}:${g.homeTeamName}`)).toEqual([
      "6:Carolina Panthers", "4:Chicago Bears", "7:Denver Broncos", "9:Seattle Seahawks",
      "11:Denver Broncos", "12:Seattle Seahawks", "13:New England Patriots",
    ])
    const sb = placed.find((g) => g.seriesNumber === 13)!
    expect(orientToSlot(sb, "New England Patriots")).toMatchObject({ homeTeamName: "New England Patriots", homeScore: 13, awayScore: 29 })
    expect(orientToSlot(sb, "Seattle Seahawks")).toMatchObject({ homeTeamName: "Seattle Seahawks", homeScore: 29, awayScore: 13 })
  })

  it("refuses a game the seeded field does not predict, instead of guessing a slot", () => {
    const games = parseNflPlayoffScoreboard(wildCard, 2025)
    const wrong = new Map([...FIELD].map(([conf, seeds]) => [conf, new Map(seeds)]))
    // Swap the 4 and 2 seeds: CAR v LAR becomes 2 v 5 — not a Wild Card pairing.
    wrong.get("nfc")!.set(2, "Carolina Panthers").set(4, "Chicago Bears")
    const { placed, rejected } = assignNflSlots(games, wrong)
    expect(placed).toHaveLength(0)
    expect(rejected.map((r) => r.reason)).toEqual(["seeds 2 v 5 are not a Wild Card pairing", "seeds 4 v 7 are not a Wild Card pairing"])
  })
})

describe("NFL lock and season", () => {
  it("locks at the first Wild Card kickoff even though later rounds have no times yet", () => {
    const rows = seededRows().map((r) => r.round === "nfl_wild_card" ? { ...r, startsAt: `2027-01-${10 + (r.seriesNumber % 3)}T18:00:00.000Z` } : r)
    expect(firstGameDeadline(rows)).toBe(Date.parse("2027-01-10T18:00:00.000Z"))
    expect(firstGameDeadline(seededRows())).toBeNull()
  })

  it("files a pool created in January or February under the season that started the year before", () => {
    expect(defaultPlayoffSeasonYear("nfl", new Date("2027-01-05T00:00:00Z"))).toBe(2026)
    expect(defaultPlayoffSeasonYear("ncaaf", new Date("2027-02-01T00:00:00Z"))).toBe(2026)
    expect(defaultPlayoffSeasonYear("nfl", new Date("2026-11-01T00:00:00Z"))).toBe(2026)
    expect(defaultPlayoffSeasonYear("nba_cup", new Date("2027-01-05T00:00:00Z"))).toBe(2027)
  })
})
