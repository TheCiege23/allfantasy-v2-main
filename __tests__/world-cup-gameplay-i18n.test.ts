/**
 * Targeted wiring coverage for World Cup gameplay surfaces translated
 * in Phase 5 — Group Stage picks, third-place advancers, knockout
 * Matchup card + bracket board, and Review/finalize missing-picks
 * checklist.
 *
 * Pattern follows world-cup-dashboard-cards-i18n.test.ts:
 *  - Greps the component sources as text (no React rendering) to
 *    assert each new t(...) call is present and the pre-i18n English
 *    literal is gone from the render path.
 *  - Asserts dictionary parity for every new key across all 5 locales.
 *  - Exercises representative keys per locale through the wcT helper.
 *  - Re-asserts the "team names are not translated/altered" contract by
 *    confirming the components keep using the raw `team.name`,
 *    `pick.selectedTeamName`, and `match.winnerTeamName` data values
 *    without wrapping them in `t()`.
 *  - Hydration safety: each wired client component must not read
 *    localStorage / navigator.language at render scope, and no
 *    dictionary value bakes in a `toLocaleString` call.
 *  - The dev Google Translate script is not imported by any wired
 *    runtime module.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  WORLD_CUP_TRANSLATIONS,
  WORLD_CUP_SUPPORTED_LOCALES,
  wcT,
} from "@/lib/world-cup/worldCupI18n"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")

function readSource(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8")
}

const GROUP_SRC = readSource(
  "components/brackets/world-cup/WorldCupGroupStagePicks.tsx"
)
const MATCHUP_SRC = readSource(
  "components/brackets/world-cup/WorldCupMatchupCard.tsx"
)
const BOARD_SRC = readSource(
  "components/brackets/world-cup/WorldCupBracketBoard.tsx"
)
const SHELL_SRC = readSource(
  "components/brackets/world-cup/WorldCupBracketShell.tsx"
)

// ── Dictionary parity for the new keys per locale ──────────────────────────

describe("WC gameplay i18n: dictionary parity for new keys", () => {
  const newKeys = [
    // Group Stage
    "wc.groupStage.loading",
    "wc.groupStage.failedLoad",
    "wc.groupStage.title",
    "wc.groupStage.subtitle",
    "wc.groupStage.rankedCount",
    "wc.groupStage.lockedNoReason",
    "wc.groupStage.lockedWithReason",
    "wc.groupStage.teamCount",
    "wc.groupStage.teamFallback",
    "wc.groupStage.actualRank",
    "wc.groupStage.moveUp",
    "wc.groupStage.moveDown",
    "wc.groupStage.needsFourTeams",
    "wc.groupStage.unsavedOrder",
    "wc.groupStage.savedReviewUses",
    "wc.groupStage.saveGroup",
    "wc.groupStage.saving",
    "wc.groupStage.saved",
    "wc.groupStage.retrySave",
    "wc.groupStage.failedSave",
    "wc.groupStage.aiTitle",
    "wc.groupStage.aiTierOpen",
    "wc.groupStage.aiTierLocked",
    "wc.groupStage.aiPrivacyNote",
    "wc.groupStage.aiLockedBody",
    "wc.groupStage.resultCorrect",
    "wc.groupStage.resultWrong",
    "wc.groupStage.resultPending",
    // Third-place
    "wc.thirdPlace.title",
    "wc.thirdPlace.subtitle",
    "wc.thirdPlace.selectedCount",
    "wc.thirdPlace.saveBtn",
    "wc.thirdPlace.savePicksDone",
    "wc.thirdPlace.saving",
    "wc.thirdPlace.saved",
    "wc.thirdPlace.savePrimaryBtn",
    "wc.thirdPlace.rankAllFirst",
    "wc.thirdPlace.unsaved",
    "wc.thirdPlace.savedReviewUses",
    "wc.thirdPlace.errorChoose8",
    "wc.thirdPlace.errorRankFirst",
    "wc.thirdPlace.failedSave",
    "wc.thirdPlace.noPickYet",
    "wc.thirdPlace.selectedToAdvance",
    "wc.thirdPlace.tapToSelect",
    "wc.thirdPlace.selectAria",
    "wc.thirdPlace.aiTitle",
    "wc.thirdPlace.aiLockedBody",
    // Matchup card
    "wc.matchup.matchLabel",
    "wc.matchup.openGuidedAria",
    "wc.matchup.statusFinal",
    "wc.matchup.statusPostponed",
    "wc.matchup.statusCancelled",
    "wc.matchup.statusSimulated",
    "wc.matchup.statusTestFixture",
    "wc.matchup.statusSaving",
    "wc.matchup.notReadyPill",
    "wc.matchup.pickBadgeCorrect",
    "wc.matchup.pickBadgeIncorrect",
    "wc.matchup.pickVisualCorrect",
    "wc.matchup.pickVisualIncorrect",
    "wc.matchup.pickVisualPending",
    "wc.matchup.yourPick",
    "wc.matchup.points",
    "wc.matchup.pointsPositive",
    "wc.matchup.zeroPts",
    "wc.matchup.pending",
    "wc.matchup.winnerOfficial",
    "wc.matchup.unpickableFinal",
    "wc.matchup.unpickableMissingTeam",
    "wc.matchup.unpickableUnknown",
    "wc.matchup.ftBadge",
    "wc.matchup.confidenceTitle",
    "wc.matchup.confidenceHint",
    "wc.matchup.confidencePointSingle",
    "wc.matchup.confidencePointPlural",
    "wc.matchup.aiInsightsLabel",
    "wc.matchup.aiTierOpen",
    "wc.matchup.aiTierLocked",
    "wc.matchup.aiSaferPick",
    "wc.matchup.aiSaferBody",
    "wc.matchup.aiUpsidePick",
    "wc.matchup.aiUpsideBody",
    "wc.matchup.aiBracketImpact",
    "wc.matchup.aiBracketImpactBody",
    "wc.matchup.aiUpsetRisk",
    "wc.matchup.aiUpsetRiskBody",
    "wc.matchup.aiPrivacyNote",
    "wc.matchup.aiLockedBody",
    "wc.matchup.pickAriaPicked",
    "wc.matchup.pickAriaSelected",
    "wc.matchup.disabledLocked",
    "wc.matchup.disabledSaving",
    "wc.matchup.winnerLabel",
    "wc.matchup.lockHintTournament",
    "wc.matchup.lockHintKickoff",
    "wc.matchup.lockHintTournamentWithTime",
    "wc.matchup.lockHintKickoffWithTime",
    "wc.matchup.bracketBoardChampionLabel",
    "wc.matchup.bracketBoardChampionFallback",
    "wc.matchup.bracketBoardHelper",
    // Review tab
    "wc.review.savedThirdPlaceTitle",
    "wc.review.noSavedThirdPlace",
    "wc.review.loadingSavedThirdPlace",
    "wc.review.savedKnockoutTitle",
    "wc.review.noSavedKnockout",
    "wc.review.knockoutPickPrefix",
    "wc.review.missingRequirementsTitle",
    "wc.review.needsRefinalize",
    "wc.review.missingGroupRankings",
    "wc.review.thirdPlaceCount",
    "wc.review.missingKnockout",
    "wc.review.lockedNoTime",
    "wc.review.lockedWithTime",
    "wc.review.completeDraftHelper",
    "wc.review.finalizing",
    "wc.review.finalizeEntry",
    "wc.review.refinalizeEntry",
    "wc.review.completeAllToUnlock",
    "wc.review.tapRefresh",
    "wc.review.resultPendingNote",
    "wc.review.createEntryFirstTitle",
    "wc.review.createEntryFirstBody",
    "wc.review.createMyBracket",
    "wc.review.creating",
  ]

  for (const locale of WORLD_CUP_SUPPORTED_LOCALES) {
    it(`every new key has a translation in locale "${locale}"`, () => {
      const dict = WORLD_CUP_TRANSLATIONS[locale]
      const missing: string[] = []
      for (const key of newKeys) {
        if (typeof dict[key] !== "string" || dict[key].length === 0) {
          missing.push(key)
        }
      }
      expect(missing, `Locale "${locale}" is missing keys`).toEqual([])
    })
  }
})

// ── Group Stage wiring ─────────────────────────────────────────────────────

describe("WC gameplay i18n: Group Stage wiring", () => {
  it("calls t() for the major Group Stage labels", () => {
    expect(GROUP_SRC).toContain(`t("wc.groupStage.loading")`)
    expect(GROUP_SRC).toContain(`t("wc.groupStage.title")`)
    expect(GROUP_SRC).toContain(`t("wc.groupStage.subtitle")`)
    expect(GROUP_SRC).toContain(`t("wc.groupStage.rankedCount"`)
    expect(GROUP_SRC).toContain(`t("wc.groupStage.lockedNoReason")`)
    expect(GROUP_SRC).toContain(`t("wc.groupStage.lockedWithReason"`)
    expect(GROUP_SRC).toContain(`t("wc.groupStage.teamCount"`)
    expect(GROUP_SRC).toContain(`t("wc.groupStage.moveUp")`)
    expect(GROUP_SRC).toContain(`t("wc.groupStage.moveDown")`)
    expect(GROUP_SRC).toContain(`t("wc.groupStage.saveGroup")`)
    expect(GROUP_SRC).toContain(`t("wc.groupStage.saving")`)
    expect(GROUP_SRC).toContain(`t("wc.groupStage.saved")`)
    expect(GROUP_SRC).toContain(`t("wc.groupStage.retrySave")`)
    expect(GROUP_SRC).toContain(`t("wc.groupStage.savedReviewUses")`)
    expect(GROUP_SRC).toContain(`t("wc.groupStage.unsavedOrder")`)
  })

  it("uses the language provider", () => {
    expect(GROUP_SRC).toContain(`useOptionalLanguage`)
    expect(GROUP_SRC).toContain(`makeWcT`)
  })

  it("no longer hardcodes the Group Stage English labels", () => {
    const banned = [
      ">Group Stage Picks<",
      "Rank each group 1st through 4th",
      "Groups ranked: ",
      ">Move Up<",
      ">Move Down<",
      ">Save Group<",
      `"Saving..."`,
      `"Retry Save"`,
      `"Unsaved order change`,
      `"Saved. Review uses this group order."`,
      `"Loading group-stage picks..."`,
      `"Failed to load group stage"`,
      `"Failed to save group ranking"`,
    ]
    for (const phrase of banned) {
      expect(
        GROUP_SRC,
        `Group stage component should not hardcode "${phrase}"`
      ).not.toContain(phrase)
    }
  })

  it("Third-place selector calls t() for major labels", () => {
    expect(GROUP_SRC).toContain(`t("wc.thirdPlace.title")`)
    expect(GROUP_SRC).toContain(`t("wc.thirdPlace.subtitle")`)
    expect(GROUP_SRC).toContain(`t("wc.thirdPlace.selectedCount"`)
    expect(GROUP_SRC).toContain(`t("wc.thirdPlace.saveBtn")`)
    expect(GROUP_SRC).toContain(`t("wc.thirdPlace.savePrimaryBtn")`)
    expect(GROUP_SRC).toContain(`t("wc.thirdPlace.errorChoose8")`)
    expect(GROUP_SRC).toContain(`t("wc.thirdPlace.errorRankFirst")`)
    expect(GROUP_SRC).toContain(`t("wc.thirdPlace.rankAllFirst")`)
    expect(GROUP_SRC).toContain(`t("wc.thirdPlace.unsaved")`)
    expect(GROUP_SRC).toContain(`t("wc.thirdPlace.savedReviewUses")`)
    expect(GROUP_SRC).toContain(`t("wc.thirdPlace.selectedToAdvance")`)
    expect(GROUP_SRC).toContain(`t("wc.thirdPlace.tapToSelect")`)
    expect(GROUP_SRC).toContain(`t("wc.thirdPlace.selectAria"`)
    expect(GROUP_SRC).toContain(`t("wc.thirdPlace.noPickYet")`)
  })

  it("no longer hardcodes the Third-Place English labels", () => {
    const banned = [
      ">Third-Place Advancers<",
      "Choose exactly 8 predicted third-place teams",
      "Save Third-Place Advancers",
      "Save Third-Place",
      `"Saved Third-Place Picks"`,
      `"Choose exactly 8 third-place advancers."`,
      `"Rank all 12 groups before choosing third-place advancers."`,
      `"No 3rd-place pick yet"`,
      `"Selected to advance"`,
      `"Tap to select"`,
      `Third-place advancers selected: `,
      `as a third-place advancer\``,
    ]
    for (const phrase of banned) {
      expect(
        GROUP_SRC,
        `Third-place block should not hardcode "${phrase}"`
      ).not.toContain(phrase)
    }
  })

  it("keeps team names untranslated — team.name + team.country are passed through verbatim", () => {
    // Render path still uses the raw `team?.name ?? teamId` and
    // `team?.country` values directly inside JSX without wrapping
    // them in t(). The country line falls back to t("wc.groupStage.teamFallback")
    // only when team.country is missing.
    expect(GROUP_SRC).toContain(`{team?.name ?? teamId}`)
    expect(GROUP_SRC).toContain(`{team?.country ?? t("wc.groupStage.teamFallback")}`)
    // Third-place candidate team name fallback follows the same rule.
    expect(GROUP_SRC).toContain(`{candidate.team?.name ?? t("wc.thirdPlace.noPickYet")}`)
  })
})

// ── Matchup card + bracket board wiring ────────────────────────────────────

describe("WC gameplay i18n: Matchup card + bracket board wiring", () => {
  it("calls t() for the matchup-card status pills and pick labels", () => {
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.matchLabel"`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.openGuidedAria"`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.statusFinal")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.statusPostponed")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.statusCancelled")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.statusSimulated")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.statusTestFixture")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.statusSaving")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.notReadyPill")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.pickBadgeCorrect")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.pickBadgeIncorrect")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.yourPick")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.winnerOfficial"`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.unpickableFinal")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.confidenceTitle")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.aiInsightsLabel")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.aiSaferPick")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.winnerLabel")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.disabledLocked")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.disabledSaving")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.pickAriaPicked"`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.pickAriaSelected"`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.lockHintTournament")`)
    expect(MATCHUP_SRC).toContain(`t("wc.matchup.lockHintKickoff")`)
  })

  it("Bracket board calls t() for champion pick + helper", () => {
    expect(BOARD_SRC).toContain(`t("wc.matchup.bracketBoardChampionLabel")`)
    expect(BOARD_SRC).toContain(
      `t("wc.matchup.bracketBoardChampionFallback")`
    )
    expect(BOARD_SRC).toContain(`t("wc.matchup.bracketBoardHelper")`)
    expect(BOARD_SRC).toContain(`useOptionalLanguage`)
  })

  it("matchup card no longer hardcodes the major English labels", () => {
    const banned = [
      "Match {match.matchNumber}",
      `aria-label={onOpenMatchupPicker ? \`Open guided picker for match`,
      ">Final<",
      ">Postponed<",
      ">Cancelled<",
      ">Simulated<",
      ">Test Fixture<",
      `"Saving..."`,
      "Not ready for picks",
      "Confidence bonus",
      "Higher confidence means more bonus points",
      "Safer pick:",
      "Upside pick:",
      "Bracket impact:",
      "Upset risk:",
      "Picks are locked for this match",
      "This pick is saving",
      ">Winner<",
    ]
    for (const phrase of banned) {
      expect(
        MATCHUP_SRC,
        `Matchup card should not hardcode "${phrase}"`
      ).not.toContain(phrase)
    }
  })

  it("bracket board no longer hardcodes the champion pick English labels", () => {
    const banned = [
      ">Champion Pick<",
      `"Not picked"`,
      "Your knockout bracket is generated from your predicted group results",
    ]
    for (const phrase of banned) {
      expect(
        BOARD_SRC,
        `Bracket board should not hardcode "${phrase}"`
      ).not.toContain(phrase)
    }
  })

  it("team names + match.winnerTeamName remain raw data values (not translated)", () => {
    // Team display name is passed through `formatWorldCupPlaceholder()`
    // — never wrapped in t(). Match winner team name flows through
    // `match.winnerTeamName` directly as the {{name}} interpolation
    // value (translated chrome around it, raw team name inside).
    expect(MATCHUP_SRC).toContain(`formatWorldCupPlaceholder(team.slotKey, team.name, team.teamId)`)
    expect(MATCHUP_SRC).toContain(`{ name: match.winnerTeamName`)
    expect(MATCHUP_SRC).toContain(`{ name: displayName }`)
    // selectedPickLabel is a helper that returns the raw team name —
    // not wrapped in t().
    expect(MATCHUP_SRC).toContain(`{selectedPickLabel(match, pick)}`)
  })
})

// ── Review/finalize wiring ─────────────────────────────────────────────────

describe("WC gameplay i18n: Review/finalize wiring", () => {
  it("calls t() for the major Review tab labels", () => {
    expect(SHELL_SRC).toContain(`t("wc.review.savedThirdPlaceTitle")`)
    expect(SHELL_SRC).toContain(`t("wc.review.noSavedThirdPlace")`)
    expect(SHELL_SRC).toContain(`t("wc.review.loadingSavedThirdPlace")`)
    expect(SHELL_SRC).toContain(`t("wc.review.savedKnockoutTitle")`)
    expect(SHELL_SRC).toContain(`t("wc.review.noSavedKnockout")`)
    expect(SHELL_SRC).toContain(`t("wc.review.knockoutPickPrefix"`)
    expect(SHELL_SRC).toContain(`t("wc.review.missingRequirementsTitle")`)
    expect(SHELL_SRC).toContain(`t("wc.review.needsRefinalize")`)
    expect(SHELL_SRC).toContain(`t("wc.review.missingGroupRankings"`)
    expect(SHELL_SRC).toContain(`t("wc.review.thirdPlaceCount"`)
    expect(SHELL_SRC).toContain(`t("wc.review.missingKnockout"`)
    expect(SHELL_SRC).toContain(`t("wc.review.lockedNoTime")`)
    expect(SHELL_SRC).toContain(`t("wc.review.lockedWithTime"`)
    expect(SHELL_SRC).toContain(`t("wc.review.completeDraftHelper")`)
    expect(SHELL_SRC).toContain(`t("wc.review.finalizing")`)
    expect(SHELL_SRC).toContain(`t("wc.review.finalizeEntry")`)
    expect(SHELL_SRC).toContain(`t("wc.review.refinalizeEntry")`)
    expect(SHELL_SRC).toContain(`t("wc.review.completeAllToUnlock")`)
    expect(SHELL_SRC).toContain(`t("wc.review.tapRefresh")`)
    expect(SHELL_SRC).toContain(`t("wc.review.resultPendingNote")`)
    expect(SHELL_SRC).toContain(`t("wc.review.createEntryFirstTitle")`)
    expect(SHELL_SRC).toContain(`t("wc.review.createEntryFirstBody")`)
    expect(SHELL_SRC).toContain(`t("wc.review.createMyBracket")`)
    expect(SHELL_SRC).toContain(`t("wc.review.creating")`)
  })

  it("Review tab no longer hardcodes the pre-i18n English labels", () => {
    const banned = [
      "Missing requirements",
      "Entry changed after submission",
      "Missing group rankings: ",
      "Third-place advancers selected: ",
      "Missing knockout picks: ",
      "Saved Knockout Picks",
      "Saved Third-Place Advancers",
      `"No saved knockout picks yet."`,
      `"No saved third-place advancers yet."`,
      "Loading saved third-place picks...",
      "Locked: picks can no longer be edited",
      "Complete draft. Finalize to submit it to the leaderboard",
      `"Finalizing..."`,
      `"Re-finalize Entry"`,
      `"Finalize Entry"`,
      "Complete all missing requirements to unlock Finalize.",
      "Tap Refresh Review to check completion.",
      `"Create an entry first"`,
      "Review and finalization are saved per bracket entry.",
      `"Create My Bracket"`,
    ]
    for (const phrase of banned) {
      expect(
        SHELL_SRC,
        `Review tab should not hardcode "${phrase}"`
      ).not.toContain(phrase)
    }
  })

  it("keeps the locked-state submittedAt timestamp computed via toLocaleString (browser-rendered, locked-state only)", () => {
    // The locked state already runs after the user has submitted; this
    // path is post-hydration and gated on completionReview.isLocked, so
    // toLocaleString here does not regress SSR/CSR mismatch. Sanity:
    // it exists and is wrapped through t().
    expect(SHELL_SRC).toContain(
      `t("wc.review.lockedWithTime", { at: new Date(completionReview.submittedAt).toLocaleString() })`
    )
  })
})

// ── Hydration safety + Google Translate isolation ─────────────────────────

describe("WC gameplay i18n: hydration safety + translate isolation", () => {
  const sources = [GROUP_SRC, MATCHUP_SRC, BOARD_SRC]
  for (const src of sources) {
    it("client component does not read localStorage / navigator.language at render scope", () => {
      expect(src).not.toMatch(/localStorage\./)
      expect(src).not.toMatch(/navigator\.language/)
    })
  }

  it("no dictionary value contains a toLocaleString call (would imply runtime-built strings)", () => {
    for (const locale of WORLD_CUP_SUPPORTED_LOCALES) {
      for (const [key, value] of Object.entries(WORLD_CUP_TRANSLATIONS[locale])) {
        expect(
          value.includes("toLocaleString"),
          `${locale}.${key} should not contain "toLocaleString"`
        ).toBe(false)
      }
    }
  })

  it("none of the wired gameplay files import the dev translate script", () => {
    for (const src of sources) {
      expect(src).not.toMatch(/translate-brackets-i18n/i)
      expect(src).not.toMatch(/googleapis\.com\/translate/i)
      expect(src).not.toMatch(/GOOGLE_TRANSLATE_API_KEY/)
    }
  })
})

// ── Locale render smoke ────────────────────────────────────────────────────

describe("WC gameplay i18n: locale render smoke", () => {
  it.each([
    // Group Stage
    ["es", "wc.groupStage.title", "Picks de Fase de Grupos"],
    ["zh", "wc.groupStage.title", "小組賽選擇"],
    ["fil", "wc.groupStage.saveGroup", "I-save ang Group"],
    ["vi", "wc.groupStage.moveUp", "Lên"],
    // Third-place
    ["es", "wc.thirdPlace.savePrimaryBtn", "Guardar Avanzan por Tercer Puesto"],
    ["zh", "wc.thirdPlace.tapToSelect", "點擊以選擇"],
    ["vi", "wc.thirdPlace.errorChoose8", "Hãy chọn đúng 8 đội hạng ba đi tiếp."],
    // Matchup card
    ["es", "wc.matchup.confidenceTitle", "Bono de confianza"],
    ["zh", "wc.matchup.aiInsightsLabel", "Chimmy 解析"],
    ["fil", "wc.matchup.aiSaferPick", "Mas ligtas na pick:"],
    ["vi", "wc.matchup.aiUpsetRisk", "Rủi ro cú sốc:"],
    // Review
    ["es", "wc.review.finalizeEntry", "Finalizar Entrada"],
    ["zh", "wc.review.finalizeEntry", "送出項目"],
    ["fil", "wc.review.createMyBracket", "Gumawa ng aking bracket"],
    ["vi", "wc.review.completeAllToUnlock", "Hoàn thành tất cả yêu cầu còn thiếu để mở khoá Hoàn tất."],
  ])(
    "locale %s key %s renders as %s",
    (locale, key, expected) => {
      expect(wcT(locale, key)).toBe(expected)
    }
  )

  it("interpolation works for count placeholders", () => {
    expect(
      wcT("en", "wc.review.thirdPlaceCount", { count: 5 })
    ).toBe("Third-place advancers selected: 5/8")
    expect(
      wcT("es", "wc.review.thirdPlaceCount", { count: 5 })
    ).toBe("Avances por tercer puesto: 5/8")
    expect(
      wcT("en", "wc.review.missingKnockout", { count: 12 })
    ).toBe("Missing knockout picks: 12")
    expect(
      wcT("zh", "wc.review.missingGroupRankings", {
        groups: "Group A, Group B",
      })
    ).toContain("Group A, Group B")
  })

  it("unsupported locale falls back to English", () => {
    expect(wcT("xx", "wc.groupStage.title")).toBe("Group Stage Picks")
    expect(wcT("xx", "wc.review.finalizeEntry")).toBe("Finalize Entry")
  })
})
