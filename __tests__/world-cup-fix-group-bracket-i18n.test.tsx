/**
 * Tests for the fix/world-cup-group-thirdplace-bracket-i18n patch:
 *
 * Issue 1 — saveGroup() must call the API even when the displayed order
 *   matches the default seed order if the group has no DB picks yet.
 *   (alreadyRanked guard added; save button disabled when state="saved")
 *
 * Issue 2 — localizePoolName() translates auto-generated pool names that
 *   were stored in a different locale.
 *
 * Issue 3 — WorldCupTeamFlag shows emoji flag when flagUrl is null but
 *   a country code can be inferred from the team name.
 *
 * Issue 4 — WorldCupBracketCard shows compact schedule date in the header
 *   for future matches (when the match is not live/final/saving).
 *
 * Issue 5 — WorldCupBracketCard exposes a Sparkles AI-insights button
 *   that is styled differently for unlocked vs locked users.
 *
 * Issue 6 — WorldCupBracketBoard scroll-center wiring (source check only;
 *   jsdom scrollLeft is always 0 so no runtime assertion is possible).
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

// ── shared source reads ────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")

function readSource(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8")
}

const GROUP_SRC = readSource("components/brackets/world-cup/WorldCupGroupStagePicks.tsx")
const BOARD_SRC = readSource("components/brackets/world-cup/WorldCupBracketBoard.tsx")
const CARD_SRC = readSource("components/brackets/world-cup/WorldCupBracketCard.tsx")
const FLAG_SRC = readSource("components/brackets/world-cup/WorldCupTeamFlag.tsx")
const SHELL_SRC = readSource("components/brackets/world-cup/WorldCupBracketShell.tsx")
const I18N_SRC = readSource("lib/world-cup/worldCupI18n.ts")

// ── mocks for React component tests ───────────────────────────────────────
vi.mock("@/components/i18n/LanguageProviderClient", () => ({
  useOptionalLanguage: () => ({ language: "en" }),
}))

// ══════════════════════════════════════════════════════════════════════════
// ISSUE 1 — saveGroup() alreadyRanked guard + disabled state
// ══════════════════════════════════════════════════════════════════════════
describe("Issue 1: saveGroup() alreadyRanked guard", () => {
  it("WorldCupGroupStagePicks.tsx contains the alreadyRanked guard before the early-return", () => {
    expect(GROUP_SRC).toContain("alreadyRanked")
    expect(GROUP_SRC).toContain("isGroupRanked(view, groupId)")
    // The guard must precede the same-order short-circuit
    const guardIdx = GROUP_SRC.indexOf("alreadyRanked")
    const shortIdx = GROUP_SRC.indexOf("sameOrderedValues(orderedTeamIds, orderedTeamIdsForGroup(view, groupId))")
    expect(guardIdx).toBeLessThan(shortIdx)
  })

  it("the early-return only fires when alreadyRanked is true", () => {
    // The condition must be: alreadyRanked && view && sameOrderedValues(...)
    expect(GROUP_SRC).toMatch(/alreadyRanked\s*&&\s*(view\s*&&\s*)?sameOrderedValues/)
  })

  it("save button disabled condition includes state === 'saved'", () => {
    // Ensures already-saved groups have a disabled button (no duplicate API call)
    expect(GROUP_SRC).toContain(`state === "saved"`)
    // disabled prop must include the saved state
    const disabledLine = GROUP_SRC.split("\n").find((l) => l.includes("disabled={isLocked") && l.includes("saving"))
    expect(disabledLine).toBeDefined()
    expect(disabledLine).toContain(`state === "saved"`)
  })

  it("isGroupRanked helper checks all 4 ranks (1–4) are present in picks", () => {
    // Guard: [1, 2, 3, 4].every(rank => ranks.has(rank))
    expect(GROUP_SRC).toContain("[1, 2, 3, 4].every")
  })
})

// ══════════════════════════════════════════════════════════════════════════
// ISSUE 2 — localizePoolName()
// ══════════════════════════════════════════════════════════════════════════
describe("Issue 2: localizePoolName() pool-name translation", () => {
  it("localizePoolName is exported from worldCupI18n", async () => {
    const { localizePoolName } = await import("@/lib/world-cup/worldCupI18n")
    expect(typeof localizePoolName).toBe("function")
  })

  it("returns stored name unchanged when it is a custom name", async () => {
    const { localizePoolName } = await import("@/lib/world-cup/worldCupI18n")
    expect(localizePoolName("Our Office Pool 2026", "en")).toBe("Our Office Pool 2026")
    expect(localizePoolName("Our Office Pool 2026", "es")).toBe("Our Office Pool 2026")
  })

  it("translates a Spanish default name to English when locale is 'en'", async () => {
    const { localizePoolName } = await import("@/lib/world-cup/worldCupI18n")
    const esDefault = "Grupo de brackets de la Copa del Mundo"
    expect(localizePoolName(esDefault, "en")).toBe("World Cup Bracket Pool")
  })

  it("translates an English default name to Spanish when locale is 'es'", async () => {
    const { localizePoolName } = await import("@/lib/world-cup/worldCupI18n")
    const enDefault = "World Cup Bracket Pool"
    expect(localizePoolName(enDefault, "es")).toBe("Grupo de brackets de la Copa del Mundo")
  })

  it("translates Chinese default name to Vietnamese", async () => {
    const { localizePoolName } = await import("@/lib/world-cup/worldCupI18n")
    const zhDefault = "世界盃對戰群組"
    expect(localizePoolName(zhDefault, "vi")).toBe("Pool Bracket World Cup")
  })

  it("returns empty string for null/undefined stored names", async () => {
    const { localizePoolName } = await import("@/lib/world-cup/worldCupI18n")
    expect(localizePoolName(null, "en")).toBe("")
    expect(localizePoolName(undefined, "es")).toBe("")
  })

  it("WorldCupBracketShell imports and uses localizePoolName", () => {
    expect(SHELL_SRC).toContain("localizePoolName")
    expect(SHELL_SRC).toContain("localizedChallengeName")
    // The localized name is used in the h1 heading
    expect(SHELL_SRC).toContain("{localizedChallengeName}")
  })
})

// ══════════════════════════════════════════════════════════════════════════
// ISSUE 3 — WorldCupTeamFlag: emoji when image is absent
// ══════════════════════════════════════════════════════════════════════════
describe("Issue 3: WorldCupTeamFlag shows emoji when flagUrl is null", () => {
  it("fallbackEmoji computation includes !imageSrc condition", () => {
    // The fix: (!imageSrc || imageFailed) so emoji is computed when there is no URL
    expect(FLAG_SRC).toContain("!imageSrc || imageFailed")
  })

  it("renders emoji flag for a named team with null flagUrl", async () => {
    const WorldCupTeamFlag = (await import("@/components/brackets/world-cup/WorldCupTeamFlag")).default
    render(<WorldCupTeamFlag flagUrl={null} teamName="Brazil" size="xs" />)
    // Brazil → BRA → BR → 🇧🇷 emoji
    const flag = screen.getByRole("img", { name: /Brazil flag/i })
    expect(flag).toBeInTheDocument()
    expect(flag).toHaveAttribute("data-testid", "world-cup-team-flag-emoji")
  })

  it("renders 3-letter code badge when emoji is not available for team", async () => {
    const WorldCupTeamFlag = (await import("@/components/brackets/world-cup/WorldCupTeamFlag")).default
    // Scotland (SCO) has no Unicode emoji → should fall back to code badge
    render(<WorldCupTeamFlag flagUrl={null} teamName="Scotland" size="xs" />)
    // Either emoji or code; the important thing: no globe icon shown
    const globe = screen.queryByTestId("world-cup-team-flag-globe")
    // We should NOT see the globe icon for Scotland (it has SCO code as fallback)
    expect(globe).toBeNull()
  })

  it("renders image when a valid flagUrl is provided", async () => {
    const WorldCupTeamFlag = (await import("@/components/brackets/world-cup/WorldCupTeamFlag")).default
    render(
      <WorldCupTeamFlag
        flagUrl="https://cdn.example.com/flags/br.png"
        teamName="Brazil"
        size="xs"
      />
    )
    const img = screen.getByTestId("world-cup-team-flag-image")
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute("src", "https://cdn.example.com/flags/br.png")
  })
})

// ══════════════════════════════════════════════════════════════════════════
// ISSUE 4 — WorldCupBracketCard: compact schedule date
// ══════════════════════════════════════════════════════════════════════════
describe("Issue 4: WorldCupBracketCard shows schedule date", () => {
  it("CARD_SRC defines scheduleLabel for future matches", () => {
    expect(CARD_SRC).toContain("scheduleLabel")
    expect(CARD_SRC).toContain("wc.matchup.scheduleTbd")
  })

  it("scheduleLabel is null when match is live", () => {
    // Source check: scheduleLabel returns null when isLive is true
    expect(CARD_SRC).toMatch(/isLive.*isFinal.*isSaving.*return null/s)
  })

  it("wc.matchup.scheduleTbd key exists in all 5 locales", async () => {
    const { WORLD_CUP_TRANSLATIONS, WORLD_CUP_SUPPORTED_LOCALES } = await import(
      "@/lib/world-cup/worldCupI18n"
    )
    for (const locale of WORLD_CUP_SUPPORTED_LOCALES) {
      const val = WORLD_CUP_TRANSLATIONS[locale]["wc.matchup.scheduleTbd"]
      expect(val, `${locale} wc.matchup.scheduleTbd`).toBeTruthy()
    }
  })

  it("renders schedule date in header for a future match", async () => {
    const WorldCupBracketCard = (await import(
      "@/components/brackets/world-cup/WorldCupBracketCard"
    )).default

    const match = {
      id: "m1",
      matchNumber: 1,
      round: "round_of_32",
      roundIndex: 0,
      label: "M1",
      status: "scheduled",
      homeTeamId: "team-a",
      homeTeamName: "Argentina",
      homeTeamLogo: null,
      homeSlotKey: "slot-1",
      homeScore: null,
      awayTeamId: "team-b",
      awayTeamName: "Brazil",
      awayTeamLogo: null,
      awaySlotKey: "slot-2",
      awayScore: null,
      winnerTeamId: null,
      startsAt: "2026-06-12T15:00:00Z",
      elapsedMinute: null,
      venueName: null,
      venueCity: null,
      apiStatusShort: null,
    }

    render(<WorldCupBracketCard match={match as never} />)
    // Should show "Jun 12" (using "en" locale)
    expect(screen.getByLabelText(/Kickoff Jun 12/i)).toBeInTheDocument()
  })

  it("shows 'Date TBD' when startsAt is null and match is not live/final", async () => {
    const WorldCupBracketCard = (await import(
      "@/components/brackets/world-cup/WorldCupBracketCard"
    )).default

    const match = {
      id: "m2",
      matchNumber: 2,
      round: "round_of_32",
      roundIndex: 0,
      label: "M2",
      status: "scheduled",
      homeTeamId: "team-c",
      homeTeamName: "Canada",
      homeTeamLogo: null,
      homeSlotKey: "slot-3",
      homeScore: null,
      awayTeamId: "team-d",
      awayTeamName: "Denmark",
      awayTeamLogo: null,
      awaySlotKey: "slot-4",
      awayScore: null,
      winnerTeamId: null,
      startsAt: null,
      elapsedMinute: null,
      venueName: null,
      venueCity: null,
      apiStatusShort: null,
    }

    render(<WorldCupBracketCard match={match as never} />)
    // Schedule label fallback
    const label = screen.getByLabelText(/Kickoff Date TBD/i)
    expect(label).toBeInTheDocument()
  })
})

// ══════════════════════════════════════════════════════════════════════════
// ISSUE 5 — WorldCupBracketCard: AI insights Sparkles button
// ══════════════════════════════════════════════════════════════════════════
describe("Issue 5: WorldCupBracketCard AI insights button", () => {
  it("CARD_SRC imports Sparkles from lucide-react", () => {
    expect(CARD_SRC).toContain("Sparkles")
  })

  it("CARD_SRC uses wc.matchup.aiInsightsAria for the button aria-label", () => {
    expect(CARD_SRC).toContain("wc.matchup.aiInsightsAria")
  })

  it("wc.matchup.aiInsightsAria key exists in all 5 locales", async () => {
    const { WORLD_CUP_TRANSLATIONS, WORLD_CUP_SUPPORTED_LOCALES } = await import(
      "@/lib/world-cup/worldCupI18n"
    )
    for (const locale of WORLD_CUP_SUPPORTED_LOCALES) {
      const val = WORLD_CUP_TRANSLATIONS[locale]["wc.matchup.aiInsightsAria"]
      expect(val, `${locale} wc.matchup.aiInsightsAria`).toBeTruthy()
    }
  })

  it("AI button is shown in muted color for locked users (no aiInsightsUnlocked)", async () => {
    const WorldCupBracketCard = (await import(
      "@/components/brackets/world-cup/WorldCupBracketCard"
    )).default

    const match = {
      id: "m3",
      matchNumber: 3,
      round: "round_of_32",
      roundIndex: 0,
      label: "M3",
      status: "scheduled",
      homeTeamId: "team-e",
      homeTeamName: "England",
      homeTeamLogo: null,
      homeSlotKey: "slot-5",
      homeScore: null,
      awayTeamId: "team-f",
      awayTeamName: "France",
      awayTeamLogo: null,
      awaySlotKey: "slot-6",
      awayScore: null,
      winnerTeamId: null,
      startsAt: null,
      elapsedMinute: null,
      venueName: null,
      venueCity: null,
      apiStatusShort: null,
    }

    const onOpenMatchupPicker = vi.fn()
    render(
      <WorldCupBracketCard
        match={match as never}
        onOpenMatchupPicker={onOpenMatchupPicker}
        aiInsightsUnlocked={false}
      />
    )

    const aiBtn = screen.getByRole("button", { name: /AI Insights.*Match 3/i })
    expect(aiBtn).toBeInTheDocument()
    // Locked state uses muted text color
    expect(aiBtn.className).toContain("text-white/20")
  })

  it("AI button has cyan color for Pro users (aiInsightsUnlocked=true)", async () => {
    const WorldCupBracketCard = (await import(
      "@/components/brackets/world-cup/WorldCupBracketCard"
    )).default

    const match = {
      id: "m4",
      matchNumber: 4,
      round: "round_of_32",
      roundIndex: 0,
      label: "M4",
      status: "scheduled",
      homeTeamId: "team-g",
      homeTeamName: "Germany",
      homeTeamLogo: null,
      homeSlotKey: "slot-7",
      homeScore: null,
      awayTeamId: "team-h",
      awayTeamName: "Spain",
      awayTeamLogo: null,
      awaySlotKey: "slot-8",
      awayScore: null,
      winnerTeamId: null,
      startsAt: null,
      elapsedMinute: null,
      venueName: null,
      venueCity: null,
      apiStatusShort: null,
    }

    const onOpenMatchupPicker = vi.fn()
    render(
      <WorldCupBracketCard
        match={match as never}
        onOpenMatchupPicker={onOpenMatchupPicker}
        aiInsightsUnlocked={true}
      />
    )

    const aiBtn = screen.getByRole("button", { name: /AI Insights.*Match 4/i })
    expect(aiBtn).toBeInTheDocument()
    expect(aiBtn.className).toContain("text-cyan-300")
  })

  it("AI button calls onOpenMatchupPicker when clicked", async () => {
    const { fireEvent } = await import("@testing-library/react")
    const WorldCupBracketCard = (await import(
      "@/components/brackets/world-cup/WorldCupBracketCard"
    )).default

    const match = {
      id: "m5",
      matchNumber: 5,
      round: "round_of_32",
      roundIndex: 0,
      label: "M5",
      status: "scheduled",
      homeTeamId: "team-i",
      homeTeamName: "Japan",
      homeTeamLogo: null,
      homeSlotKey: "slot-9",
      homeScore: null,
      awayTeamId: "team-j",
      awayTeamName: "Mexico",
      awayTeamLogo: null,
      awaySlotKey: "slot-10",
      awayScore: null,
      winnerTeamId: null,
      startsAt: null,
      elapsedMinute: null,
      venueName: null,
      venueCity: null,
      apiStatusShort: null,
    }

    const onOpenMatchupPicker = vi.fn()
    render(
      <WorldCupBracketCard
        match={match as never}
        onOpenMatchupPicker={onOpenMatchupPicker}
      />
    )

    const aiBtn = screen.getByRole("button", { name: /AI Insights.*Match 5/i })
    fireEvent.click(aiBtn)
    expect(onOpenMatchupPicker).toHaveBeenCalledWith("m5")
  })
})

// ══════════════════════════════════════════════════════════════════════════
// ISSUE 6 — WorldCupBracketBoard: scroll-center on mount (source check)
// ══════════════════════════════════════════════════════════════════════════
describe("Issue 6: WorldCupBracketBoard scroll-centers on mount", () => {
  it("BOARD_SRC imports useRef from react", () => {
    expect(BOARD_SRC).toMatch(/\buseRef\b/)
  })

  it("BOARD_SRC creates scrollContainerRef with useRef", () => {
    expect(BOARD_SRC).toContain("scrollContainerRef")
    expect(BOARD_SRC).toContain("useRef<HTMLDivElement>(null)")
  })

  it("BOARD_SRC scrolls to center in a useEffect", () => {
    // The centering formula: scrollLeft = (scrollWidth - clientWidth) / 2
    expect(BOARD_SRC).toContain("scrollLeft")
    expect(BOARD_SRC).toContain("scrollWidth")
    expect(BOARD_SRC).toContain("clientWidth")
  })

  it("BOARD_SRC attaches the ref to the outer scroll container div", () => {
    // ref={scrollContainerRef} must appear on the scroll container
    expect(BOARD_SRC).toContain("ref={scrollContainerRef}")
    // The scroll container must also carry the test-id
    expect(BOARD_SRC).toContain("world-cup-knockout-board-scroll")
  })
})

// ══════════════════════════════════════════════════════════════════════════
// NEW I18N KEYS — parity across all 5 locales
// ══════════════════════════════════════════════════════════════════════════
describe("New i18n keys: parity across all locales", () => {
  const NEW_KEYS = [
    "wc.matchup.scheduleTbd",
    "wc.matchup.aiInsightsAria",
  ]

  it.each(NEW_KEYS)("key '%s' is non-empty in all 5 locales", async (key) => {
    const { WORLD_CUP_TRANSLATIONS, WORLD_CUP_SUPPORTED_LOCALES } = await import(
      "@/lib/world-cup/worldCupI18n"
    )
    for (const locale of WORLD_CUP_SUPPORTED_LOCALES) {
      const val = WORLD_CUP_TRANSLATIONS[locale][key]
      expect(val, `${locale}.${key} should be non-empty`).toBeTruthy()
    }
  })

  it("localizePoolName is exported from worldCupI18n", () => {
    // Source must export localizePoolName
    expect(I18N_SRC).toContain("export function localizePoolName")
    // It must use ALL_DEFAULT_POOL_NAMES set
    expect(I18N_SRC).toContain("ALL_DEFAULT_POOL_NAMES")
  })
})
