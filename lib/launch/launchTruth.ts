/**
 * CANONICAL LAUNCH TRUTH (Release Readiness Phase 1 — Step 3).
 *
 * ONE import surface for the frozen closed-beta launch contract. It does NOT
 * duplicate constants — it aggregates the existing single sources and adds the
 * few canonical facts that had no home yet:
 *   - Platforms  → derived from lib/league-import/provider-ui-config.ts
 *                  (the guarded provider source; do not hardcode a second list)
 *   - Pricing / plans / tokens → re-exported from lib/monetization/catalog.ts
 *   - Sports, contexts, languages, themes, imported-league policy, launch
 *     features → declared here as the canonical constants.
 *
 * Any page/component that needs a launch fact should import it from here (or the
 * source this re-exports), never redeclare it. The guard test
 * __tests__/launch/launch-truth.test.ts fails if the platform list drifts from
 * provider-ui-config or pricing drifts from the catalog.
 */

import {
  IMPORT_PROVIDER_UI_OPTIONS,
} from "@/lib/league-import/provider-ui-config"
import {
  getMonetizationCatalog,
  type MonetizationCatalog,
  type MonetizationCatalogItem,
} from "@/lib/monetization/catalog"

export type LaunchSport = "NFL" | "NCAAF"
export type LaunchContext = "global" | "team" | "commissioner"
export type LaunchTheme = "light" | "dark" | "af"
export type LaunchLanguage = "en" | "es"

export type LaunchPlatform = {
  provider: string
  label: string
  /** Real user can complete an import today. */
  available: boolean
  supportedSports: readonly LaunchSport[]
}

/** Launch platforms, derived from the guarded provider config (not a 2nd list). */
export const LAUNCH_PLATFORMS: readonly LaunchPlatform[] = IMPORT_PROVIDER_UI_OPTIONS.map((o) => ({
  provider: o.provider,
  label: o.label,
  available: o.available,
  supportedSports: o.supportedSports,
}))

/** Providers a customer can actually connect at launch (Sleeper/ESPN/Yahoo today). */
export const LAUNCH_PLATFORMS_AVAILABLE: readonly LaunchPlatform[] = LAUNCH_PLATFORMS.filter(
  (p) => p.available
)

/** Canonical launch sports. NFL is the primary; NCAAF where data exists. */
export const LAUNCH_SPORTS: readonly LaunchSport[] = ["NFL", "NCAAF"] as const

/** Customer contexts (Global Command Center, Team Focus, Commissioner Focus). */
export const LAUNCH_CONTEXTS: readonly LaunchContext[] = ["global", "team", "commissioner"] as const

/** Themes the app ships. */
export const LAUNCH_THEMES: readonly LaunchTheme[] = ["light", "dark", "af"] as const

/** Languages certified for launch surfaces. */
export const LAUNCH_LANGUAGES: readonly LaunchLanguage[] = ["en", "es"] as const

/**
 * Imported external leagues are, without exception:
 * read-only upstream · DB-first · persistent · resumable · source-linked ·
 * isolated per user · never written back to the external platform.
 */
export const IMPORTED_LEAGUE_POLICY = {
  readOnlyUpstream: true,
  dbFirst: true,
  persistent: true,
  resumable: true,
  sourceLinked: true,
  isolatedPerUser: true,
  externalWriteBack: false,
} as const

/** The launch feature set (what the closed beta promises — nothing beyond this). */
export const LAUNCH_FEATURES = [
  "account_creation",
  "external_league_import",
  "db_first_dashboard",
  "prioritized_decisions",
  "chimmy_explanation",
  "paid_upgrade",
] as const
export type LaunchFeature = (typeof LAUNCH_FEATURES)[number]

/** Pricing/plans/tokens come from the catalog — the single pricing source of truth. */
export function getLaunchPricing(): MonetizationCatalog {
  return getMonetizationCatalog()
}
export type { MonetizationCatalogItem }

/** The whole launch contract as one object. */
export const LAUNCH_TRUTH = {
  platforms: LAUNCH_PLATFORMS,
  platformsAvailable: LAUNCH_PLATFORMS_AVAILABLE,
  sports: LAUNCH_SPORTS,
  contexts: LAUNCH_CONTEXTS,
  themes: LAUNCH_THEMES,
  languages: LAUNCH_LANGUAGES,
  importedLeaguePolicy: IMPORTED_LEAGUE_POLICY,
  features: LAUNCH_FEATURES,
  getPricing: getLaunchPricing,
} as const
