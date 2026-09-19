import { describe, expect, it } from "vitest"
import { buildPlayoffTemplate, getPlayoffRoundOrder } from "@/lib/playoffs/playoffTemplate"

describe("playoff template", () => {
  it("builds a 16-team, 4-round bracket tree", () => {
    const template = buildPlayoffTemplate({ sport: "nba", seasonYear: 2026, isTestMode: false })

    expect(template).toHaveLength(15)
    expect(template.filter((series) => series.round === "round_1")).toHaveLength(8)
    expect(template.filter((series) => series.round === "conference_semifinals")).toHaveLength(4)
    expect(template.filter((series) => series.round === "conference_finals")).toHaveLength(2)
    expect(template.filter((series) => series.round === "finals")).toHaveLength(1)

    const finals = template.find((series) => series.seriesNumber === 15)
    expect(finals?.sourceSeriesHome).toBe(13)
    expect(finals?.sourceSeriesAway).toBe(14)
  })

  it("seeds named teams in test mode", () => {
    const nba = buildPlayoffTemplate({ sport: "nba", seasonYear: 2026, isTestMode: true })
    const nhl = buildPlayoffTemplate({ sport: "nhl", seasonYear: 2026, isTestMode: true })

    expect(nba[0]?.homeTeamName).toBe("Celtics")
    expect(nhl[0]?.homeTeamName).toBe("Rangers")
  })

  it("exposes round order for reusable boards", () => {
    expect(getPlayoffRoundOrder()).toEqual([
      "round_1",
      "conference_semifinals",
      "conference_finals",
      "finals",
    ])
  })
})

