import { describe, expect, it } from "vitest"
import { projectCfpRankings } from "@/lib/playoffs/cfpRankingsProjection"

const names = ["Miami", "Georgia", "Utah", "Indiana", "Alabama", "Kentucky", "Texas", "UCLA", "BYU", "Ole Miss", "Notre Dame", "Ohio State", "Tennessee", "LSU", "Texas Tech", "Wake Forest", "Houston", "Missouri", "Iowa", "USC", "South Carolina", "Arizona", "Oregon", "Florida", "Boise State"]
const conferences = ["ACC", "SEC", "Big 12", "Big Ten", "SEC", "SEC", "SEC", "Big Ten", "Big 12", "SEC", "FBS Independents", "Big Ten", "SEC", "SEC", "Big 12", "ACC", "Big 12", "SEC", "Big Ten", "Big Ten", "SEC", "Big 12", "Big Ten", "SEC", "Pac-12"]
const ranks = names.map((school, i) => ({ rank: i + 1, school, conference: conferences[i] }))
const snapshot = (week: number, items = ranks) => ({ season: 2026, seasonType: "regular", week, polls: [{ poll: "Playoff Committee Rankings", ranks: items }] })

describe("CFP weekly projection", () => {
  it("uses the newest committee ranking and the projected Group of Six qualifier", () => {
    const result = projectCfpRankings([snapshot(10), snapshot(11)])!
    expect(result.rankingDate).toBe("2026-11-10")
    expect(result.teams).toEqual([...names.slice(0, 11), "Boise State"])
    expect(result.groupSix).toBe("Boise State")
    // Each seed carries its committee rank, in seed order.
    expect(result.ranks).toHaveLength(12)
    expect(result.ranks![0]).toBe(1)
    expect(result.ranks![11]).toBe(names.indexOf("Boise State") + 1)
  })
  it("includes the highest ranked team in every automatic-qualifier conference", () => {
    const altered = ranks.map((row, i) => ({ ...row, conference: i === 15 ? "ACC" : row.conference === "ACC" ? "SEC" : row.conference }))
    const result = projectCfpRankings([snapshot(10, altered)])!
    expect(result.teams).toContain("Wake Forest")
    expect(result.teams).toContain("Boise State")
    expect(result.teams).toHaveLength(12)
  })
  it("refuses incomplete, duplicated, or missing conference data rather than guessing", () => {
    expect(projectCfpRankings([snapshot(10, ranks.slice(0, 24))])).toBeNull()
    expect(projectCfpRankings([snapshot(10, ranks.map(row => ({ ...row, conference: "SEC" })))] )).toBeNull()
    expect(projectCfpRankings([snapshot(10, ranks.map((row, i) => i === 1 ? { ...row, school: "Miami" } : row))])).toBeNull()
  })
  it("recognizes the provider's American Athletic conference and protects Notre Dame in the top 12", () => {
    const altered = ranks.map((row, i) => ({ ...row, conference: i === 15 ? "ACC" : row.conference === "ACC" ? "SEC" : row.conference === "Pac-12" ? "American Athletic" : row.conference }))
    const result = projectCfpRankings([snapshot(10, altered)])!
    expect(result.teams).toContain("Notre Dame")
    expect(result.teams).toContain("Wake Forest")
    expect(result.groupSix).toBe("Boise State")
  })
  it("does not mistake the AP poll for the committee ranking", () => {
    const data = snapshot(10); data.polls[0].poll = "AP Top 25"
    expect(projectCfpRankings([data])).toBeNull()
  })
})
