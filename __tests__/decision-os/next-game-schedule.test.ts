/**
 * Slice 6 — next-game schedule projection for daily-cadence sports (pure).
 */
import { describe, expect, it } from "vitest"
import { projectNextGameContext } from "@/lib/decision-os/world/nextGameSchedule"
import type { RawScheduleGameRow } from "@/lib/decision-os/world/facts"

const NOW = new Date("2026-11-04T18:00:00.000Z")

function row(overrides: Partial<RawScheduleGameRow>): RawScheduleGameRow {
  return {
    sport: "NBA",
    season: 2026,
    week: 0,
    homeTeam: null,
    awayTeam: null,
    kickoffTime: null,
    status: "scheduled",
    source: "test",
    fetchedAt: new Date("2026-11-04T12:00:00.000Z"),
    expiresAt: new Date("2026-11-06T12:00:00.000Z"),
    updatedAt: new Date("2026-11-04T12:00:00.000Z"),
    sourceModel: "FantasyScheduleGame",
    ...overrides,
  }
}

const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 60 * 60_000)

describe("projectNextGameContext", () => {
  it("finds the next upcoming game and counts 7-day density", () => {
    const rows = [
      row({ homeTeam: "LAL", awayTeam: "BOS", kickoffTime: hoursFromNow(-20) }), // already played
      row({ homeTeam: "GSW", awayTeam: "LAL", kickoffTime: hoursFromNow(4) }), // tonight
      row({ homeTeam: "LAL", awayTeam: "PHX", kickoffTime: hoursFromNow(2 * 24) }),
      row({ homeTeam: "DEN", awayTeam: "LAL", kickoffTime: hoursFromNow(5 * 24) }),
      row({ homeTeam: "LAL", awayTeam: "MIA", kickoffTime: hoursFromNow(9 * 24) }), // beyond window
    ]
    const result = projectNextGameContext(rows, { teams: ["LAL"], now: NOW })
    const lal = result.byTeam.get("LAL")!
    expect(lal.nextOpponent).toBe("GSW")
    expect(lal.homeAway).toBe("away")
    expect(lal.nextGameAt).toBe(hoursFromNow(4).toISOString())
    expect(lal.gamesNext7Days).toBe(3)
    expect(result.resolvedTeams).toBe(1)
  })

  it("is honest when a team has no rows or no upcoming games", () => {
    const rows = [row({ homeTeam: "BOS", awayTeam: "NYK", kickoffTime: hoursFromNow(-48) })]
    const result = projectNextGameContext(rows, { teams: ["BOS", "CHI"], now: NOW })
    const bos = result.byTeam.get("BOS")!
    expect(bos.nextGameAt).toBeNull()
    expect(bos.warnings).toContain("no_upcoming_games_in_cache")
    const chi = result.byTeam.get("CHI")!
    expect(chi.warnings).toContain("schedule_unavailable")
    expect(result.resolvedTeams).toBe(0)
  })

  it("never guesses from rows missing kickoff timestamps", () => {
    const rows = [
      row({ homeTeam: "NYK", awayTeam: "BKN", kickoffTime: null }),
      row({ homeTeam: "PHI", awayTeam: "NYK", kickoffTime: null }),
    ]
    const result = projectNextGameContext(rows, { teams: ["NYK"], now: NOW })
    const nyk = result.byTeam.get("NYK")!
    expect(nyk.nextGameAt).toBeNull()
    expect(nyk.warnings).toContain("some_games_missing_kickoff_time")
    expect(nyk.warnings).toContain("no_kickoff_timestamps")
  })

  it("normalizes team casing on both sides", () => {
    const rows = [row({ homeTeam: "lal", awayTeam: "bos", kickoffTime: hoursFromNow(6) })]
    const result = projectNextGameContext(rows, { teams: ["Lal"], now: NOW })
    expect(result.byTeam.get("LAL")!.nextOpponent).toBe("BOS")
  })
})
