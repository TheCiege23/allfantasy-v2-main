import { describe, expect, it } from "vitest"
import { buildPlayoffTemplate, formatPlayoffTemplateTeamWithSeed, getPlayoffRoundOrder } from "@/lib/playoffs/playoffTemplate"

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

  it("suffixes franchise names with conference seed tags for Round 1 template rows", () => {
    expect(formatPlayoffTemplateTeamWithSeed("Celtics", "east", 1)).toBe("Celtics (E1)")
    expect(formatPlayoffTemplateTeamWithSeed("Thunder", "west", 1)).toBe("Thunder (W1)")
  })

  it("uses readable MVP lab names for NHL/NBA round 1 (template, not seed placeholders)", () => {
    const nbaProd = buildPlayoffTemplate({ sport: "nba", seasonYear: 2026 })
    const nhlProd = buildPlayoffTemplate({ sport: "nhl", seasonYear: 2026 })
    const nbaTest = buildPlayoffTemplate({ sport: "nba", seasonYear: 2026, isTestMode: true })
    expect(nhlProd[0]?.homeTeamName).toBe("Rangers (E1)")
    expect(nhlProd.find((s) => s.seriesNumber === 5)?.awayTeamName).toMatch(/\(W\d+\)/)
    expect(nbaProd[0]?.homeTeamName).toBe("Celtics (E1)")
    expect(nbaProd[0]?.awayTeamName).toBe("76ers (E8)")
    expect(nbaProd[0]?.awayTeamName).not.toMatch(/^EAST\d+$/i)
    expect(nbaTest[0]?.homeTeamName).toBe("Celtics (E1)")
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
