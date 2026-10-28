import { describe, expect, it } from "vitest"
import { verifyBracketEvent } from "@/lib/playoffs/verifyBracketEvent"
import { validateBracketEventMaps } from "@/lib/playoffs/bracketEventMaps"

const event = {
  id: "401234567", date: "2026-12-20T00:00:00Z", season: { year: 2026, type: 3 },
  competitions: [{
    status: { type: { state: "post", completed: true } },
    competitors: [
      { homeAway: "home", team: { displayName: "Georgia Bulldogs", location: "Georgia" }, score: "31" },
      { homeAway: "away", team: { displayName: "Ole Miss Rebels", location: "Ole Miss" }, score: "24" },
    ],
  }],
}
const input = {
  payload: { events: [event] }, sport: "ncaaf" as const, season: 2026,
  eventId: "401234567", scheduledAt: "2026-12-20T00:00:00Z",
  homeTeam: "Georgia", awayTeam: "Ole Miss",
}

describe("season bracket provider result guard", () => {
  it("accepts a mapped CFP final with provider aliases", () => {
    const checked = verifyBracketEvent(input)
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.final).toMatchObject({ homeScore: 31, awayScore: 24 })
  })
  it("rejects a different event, opponent, kickoff, or season", () => {
    expect(verifyBracketEvent({ ...input, eventId: "401234568" })).toMatchObject({ reason: "event-not-found" })
    expect(verifyBracketEvent({ ...input, awayTeam: "Texas" })).toMatchObject({ reason: "team-mismatch" })
    expect(verifyBracketEvent({ ...input, scheduledAt: "2026-12-19T18:00:00Z" })).toMatchObject({ reason: "start-time-mismatch" })
    expect(verifyBracketEvent({ ...input, season: 2025 })).toMatchObject({ reason: "not-cfp-postseason" })
  })
  it("aligns neutral-site scores when ESPN reverses bracket sides", () => {
    const reversed = structuredClone(event)
    reversed.competitions[0].competitors[0].team = { displayName: "Ole Miss Rebels", location: "Ole Miss" }
    reversed.competitions[0].competitors[1].team = { displayName: "Georgia Bulldogs", location: "Georgia" }
    const checked = verifyBracketEvent({ ...input, payload: { events: [reversed] } })
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.final).toMatchObject({ homeScore: 24, awayScore: 31 })
  })
  it("rejects live and tied games", () => {
    const live = structuredClone(event)
    live.competitions[0].status.type.state = "in"
    live.competitions[0].status.type.completed = false
    expect(verifyBracketEvent({ ...input, payload: { events: [live] } })).toMatchObject({ reason: "not-final" })
    const tied = structuredClone(event)
    tied.competitions[0].competitors[1].score = "31"
    expect(verifyBracketEvent({ ...input, payload: { events: [tied] } })).toMatchObject({ reason: "invalid-final-score" })
  })
  it("allows only marked NBA Cup finals on the NBA regular season feed", () => {
    const cup = { ...structuredClone(event), season: { year: 2027, type: 2 }, competitions: [{
      ...structuredClone(event.competitions[0]), notes: [{ type: "event", headline: "NBA Cup - Quarterfinals" }],
    }] }
    const checked = verifyBracketEvent({ ...input, payload: { events: [cup] }, sport: "nba_cup", season: 2026 })
    expect(checked.ok).toBe(true)
    const ordinary = verifyBracketEvent({ ...input, payload: { events: [event] }, sport: "nba_cup", season: 2026 })
    expect(ordinary).toMatchObject({ reason: "not-nba-cup-event" })
  })
  it("rejects duplicate event assignments", () => {
    expect(validateBracketEventMaps("ncaaf", [
      { seriesNumber: 1, eventId: "401234567" },
      { seriesNumber: 2, eventId: "401234567" },
    ])).toMatchObject({ ok: false })
  })
})
