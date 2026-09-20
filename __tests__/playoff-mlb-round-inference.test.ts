import { describe, expect, it, vi } from "vitest"

/**
 * Round and league inference for MLB, pinned to the strings ESPN ACTUALLY
 * SENDS.
 *
 * Every headline below was read off ESPN's 2025 MLB postseason scoreboard, not
 * invented. That matters because the first version of these patterns WAS
 * invented, and two of them were wrong in ways nothing would have surfaced:
 *
 *   - "wild card" never appears; the label is `ALWC` / `NLWC`. Round 1 would
 *     never have been inferred, so no Wild Card series could resolve.
 *   - the league is a prefix of a single token, so `\bal\b` does not match
 *     `ALCS` and every series would have come back conference-less.
 *
 * If ESPN changes its vocabulary these tests should fail loudly — that is the
 * point of pinning the literal strings rather than a paraphrase.
 */

vi.mock("server-only", () => ({}))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

/** Exactly as observed on the 2025 postseason scoreboard. */
const REAL_2025_HEADLINES = {
  wildCard: ["ALWC - Game 2", "ALWC - Game 3", "NLWC - Game 2", "NLWC - Game 3"],
  division: ["ALDS - Game 1", "ALDS - Game 5", "NLDS - Game 3", "NLDS - Game 5"],
  championship: ["ALCS - Game 1", "ALCS - Game 5", "NLCS - Game 3"],
  worldSeries: ["World Series - Game 1", "World Series - Game 7"],
} as const

async function loadInternals() {
  const mod: any = await import("@/lib/playoffs/playoffSeriesSyncService")
  return mod
}

/**
 * The inference helpers are module-private, so they are exercised through the
 * exported surface that consumes them: a game only reaches a provider series
 * group if its round resolved.
 */
describe("MLB round inference — pinned to real ESPN 2025 headlines", () => {
  it("every observed headline maps to the round it names", async () => {
    const { __testing } = await loadInternals()
    // Guard the guard: if the internals stop being exported for test, say so
    // rather than passing vacuously.
    expect(__testing, "playoffSeriesSyncService must export __testing for this suite").toBeTruthy()

    const { roundIndexFromGame, conferenceFromEventName } = __testing
    const game = (eventName: string) => ({ homeTeam: "A", awayTeam: "B", eventName })

    for (const h of REAL_2025_HEADLINES.wildCard) {
      expect(roundIndexFromGame(game(h), "mlb"), h).toBe(1)
    }
    for (const h of REAL_2025_HEADLINES.division) {
      expect(roundIndexFromGame(game(h), "mlb"), h).toBe(2)
    }
    for (const h of REAL_2025_HEADLINES.championship) {
      expect(roundIndexFromGame(game(h), "mlb"), h).toBe(3)
    }
    for (const h of REAL_2025_HEADLINES.worldSeries) {
      expect(roundIndexFromGame(game(h), "mlb"), h).toBe(4)
    }
  })

  it("assigns each league half, and leaves the World Series to neither", async () => {
    const { __testing } = await loadInternals()
    const { conferenceFromEventName } = __testing
    const game = (eventName: string) => ({ homeTeam: "A", awayTeam: "B", eventName })

    expect(conferenceFromEventName(game("ALWC - Game 2"), "mlb")).toBe("al")
    expect(conferenceFromEventName(game("ALDS - Game 1"), "mlb")).toBe("al")
    expect(conferenceFromEventName(game("ALCS - Game 5"), "mlb")).toBe("al")
    expect(conferenceFromEventName(game("NLWC - Game 3"), "mlb")).toBe("nl")
    expect(conferenceFromEventName(game("NLDS - Game 4"), "mlb")).toBe("nl")
    expect(conferenceFromEventName(game("NLCS - Game 1"), "mlb")).toBe("nl")

    // Belongs to both leagues, therefore to neither half.
    expect(conferenceFromEventName(game("World Series - Game 7"), "mlb")).toBeNull()
  })

  /*
   * The baseball branch must not fire for other sports: `\bal(wc|ds|cs)\b` is
   * narrow, but the sport scoping is what guarantees it.
   */
  it("does not apply baseball vocabulary to other sports", async () => {
    const { __testing } = await loadInternals()
    const { conferenceFromEventName, roundIndexFromGame } = __testing
    const game = (eventName: string) => ({ homeTeam: "A", awayTeam: "B", eventName })

    expect(conferenceFromEventName(game("ALDS - Game 1"), "nba")).toBeNull()
    expect(roundIndexFromGame(game("ALWC - Game 2"), "nhl")).toBeNull()
  })

  /*
   * An MLB event whose label is unrecognised must DECLINE rather than fall
   * through to the generic conference/semifinal heuristics below it: an
   * unmatched group is skipped, a mis-bucketed one advances the wrong series.
   */
  it("declines an unrecognised MLB label instead of guessing", async () => {
    const { __testing } = await loadInternals()
    const { roundIndexFromGame } = __testing
    const game = (eventName: string) => ({ homeTeam: "A", awayTeam: "B", eventName })

    expect(roundIndexFromGame(game("Spring Training - Game 4"), "mlb")).toBeNull()
    expect(roundIndexFromGame(game(""), "mlb")).toBeNull()
  })

  /*
   * The plumbing half. The ESPN adapter dropped `eventName` entirely, so every
   * ESPN-sourced game reached the inference with nothing to read — for every
   * sport, not just baseball.
   */
  it("carries the provider event name through the ESPN adapter", async () => {
    const { __testing } = await loadInternals()
    const { rowToSyncGame } = __testing

    const row = {
      gameId: "1",
      homeTeam: "TB",
      awayTeam: "NYY",
      homeTeamFull: "Tampa Bay Rays",
      awayTeamFull: "New York Yankees",
      homeScore: 3,
      awayScore: 2,
      completed: true,
      status: "STATUS_FINAL",
      statusDetail: "Final",
      startTime: "2025-10-01T00:00:00Z",
      venue: "Tropicana Field",
      broadcast: "ESPN",
      eventName: "ALWC - Game 2",
    }

    expect(rowToSyncGame(row as never).eventName).toBe("ALWC - Game 2")
    // Absent stays absent — it must read as "the provider did not say", not "".
    expect(rowToSyncGame({ ...row, eventName: undefined } as never).eventName).toBeNull()
  })
})
