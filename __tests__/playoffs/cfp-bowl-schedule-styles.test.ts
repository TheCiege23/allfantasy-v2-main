import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * The bowl schedule renders on /brackets/cfp/preview, which never loads
 * af-playoff-bracket.css. With its card rules living only there, the live preview
 * showed "QuarterfinalFiesta Bowl" with no card at all (2026-11-09). jsdom applies
 * no CSS, so a render test cannot see this; these pin the wiring instead.
 */
const dir = join(process.cwd(), "components/brackets/playoffs")
const read = (file: string) => readFileSync(join(dir, file), "utf8")

describe("CFP bowl schedule styles travel with the component", () => {
  it("imports its own stylesheet (a real import line, not a mention in a comment)", () => {
    expect(read("CfpBowlSchedule.tsx")).toMatch(/^import ["']\.\/cfp-bowl-schedule\.css["']/m)
  })

  it("that stylesheet holds every class the card uses", () => {
    const css = read("cfp-bowl-schedule.css")
    for (const cls of ["af-pb-bowl-card", "af-pb-bowl-head", "af-pb-bowl-title", "af-pb-bowl-when", "af-pb-bowl-round", "af-pb-bowl-place", "af-pb-bowl-teams", "af-pb-crest"]) {
      expect(css).toMatch(new RegExp(`^\\.${cls}[\\s{\\[]`, "m"))
    }
    // The round label is a span; it must break onto its own line on any page.
    expect(css).toMatch(/\.af-pb-bowl-round\s*\{[^}]*display:\s*block/)
  })

  it("the bracket stylesheet no longer carries a second copy of the card rules", () => {
    expect(read("af-playoff-bracket.css")).not.toMatch(/^\.af-pb-bowl-/m)
  })
})
