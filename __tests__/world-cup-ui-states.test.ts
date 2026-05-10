import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  getBracketBlockReason,
  mapJoinError,
  formatWorldCupPlaceholder,
} from "@/lib/world-cup/worldCupBracketUtils"
import {
  assertWorldCupPickPayloadReady,
  buildWorldCupProjectedMatches,
  getWorldCupGuidedPicksState,
  getWorldCupUnpickableReason,
  hasWorldCupPickSelection,
  isBracketComplete,
  isWorldCupMatchPickable,
} from "@/lib/world-cup/worldCupProjectedBracket"
import type { WorldCupMatchView, WorldCupPickView } from "@/lib/world-cup/types"

const root = resolve(__dirname, "..")
const pickerSrc = readFileSync(
  resolve(root, "components/brackets/world-cup/WorldCupGuidedMatchupPicker.tsx"),
  "utf8"
)

function makePick(
  matchId: string,
  round: WorldCupMatchView["round"],
  selectedTeamId: string,
  selectedSlotKey: string
): WorldCupPickView {
  return {
    id: `pick-${matchId}`,
    matchId,
    round,
    selectedTeamId,
    selectedSlotKey,
    selectedTeamName: "Team",
    pointsAwarded: 0,
    isCorrect: null,
    lockedAt: null,
  }
}

function makeMatch(overrides: Partial<WorldCupMatchView> = {}): WorldCupMatchView {
  return {
    id: "m1",
    apiFixtureId: null,
    round: "round_of_32",
    roundIndex: 1,
    matchNumber: 1,
    homeSlotKey: "A1",
    awaySlotKey: "B2",
    homeTeamId: "team-a",
    awayTeamId: "team-b",
    homeTeamName: "Argentina",
    awayTeamName: "Brazil",
    homeTeamLogo: null,
    awayTeamLogo: null,
    homeScore: null,
    awayScore: null,
    homePenaltyScore: null,
    awayPenaltyScore: null,
    status: "scheduled",
    startsAt: null,
    winnerTeamId: null,
    winnerTeamName: null,
    nextMatchId: null,
    nextMatchSlot: null,
    elapsedMinute: null,
    injuryTime: null,
    period: null,
    venueName: null,
    venueCity: null,
    apiStatusShort: null,
    lastScoreSyncedAt: null,
    ...overrides,
  }
}

describe("formatWorldCupPlaceholder", () => {
  it("formats group winner slots", () => {
    expect(formatWorldCupPlaceholder("A1", "TBD", null)).toBe("Group A Winner")
    expect(formatWorldCupPlaceholder("H1", "TBD", null)).toBe("Group H Winner")
  })

  it("formats group runner-up slots", () => {
    expect(formatWorldCupPlaceholder("B2", "TBD", null)).toBe("Group B Runner-up")
    expect(formatWorldCupPlaceholder("D2", "TBD", null)).toBe("Group D Runner-up")
  })

  it("formats best-3rd-place slot", () => {
    expect(formatWorldCupPlaceholder("A3", "TBD", null)).toBe("Best 3rd Place Qualifier")
  })

  it("formats TBD qualifier slots", () => {
    expect(formatWorldCupPlaceholder("TBD2", "TBD", null)).toBe("TBD Qualifier 2")
    expect(formatWorldCupPlaceholder("TBD10", "TBD", null)).toBe("TBD Qualifier 10")
  })

  it("formats match winner slots", () => {
    expect(formatWorldCupPlaceholder("W-M5", "TBD", null)).toBe("Winner Match 5")
  })

  it("formats match loser slots", () => {
    expect(formatWorldCupPlaceholder("L-M3", "TBD", null)).toBe("Loser Match 3")
  })

  it("returns the teamName as-is when a real team is set", () => {
    expect(formatWorldCupPlaceholder("A1", "Brazil", 10)).toBe("Brazil")
  })

  it("falls back to TBD for unrecognised slot keys", () => {
    expect(formatWorldCupPlaceholder("UNKNOWN", "TBD", null)).toBe("TBD")
  })
})

