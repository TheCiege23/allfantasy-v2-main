/**
 * The unreadable-roster warning has to survive compression.
 *
 * 🛑 REPORTING A GAP IN THE JSON PAYLOAD BUYS NOTHING IF THE PROMPT THE MODEL ACTUALLY READS
 * DROPS IT. `buildCompressedSystemPrompt` is that prompt on the compressed path, and it renders
 * `userRoster.starters` / `.bench` as a plain list. Without this line those lists look like a
 * complete squad, which is precisely the state that produced confident advice about a roster the
 * app could only partly read.
 */
import { describe, expect, it } from "vitest"
import { buildCompressedSystemPrompt } from "@/lib/agents/prompt-compression"

const ctx = { sport: "NCAAF", leagueFormat: "dynasty", scoring: "PPR" }

function promptFor(userRoster: Record<string, unknown>): string {
  return buildCompressedSystemPrompt({
    rawPrompt: "BASE PROMPT",
    ctx,
    structuredFantasyContext: { userRoster },
  })
}

describe("buildCompressedSystemPrompt — unreadable roster", () => {
  it("🛑 names the count, and tells the model to treat the roster as incomplete", () => {
    const prompt = promptFor({
      teamName: "Cream Bowl Team",
      starters: ["Arch Manning", "Jeremiah Smith"],
      bench: ["Ryan Williams"],
      unidentifiedPlayers: 36,
    })

    expect(prompt).toContain("36 player(s) on this roster could not be identified")
    expect(prompt).toContain("Treat the roster as incomplete")
    // The named players still render — a gap is reported alongside what IS known, never instead.
    expect(prompt).toContain("Arch Manning")
  })

  it("says nothing at all when the roster is fully readable", () => {
    const prompt = promptFor({
      teamName: "Readable Team",
      starters: ["Patrick Mahomes"],
      bench: ["Tony Pollard"],
    })

    expect(prompt).not.toContain("could not be identified")
    expect(prompt).toContain("Patrick Mahomes")
  })

  it("treats an explicit zero as fully readable rather than printing '0 player(s)'", () => {
    const prompt = promptFor({ teamName: "T", starters: ["A"], unidentifiedPlayers: 0 })
    expect(prompt).not.toContain("could not be identified")
  })

  /*
   * ⚠ The payload is assembled from a JSON round trip, so this key can arrive as anything. A
   * non-numeric value must not render a `NaN player(s)` line into the model's prompt.
   */
  it("ignores a non-numeric value rather than rendering NaN", () => {
    const prompt = promptFor({ teamName: "T", starters: ["A"], unidentifiedPlayers: "lots" })
    expect(prompt).not.toContain("could not be identified")
    expect(prompt).not.toContain("NaN")
  })
})
