import { describe, expect, it } from "vitest"
import { getTeamLogoCandidates, nbaCupLogoCode } from "@/lib/players/teamLogos"

describe("NBA Cup team logos", () => {
  it("resolves full team names and familiar nicknames to the correct club", () => {
    expect(nbaCupLogoCode("Boston Celtics")).toBe("BOS")
    expect(nbaCupLogoCode("Portland Trail Blazers")).toBe("POR")
    expect(nbaCupLogoCode("Philadelphia 76ers")).toBe("PHI")
    expect(getTeamLogoCandidates("Boston Celtics", "NBA_CUP"))
      .toContain("https://a.espncdn.com/i/teamlogos/nba/500/bos.png")
  })

  it("does not guess a logo for an unknown or synthetic bracket team", () => {
    expect(nbaCupLogoCode("QA East One")).toBeNull()
    expect(getTeamLogoCandidates("QA East One", "NBA_CUP")).toEqual([])
  })
})
