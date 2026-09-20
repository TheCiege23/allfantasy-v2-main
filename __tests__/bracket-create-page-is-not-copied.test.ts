import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, existsSync } from "fs"
import { join, resolve, basename } from "path"

/**
 * The create-pool page must exist in exactly one file.
 *
 * 🛑 WHAT THIS GUARDS AGAINST ALREADY HAPPENED, TO FIVE FILES AT ONCE. A bulk
 * commit (`7840b87f7`, "fix", 455 files, 2026-04-09) pasted the whole
 * ~442-line create page over five unrelated files, each of which kept its own
 * name and then exported `NewBracketLeaguePage`:
 *
 *   ConfirmPaymentButton.tsx  CopyJoinCode.tsx  CreateEntryButton.tsx
 *   DevTestPanel.tsx          app/brackets/tournament/[tournamentId]/page.tsx
 *
 * It broke a live route and a rendered component and survived five months,
 * because NOTHING in this repo can see it: a component named
 * `CreateEntryButton` that renders a create-pool form typechecks, lints,
 * builds and passes every test. A name is not a type.
 *
 * ⚠ THE ASSERTION IS ON THE FORM, NOT ON FILENAMES. A "file name must match
 * its export" rule needs an allowlist here (`ui.tsx`, `head.tsx`, a casing
 * difference — five benign mismatches under app/), and an allowlist is where
 * the next copy would be added. "This form exists once" needs no exceptions.
 */

const repoRoot = resolve(__dirname, "..")
const CREATE_PAGE = "app/brackets/leagues/new/page.tsx"

/** Markers that only the real create page should ever carry. */
const CREATE_PAGE_MARKERS = ['data-testid="bracket-create-form"', "function NewBracketLeaguePage"]

const SKIP_DIRS = new Set(["node_modules", "coverage", "playwright-report", "test-results"])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith(".tsx")) out.push(full)
  }
  return out
}

const sources = [...walk(join(repoRoot, "app")), ...walk(join(repoRoot, "components"))]

describe("the bracket create page is not copied anywhere", () => {
  it.each(CREATE_PAGE_MARKERS)("%s appears in exactly one file", (marker) => {
    const holders = sources
      .filter((file) => readFileSync(file, "utf8").includes(marker))
      .map((file) => file.slice(repoRoot.length + 1).replace(/\\/g, "/"))

    expect(holders).toEqual([CREATE_PAGE])
  })
})

describe("the files that bulk commit overwrote", () => {
  /*
   * Restored from `7840b87f7^`, the commit's own parent. Each is checked
   * against what its ONE caller passes rather than trusted because it came
   * out of git: CreateEntryButton is rendered by components/bracket/
   * LeagueHomeTabs.tsx and posts to /api/bracket/entries, which returns the
   * `entryId` and `tournamentId` it reads.
   */
  it("CreateEntryButton is a button again, taking the props its call site passes", () => {
    const src = readFileSync(resolve(repoRoot, "app/brackets/leagues/[leagueId]/CreateEntryButton.tsx"), "utf8")
    expect(src).toContain("export default function CreateEntryButton")
    expect(src).toContain("leagueId")
    expect(src).toContain("tiebreakerEnabled")
    // The endpoint it calls has to be the one that exists.
    expect(src).toContain('"/api/bracket/entries"')
    expect(existsSync(resolve(repoRoot, "app/api/bracket/entries/route.ts"))).toBe(true)
  })

  it("the tournament route is a tournament page again", () => {
    const src = readFileSync(resolve(repoRoot, "app/brackets/tournament/[tournamentId]/page.tsx"), "utf8")
    expect(src).toContain("export default async function TournamentPage")
    expect(src).toContain("bracketTournament")
  })

  /*
   * ⚠ Deleted rather than restored, because every import form — alias,
   * relative, require and dynamic — plus a bare-name search found no caller
   * for these three, and `CopyJoinCode`'s one importer never rendered it
   * while LeagueHomeTabs' own local InviteSection already builds the same
   * /brackets/join?code= URL. They are recoverable from `7840b87f7^` if any
   * of that turns out to be wrong.
   */
  it.each([
    "app/brackets/leagues/[leagueId]/ConfirmPaymentButton.tsx",
    "app/brackets/leagues/[leagueId]/CopyJoinCode.tsx",
    "app/brackets/leagues/[leagueId]/DevTestPanel.tsx",
  ])("%s is gone, and nothing imports it", (relativePath) => {
    expect(existsSync(resolve(repoRoot, relativePath))).toBe(false)

    const name = basename(relativePath, ".tsx")
    const importers = sources.filter((file) => readFileSync(file, "utf8").includes(name))
    expect(importers).toEqual([])
  })
})
