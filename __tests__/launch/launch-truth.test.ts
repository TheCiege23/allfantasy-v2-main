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

  it("available launch platforms are exactly Sleeper/ESPN/Yahoo", () => {
    expect(LAUNCH_PLATFORMS_AVAILABLE.map((p) => p.provider).sort()).toEqual([
      "espn",
      "sleeper",
      "yahoo",
    ])
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
