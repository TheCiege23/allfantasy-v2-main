/**
 * Player Command Center (Slice 4) — waiver world state pure helpers.
 */
import { describe, expect, it } from "vitest"
import { toClaimMode } from "@/lib/shared-services/league-hub/waiverWorldState"

describe("toClaimMode", () => {
  it("maps real waiverType strings to claim modes", () => {
    expect(toClaimMode("faab")).toBe("faab")
    expect(toClaimMode("FAAB_bidding")).toBe("faab")
    expect(toClaimMode("standard")).toBe("priority")
    expect(toClaimMode("rolling_priority")).toBe("priority")
    expect(toClaimMode("reverse_standings")).toBe("priority")
    expect(toClaimMode("first_come_first_served")).toBe("first_come")
    expect(toClaimMode("free_agency")).toBe("first_come")
  })

  it("is honest about unknowns", () => {
    expect(toClaimMode(null)).toBe("unknown")
    expect(toClaimMode("")).toBe("unknown")
    expect(toClaimMode("something_custom")).toBe("unknown")
  })
})
