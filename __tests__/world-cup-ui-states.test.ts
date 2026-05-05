import { describe, expect, it } from "vitest"
import {
  getBracketBlockReason,
  mapJoinError,
  formatWorldCupPlaceholder,
} from "@/lib/world-cup/worldCupBracketUtils"

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