describe("getBracketBlockReason", () => {
  it("returns ended message for final status", () => {
    expect(
      getBracketBlockReason({
        inviteCode: "INV1",
        challengeId: "wc1",
        name: "Challenge",
        ownerName: "Owner",
        seasonYear: 2026,
        participantCount: 3,
        status: "final",
      })
    ).toBe("This bracket challenge has ended.")
  })

  it("returns locked message for locked status", () => {
    expect(
      getBracketBlockReason({
        inviteCode: "INV1",
        challengeId: "wc1",
        name: "Challenge",
        ownerName: "Owner",
        seasonYear: 2026,
        participantCount: 3,
        status: "locked",
      })
    ).toBe("This bracket is locked — picks are no longer accepted.")
  })

  it("returns null for open status", () => {
    expect(
      getBracketBlockReason({
        inviteCode: "INV1",
        challengeId: "wc1",
        name: "Challenge",
        ownerName: "Owner",
        seasonYear: 2026,
        participantCount: 3,
        status: "open",
      })
    ).toBeNull()
  })
})

describe("mapJoinError", () => {
  it("maps duplicate participant error", () => {
    expect(mapJoinError("duplicate participant")).toBe("You have already joined this bracket.")
  })

  it("maps locked error", () => {
    expect(mapJoinError("locked")).toBe("This bracket is locked — picks are no longer accepted.")
  })

  it("maps full error", () => {
    expect(mapJoinError("challenge is full")).toBe("This bracket is full.")
  })

  it("returns a generic fallback for unknown errors", () => {
    const result = mapJoinError("some unexpected error")
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })
})

describe("World Cup pick readiness guards", () => {
  it("returns fixtures_not_synced when matches are empty", () => {
    expect(getWorldCupGuidedPicksState([])).toBe("fixtures_not_synced")
  })

  it("returns fixtures_not_ready when matches exist without real team IDs", () => {
    const unresolved = [
      makeMatch({
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: "A1",
        awayTeamName: "B2",
      }),
    ]
    expect(getWorldCupGuidedPicksState(unresolved)).toBe("fixtures_not_ready")
  })

  it("returns ready when at least one pickable match exists", () => {
    expect(getWorldCupGuidedPicksState([makeMatch()])).toBe("ready")
  })

  it("moves from fixtures_not_ready to ready when first-round matches get team IDs", () => {
    const unresolvedFirstRound = Array.from({ length: 16 }, (_, idx) =>
      makeMatch({
        id: `m-${idx + 1}`,
        matchNumber: idx + 1,
        round: "round_of_32",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: `A${idx + 1}`,
        awayTeamName: `B${idx + 1}`,
      })
    )
    expect(getWorldCupGuidedPicksState(unresolvedFirstRound)).toBe("fixtures_not_ready")

    const resolvedFirstRound = unresolvedFirstRound.map((match, idx) => ({
      ...match,
      homeTeamId: `demo-home-${idx + 1}`,
      awayTeamId: `demo-away-${idx + 1}`,
      homeTeamName: `Home ${idx + 1}`,
      awayTeamName: `Away ${idx + 1}`,
    }))

    const pickableCount = resolvedFirstRound.filter((m) => isWorldCupMatchPickable(m)).length
    expect(pickableCount).toBe(16)
    expect(getWorldCupGuidedPicksState(resolvedFirstRound)).toBe("ready")
  })

  it("reports missing_home_team reason for unresolved home team", () => {
    const match = makeMatch({ homeTeamId: null })
    expect(getWorldCupUnpickableReason(match)).toBe("missing_home_team")
    expect(isWorldCupMatchPickable(match)).toBe(false)
  })

  it("reports missing_away_team reason for unresolved away team", () => {
    const match = makeMatch({ awayTeamId: null })
    expect(getWorldCupUnpickableReason(match)).toBe("missing_away_team")
    expect(isWorldCupMatchPickable(match)).toBe(false)
  })

  it("throws clear guided save error when selectedTeamId is missing", () => {
    expect(() =>
      assertWorldCupPickPayloadReady({
        selectedTeamId: null,
      })
    ).toThrow("This matchup is not ready for picks yet.")
  })

  it("fixtures_not_ready state has no pickable matches until team IDs are set", () => {
    // Simulates the state shown to the user before Load Test Fixtures runs
    const bracketMatches = Array.from({ length: 31 }, (_, idx) =>
      makeMatch({
        id: `m-${idx + 1}`,
        matchNumber: idx + 1,
        round: idx < 16 ? "round_of_32" : idx < 24 ? "round_of_16" : idx < 28 ? "quarterfinal" : idx < 30 ? "semifinal" : "final",
        homeTeamId: null,
        awayTeamId: null,
        homeTeamName: `TBD-H${idx + 1}`,
        awayTeamName: `TBD-A${idx + 1}`,
      })
    )
    expect(getWorldCupGuidedPicksState(bracketMatches)).toBe("fixtures_not_ready")
    expect(bracketMatches.filter((m) => isWorldCupMatchPickable(m)).length).toBe(0)

    // After Load Test Fixtures patches Round of 32 matches with real team IDs
    const after = bracketMatches.map((m, idx) =>
      idx < 16
        ? { ...m, homeTeamId: `demo-home-${idx + 1}`, awayTeamId: `demo-away-${idx + 1}`, homeTeamName: `Team ${idx * 2 + 1}`, awayTeamName: `Team ${idx * 2 + 2}`, apiStatusShort: "TEST" }
        : m
    )
    expect(getWorldCupGuidedPicksState(after)).toBe("ready")
    expect(after.filter((m) => isWorldCupMatchPickable(m)).length).toBe(16)
  })
})