describe("playoff template — MLB", () => {
  const template = buildPlayoffTemplate({ sport: "mlb", seasonYear: 2026, isTestMode: false })
  const bySeriesNumber = new Map(template.map((series) => [series.seriesNumber, series]))

  it("builds a 12-team, 4-round, 11-series bracket", () => {
    expect(template).toHaveLength(11)
    expect(template.filter((series) => series.round === "wild_card")).toHaveLength(4)
    expect(template.filter((series) => series.round === "division_series")).toHaveLength(4)
    expect(template.filter((series) => series.round === "league_championship")).toHaveLength(2)
    expect(template.filter((series) => series.round === "world_series")).toHaveLength(1)
  })

  it("splits evenly between the two leagues and ends on one cross-league final", () => {
    expect(template.filter((series) => series.conference === "al")).toHaveLength(5)
    expect(template.filter((series) => series.conference === "nl")).toHaveLength(5)
    expect(template.filter((series) => series.conference === "finals")).toHaveLength(1)
  })

  it("uses the real series lengths per round", () => {
    const lengthsByRound = new Map(template.map((series) => [series.round, series.bestOf]))
    expect(lengthsByRound.get("wild_card")).toBe(3)
    expect(lengthsByRound.get("division_series")).toBe(5)
    expect(lengthsByRound.get("league_championship")).toBe(7)
    expect(lengthsByRound.get("world_series")).toBe(7)
  })

  it("gives the top two seeds in each league a bye by leaving them out of the wild card round", () => {
    const wildCardSeeds = template
      .filter((series) => series.round === "wild_card")
      .flatMap((series) => [series.homeSeed, series.awaySeed])

    expect(wildCardSeeds).not.toContain(1)
    expect(wildCardSeeds).not.toContain(2)
    expect([...new Set(wildCardSeeds)].sort()).toEqual([3, 4, 5, 6])

    // They enter at the Division Series instead, one per series.
    const divisionTopSeeds = template
      .filter((series) => series.round === "division_series")
      .map((series) => series.homeSeed)
      .sort()
    expect(divisionTopSeeds).toEqual([1, 1, 2, 2])
  })

  /*
   * The pairing that is easy to get backwards, and the reason this test names
   * the seeds rather than just counting rows: MLB does NOT reseed after the
   * Wild Card round. #1 meets the 4/5 survivor and #2 meets the 3/6 survivor.
   */
  it("feeds the fixed division-series pairing, not a reseeded one", () => {
    for (const [topSeedSeries, wildCardSeries] of [
      [5, 2],
      [6, 1],
      [7, 4],
      [8, 3],
    ] as const) {
      const division = bySeriesNumber.get(topSeedSeries)
      const wildCard = bySeriesNumber.get(wildCardSeries)
      expect(division?.sourceSeriesAway).toBe(wildCardSeries)
      expect(wildCard?.nextSeriesNumber).toBe(topSeedSeries)
      expect(wildCard?.nextSeriesSlot).toBe("away")
    }

    // #1 seeds (series 5 and 7) take the 4v5 survivor.
    expect(bySeriesNumber.get(2)?.homeSeed).toBe(4)
    expect(bySeriesNumber.get(2)?.awaySeed).toBe(5)
    expect(bySeriesNumber.get(4)?.homeSeed).toBe(4)
    expect(bySeriesNumber.get(4)?.awaySeed).toBe(5)
    expect(bySeriesNumber.get(5)?.homeSeed).toBe(1)
    expect(bySeriesNumber.get(7)?.homeSeed).toBe(1)

    // #2 seeds (series 6 and 8) take the 3v6 survivor.
    expect(bySeriesNumber.get(1)?.homeSeed).toBe(3)
    expect(bySeriesNumber.get(1)?.awaySeed).toBe(6)
    expect(bySeriesNumber.get(6)?.homeSeed).toBe(2)
    expect(bySeriesNumber.get(8)?.homeSeed).toBe(2)
  })

  it("wires every series into the world series and terminates there", () => {
    expect(bySeriesNumber.get(9)?.sourceSeriesHome).toBe(5)
    expect(bySeriesNumber.get(9)?.sourceSeriesAway).toBe(6)
    expect(bySeriesNumber.get(10)?.sourceSeriesHome).toBe(7)
    expect(bySeriesNumber.get(10)?.sourceSeriesAway).toBe(8)

    const worldSeries = bySeriesNumber.get(11)
    expect(worldSeries?.sourceSeriesHome).toBe(9)
    expect(worldSeries?.sourceSeriesAway).toBe(10)
    expect(worldSeries?.nextSeriesNumber).toBeNull()
    expect(worldSeries?.nextSeriesSlot).toBeNull()

    // Exactly one series has no onward slot, and it is the final.
    const terminal = template.filter((series) => series.nextSeriesNumber === null)
    expect(terminal.map((series) => series.seriesNumber)).toEqual([11])
  })

  it("names seed slots so they read as settled and placeholders so they do not", async () => {
    const { isOfficialTeamName, isPlayoffSeriesResolved } = await import(
      "@/lib/playoffs/playoffBracketProjection"
    )

    // A seeded slot must be pickable before the field is populated…
    expect(isOfficialTeamName(bySeriesNumber.get(5)?.homeTeamName)).toBe(true)
    expect(bySeriesNumber.get(5)?.homeTeamName).toBe("AL1")
    // …and a slot waiting on an earlier round must not be.
    expect(isOfficialTeamName(bySeriesNumber.get(5)?.awayTeamName)).toBe(false)
    expect(isOfficialTeamName(bySeriesNumber.get(11)?.homeTeamName)).toBe(false)

    const asView = (series: (typeof template)[number]) => ({ ...series, id: `s${series.seriesNumber}` }) as never

    // Only the four Wild Card series are pickable on a fresh bracket.
    const resolved = template.filter((series) => isPlayoffSeriesResolved(asView(series)))
    expect(resolved.map((series) => series.seriesNumber)).toEqual([1, 2, 3, 4])
  })

  it("seeds named clubs in test mode, six per league", () => {
    const testTemplate = buildPlayoffTemplate({ sport: "mlb", seasonYear: 2026, isTestMode: true })
    const wildCard = testTemplate.filter((series) => series.round === "wild_card")

    expect(wildCard[0]?.homeTeamName).toBe("Astros")
    expect(wildCard[0]?.awayTeamName).toBe("Tigers")
    expect(wildCard[2]?.homeTeamName).toBe("Brewers")

    // The bye seeds still resolve to real clubs where they enter.
    const alTopSeed = testTemplate.find((series) => series.seriesNumber === 5)
    expect(alTopSeed?.homeTeamName).toBe("Yankees")
  })

  it("exposes the baseball round order, and leaves the default alone", () => {
    expect(getPlayoffRoundOrder("mlb")).toEqual([
      "wild_card",
      "division_series",
      "league_championship",
      "world_series",
    ])
    expect(getPlayoffRoundOrder("nba")).toEqual(getPlayoffRoundOrder())
  })
})
