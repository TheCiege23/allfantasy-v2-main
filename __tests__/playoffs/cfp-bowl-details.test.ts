import { describe, expect, it } from "vitest"
import { parseCfpBowlDetails } from "@/lib/playoffs/cfpBowlDetails"

describe("CFP published bowl details", () => {
  it("preserves partial published dates, venues, and confirmed participants", () => {
    const result = parseCfpBowlDetails({ season: 2026, competition: "cfp", status: "selected", rounds: [
      { code: "quarterfinal", matchups: [{ bowlName: "Goodyear Cotton Bowl Classic", startDate: "2027-01-01T17:00:00Z", game: { venue: "AT&T Stadium" }, slots: [{ participant: { school: "Georgia" } }, { participant: { school: "UCLA" } }] }] },
      { code: "semifinal", matchups: [{ bowlName: "Allstate Sugar Bowl", startDate: null, slots: [] }] },
    ] })
    expect(result).toEqual([
      { label: "Cotton Bowl", startsAt: "2027-01-01T17:00:00.000Z", venue: "AT&T Stadium", homeTeamName: "Georgia", awayTeamName: "UCLA" },
      { label: "Sugar Bowl", startsAt: undefined, venue: undefined },
    ])
  })
  it("does not present unpublished or unrelated data as an official bowl assignment", () => {
    expect(parseCfpBowlDetails({ season: 2026, competition: "cfp", status: "scheduled", rounds: [] })).toEqual([])
    expect(parseCfpBowlDetails({ season: 2025, competition: "cfp", status: "selected", rounds: [] })).toEqual([])
    expect(parseCfpBowlDetails(null)).toEqual([])
  })
})