// ---------------------------------------------------------------------------
// Source invariants: pick handler structure (behaviors 1–6)
// ---------------------------------------------------------------------------

describe("WorldCupGuidedMatchupPicker — pick handler source invariants (behaviors 1–6)", () => {
  it("behavior 1: home team button calls onPick(\"home\")", () => {
    expect(pickerSrc).toMatch(/onPick=\{.*onPick\("home"\)/)
  })

  it("behavior 2: away team button calls onPick(\"away\")", () => {
    expect(pickerSrc).toMatch(/onPick=\{.*onPick\("away"\)/)
  })

  it("behavior 3: success path never calls onClose — modal stays open after save", () => {
    const handlePickMatch = pickerSrc.match(/const handlePick = useCallback\(\s*async[\s\S]*?^\s*\},\s*\[/m)
    expect(handlePickMatch).not.toBeNull()
    const successBlock = handlePickMatch![0].split("} catch")[0]
    expect(successBlock).not.toMatch(/onClose\(\)/)
  })

  it("behavior 4: success path calls goToNext with serverPicks to advance to next matchup", () => {
    expect(pickerSrc).toMatch(/goToNext\(currentMatch\.id, serverPicks\)/)
  })

  it("behavior 5: catch block exposes error message via setSaveError", () => {
    expect(pickerSrc).toMatch(/setSaveError\(err instanceof Error \? err\.message/)
  })

  it("behavior 6: catch block rolls back optimistic picks on failure", () => {
    expect(pickerSrc).toMatch(/Roll back optimistic update[\s\S]{0,60}setPicks\(picks\)/)
  })

  it("behavior 6: catch block does NOT call goToNext — failed save does not advance", () => {
    const catchMatch = pickerSrc.match(/\} catch \(err\) \{([\s\S]*?)setSaveError/)
    expect(catchMatch).not.toBeNull()
    expect(catchMatch![1]).not.toMatch(/goToNext/)
  })

  it("completion detection useEffect uses projected not pickableProjected (false-completion fix)", () => {
    expect(pickerSrc).toMatch(/if \(isBracketComplete\(projected, picks, includeThirdPlace\)\)/)
    expect(pickerSrc).not.toMatch(/if \(isBracketComplete\(pickableProjected, picks, includeThirdPlace\)\)/)
  })

  it("isOpen useEffect uses projected not pickableProjected for showComplete", () => {
    expect(pickerSrc).toMatch(/setShowComplete\(isBracketComplete\(projected, picks, includeThirdPlace\)\)/)
    expect(pickerSrc).not.toMatch(/setShowComplete\(isBracketComplete\(pickableProjected, picks, includeThirdPlace\)\)/)
  })
})

// ---------------------------------------------------------------------------
// isBracketComplete logic — false-completion prevention (behaviors 7–9)
// ---------------------------------------------------------------------------

// Matches without nextMatchId linkage: projected cannot fill in the final.
const noLinkMatches: WorldCupMatchView[] = [
  makeMatch({ id: "m1", homeTeamId: "h1", awayTeamId: "a1", homeTeamName: "Home1", awayTeamName: "Away1", nextMatchId: null }),
  makeMatch({ id: "m2", homeTeamId: "h2", awayTeamId: "a2", homeTeamName: "Home2", awayTeamName: "Away2", nextMatchId: null }),
  makeMatch({ id: "fin", round: "final", homeTeamId: null, awayTeamId: null, homeTeamName: "TBD", awayTeamName: "TBD", nextMatchId: null }),
]

// Matches with proper nextMatchId links: projected can fill in the final.
const linkedMatches: WorldCupMatchView[] = [
  makeMatch({ id: "q1", homeTeamId: "h1", awayTeamId: "a1", homeTeamName: "Home1", awayTeamName: "Away1", nextMatchId: "fin", nextMatchSlot: "home" }),
  makeMatch({ id: "q2", homeTeamId: "h2", awayTeamId: "a2", homeTeamName: "Home2", awayTeamName: "Away2", nextMatchId: "fin", nextMatchSlot: "away" }),
  makeMatch({ id: "fin", round: "final", homeTeamId: null, awayTeamId: null, homeTeamName: "TBD", awayTeamName: "TBD", nextMatchId: null }),
]

describe("isBracketComplete — false completion prevention (behaviors 7–9)", () => {
  it("behavior 9: picks for only early-round matches do NOT mark complete when final is unpicked", () => {
    const picks = [
      makePick("m1", "round_of_32", "h1", "A1"),
      makePick("m2", "round_of_32", "h2", "B2"),
    ]
    const projected = buildWorldCupProjectedMatches(noLinkMatches, picks)
    // All 3 matches required; final has no pick → not complete
    expect(isBracketComplete(projected, picks)).toBe(false)
  })

  it("documents the old bug: pickableProjected-only check would falsely complete", () => {
    const picks = [
      makePick("m1", "round_of_32", "h1", "A1"),
      makePick("m2", "round_of_32", "h2", "B2"),
    ]
    const projected = buildWorldCupProjectedMatches(noLinkMatches, picks)
    const pickableProjected = projected.filter(isWorldCupMatchPickable)
    // Final is not pickable (no teams), so pickableProjected is only [m1, m2]
    // isBracketComplete against that subset falsely returns true — this was the bug
    expect(pickableProjected).toHaveLength(2)
    expect(isBracketComplete(pickableProjected, picks)).toBe(true)
    // But against all projected (3 matches) it correctly returns false
    expect(isBracketComplete(projected, picks)).toBe(false)
  })

  it("behavior 7: all qualifying matches picked → projection fills final team slots", () => {
    const picks = [
      makePick("q1", "round_of_32", "h1", "A1"),
      makePick("q2", "round_of_32", "h2", "B2"),
    ]
    const projected = buildWorldCupProjectedMatches(linkedMatches, picks)
    const final = projected.find((m) => m.id === "fin")!
    expect(final.homeTeamId).toBe("h1")
    expect(final.awayTeamId).toBe("h2")
    expect(isWorldCupMatchPickable(final)).toBe(true)
  })

  it("behavior 8: champion pick with all downstream picks marks bracket complete", () => {
    const picks = [
      makePick("q1", "round_of_32", "h1", "A1"),
      makePick("q2", "round_of_32", "h2", "B2"),
      makePick("fin", "final", "h1", "A1"),
    ]
    const projected = buildWorldCupProjectedMatches(linkedMatches, picks)
    expect(isBracketComplete(projected, picks)).toBe(true)
  })

  it("bracket is NOT complete when any required match lacks a pick", () => {
    const picks = [makePick("q1", "round_of_32", "h1", "A1")]
    const projected = buildWorldCupProjectedMatches(linkedMatches, picks)
    expect(isBracketComplete(projected, picks)).toBe(false)
  })

  it("hasWorldCupPickSelection returns false for null selectedTeamId", () => {
    const emptyPick: WorldCupPickView = {
      id: "p1", matchId: "m1", round: "round_of_32",
      selectedTeamId: null, selectedSlotKey: null,
      selectedTeamName: "", pointsAwarded: 0, isCorrect: null, lockedAt: null,
    }
    expect(hasWorldCupPickSelection(emptyPick)).toBe(false)
  })
})
