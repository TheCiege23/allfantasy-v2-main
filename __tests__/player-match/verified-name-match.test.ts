/**
 * Slice 15 — verified name matching. The Josh Allen problem.
 */
import { describe, expect, it } from "vitest"
import {
  buildNameIndex,
  findVerified,
  normalizeMatchName,
  resolveVerifiedMatch,
} from "@/lib/player-match/verifiedNameMatch"

const rows = [
  { name: "Josh Allen", position: "QB", team: "BUF", status: "healthy" },
  { name: "Josh Allen", position: "LB", team: "JAX", status: "out" },
  { name: "Amon-Ra St. Brown", position: "WR", team: "DET", status: "questionable" },
]
const index = buildNameIndex(rows)

describe("normalizeMatchName", () => {
  it("normalizes case, punctuation, accents and generational suffixes", () => {
    expect(normalizeMatchName("Amon-Ra St. Brown")).toBe("amonra st brown")
    expect(normalizeMatchName("Marvin Harrison Jr.")).toBe("marvin harrison")
    expect(normalizeMatchName("  ODELL   BECKHAM  ")).toBe("odell beckham")
  })

  it("never collapses genuinely different names", () => {
    expect(normalizeMatchName("Josh Allen")).not.toBe(normalizeMatchName("Josh Allan"))
  })
})

describe("resolveVerifiedMatch — collisions", () => {
  it("binds the QB's row to the QB, not the linebacker", () => {
    const result = resolveVerifiedMatch(index, { name: "Josh Allen", position: "QB" })
    expect(result.match?.team).toBe("BUF")
    expect(result.match?.status).toBe("healthy")
    expect(result.reason).toBe("position_verified")
    expect(result.candidateCount).toBe(2)
  })

  it("binds the LB's row to the linebacker", () => {
    expect(resolveVerifiedMatch(index, { name: "Josh Allen", position: "LB" }).match?.status).toBe("out")
  })

  it("REFUSES to bind a collision when the lookup has no verifying field", () => {
    const result = resolveVerifiedMatch(index, { name: "Josh Allen" })
    expect(result.match).toBeNull()
    expect(result.reason).toBe("ambiguous")
    // The old behavior — silently taking row 0 — would have returned the QB.
  })

  it("falls back to team when position is unknown", () => {
    const result = resolveVerifiedMatch(index, { name: "Josh Allen", team: "JAX" })
    expect(result.match?.position).toBe("LB")
    expect(result.reason).toBe("team_verified")
  })

  it("refuses when the verifying fields match nobody", () => {
    expect(resolveVerifiedMatch(index, { name: "Josh Allen", position: "RB", team: "KC" }).match).toBeNull()
  })
})

describe("resolveVerifiedMatch — non-collisions", () => {
  it("binds a unique name without requiring position", () => {
    const result = resolveVerifiedMatch(index, { name: "  AMON-RA ST. BROWN  " })
    expect(result.match?.team).toBe("DET")
    expect(result.reason).toBe("unique_name")
  })

  it("matches real punctuation variants (A.J. vs AJ)", () => {
    const idx = buildNameIndex([{ name: "A.J. Brown", position: "WR", team: "PHI" }])
    expect(findVerified(idx, { name: "AJ Brown" })?.team).toBe("PHI")
    expect(findVerified(idx, { name: "a.j. brown" })?.team).toBe("PHI")
  })

  it("reports not_found honestly", () => {
    const result = resolveVerifiedMatch(index, { name: "Nobody Here", position: "WR" })
    expect(result.match).toBeNull()
    expect(result.reason).toBe("not_found")
    expect(result.candidateCount).toBe(0)
  })

  it("handles empty/blank lookups without throwing", () => {
    expect(findVerified(index, { name: "" })).toBeNull()
    expect(findVerified(index, { name: "   " })).toBeNull()
  })
})

describe("buildNameIndex", () => {
  it("preserves collisions instead of overwriting them", () => {
    expect(index.get("josh allen")).toHaveLength(2)
  })

  it("skips unnamed rows", () => {
    expect(buildNameIndex([{ name: "" }, { name: "  " }]).size).toBe(0)
  })
})
