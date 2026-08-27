import { describe, it, expect } from "vitest"
import {
  LAUNCH_TRUTH,
  LAUNCH_PLATFORMS,
  LAUNCH_PLATFORMS_AVAILABLE,
  LAUNCH_SPORTS,
  getLaunchPricing,
} from "@/lib/launch/launchTruth"
import { IMPORT_PROVIDER_UI_OPTIONS } from "@/lib/league-import/provider-ui-config"
import { getMonetizationCatalog } from "@/lib/monetization/catalog"

// Guard: launch-truth must NOT become a second source. Platforms are derived from
// provider-ui-config; pricing is the catalog. This fails if either drifts.
describe("canonical launch truth (Phase 1 Step 3)", () => {
  it("derives platforms from provider-ui-config (no duplicate list)", () => {
    expect(LAUNCH_PLATFORMS.map((p) => p.provider)).toEqual(
      IMPORT_PROVIDER_UI_OPTIONS.map((o) => o.provider)
    )
  })

  /**
   * ⚠ THIS HARDCODED THE THREE AND BECAME THE SECOND SOURCE THE FILE HEADER
   * FORBIDS. Fantrax, Fleaflicker and MFL all shipped on 2026-08-27 and each one
   * turned this red — not because launch truth was wrong, but because the list
   * was written down twice. The test above already derives the full set from
   * provider-ui-config; the available subset is derived the same way.
   *
   * What is actually worth guarding is that the two agree, and that the launch
   * set is never empty — an empty one would pass a naive equality check while
   * meaning the import page offers nothing.
   */
  it("derives the available subset from provider-ui-config too", () => {
    const fromConfig = IMPORT_PROVIDER_UI_OPTIONS.filter((o) => o.available)
      .map((o) => o.provider)
      .sort()
    expect(LAUNCH_PLATFORMS_AVAILABLE.map((p) => p.provider).sort()).toEqual(fromConfig)
    expect(fromConfig).toContain("sleeper")
    expect(fromConfig.length).toBeGreaterThan(0)
  })

  it("launch sports are NFL/NCAAF only", () => {
    expect([...LAUNCH_SPORTS].sort()).toEqual(["NCAAF", "NFL"])
  })

  it("pricing comes from the catalog (single pricing source)", () => {
    expect(getLaunchPricing()).toEqual(getMonetizationCatalog())
  })

  it("imported leagues are read-only and never written back", () => {
    expect(LAUNCH_TRUTH.importedLeaguePolicy.externalWriteBack).toBe(false)
    expect(LAUNCH_TRUTH.importedLeaguePolicy.readOnlyUpstream).toBe(true)
    expect(LAUNCH_TRUTH.importedLeaguePolicy.dbFirst).toBe(true)
  })
})
