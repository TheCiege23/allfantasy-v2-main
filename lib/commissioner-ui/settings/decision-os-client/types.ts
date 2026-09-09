import type { CommissionerPlatformResponse } from '../../contracts'

/**
 * Settings is the least "intelligent" surface in Commissioner OS by design: it reports what this
 * league's rules ARE, and derives nothing.
 *
 * 🛑 THE OBVIOUS IMPLEMENTATION IS THE WRONG ONE, AND MEASURING IT IS THE ONLY WAY TO KNOW.
 * `UnifiedLeagueSettingsService.getLeagueSettings()` looks like exactly the right read — one service,
 * already used by the 64 `/api/commissioner/*` routes. It returns the league's stored settings blob
 * when that blob carries a `meta` key, and otherwise **falls back to sport defaults**. Measured on
 * production 2026-09-09: **0 of 288** commissioned leagues carry a `meta` key. So that service
 * returns invented defaults for every league on the platform, and a Settings page built on it would
 * have shown all 288 commissioners a scoring system, roster shape and playoff structure belonging to
 * no league at all — stated as fact, on the one page whose entire job is factual accuracy.
 *
 * What we DO hold is the import snapshot: 259 of those leagues carry real `scoringSettings`,
 * `rosterSettings`, `waiverSettings`, `playoffSettings` and `draftSettings` captured from their
 * platform. That is what this contract describes.
 *
 * ⚠ HENCE `value: string | null` RATHER THAN A DEFAULT. A null means "we did not capture this from
 * your platform", and the view says so. There is no shape here that can express a guess, which is
 * deliberate: the failure this module has to be incapable of is a confident wrong number.
 */

export interface LeagueSettingEntry {
  label: string
  /** Null when this setting was not captured for this league. Never a default, never a guess. */
  value: string | null
  /** Optional clarification — a unit, or what the value means. Never used to explain away a null. */
  note?: string
}

export interface LeagueSettingGroup {
  id: string
  label: string
  description: string
  entries: LeagueSettingEntry[]
}

/** One scoring rule exactly as the platform stated it. */
export interface LeagueScoringRule {
  /** The provider's own stat key, e.g. `pass_yd` or `idp_tkl_solo`. */
  stat: string
  /** Human label where one is known, otherwise the raw key — never a blank. */
  label: string
  points: number
}

export interface LeagueScoringSummary {
  /** e.g. 'custom', 'ppr' — as captured, not inferred. */
  format: string | null
  /** The provider's template id where one was captured, e.g. `fb_half_ppr`. */
  templateId: string | null
  /** How many rules this league actually defines. The headline number. */
  ruleCount: number
  /**
   * Every captured rule, sorted for reading rather than truncated here.
   *
   * ⚠ NOT A "TOP N". A commissioner checking whether their IDP scoring imported correctly needs the
   * rule they are looking for to be present, and which rule that is cannot be known here. The view
   * decides how many to show at rest and how to reveal the rest.
   */
  rules: LeagueScoringRule[]
}

/** Where these values came from, so a commissioner can tell captured fact from platform default. */
export interface LeagueSettingsProvenance {
  /** e.g. 'sleeper'. Null when the league carries no import metadata. */
  source: string | null
  /** The league's id on that platform, when captured. */
  externalLeagueId: string | null
  /**
   * True when this league's rules are editable HERE.
   *
   * ⚠ FALSE FOR EVERY IMPORTED LEAGUE, AND THAT IS A PRODUCT FACT RATHER THAN A GAP. An imported
   * league's rules live on the platform of origin; Sleeper in particular has no write API at all, so
   * an edit control here could not do anything but lie about having worked.
   */
  editableHere: boolean
}

export interface LeagueSettingsSnapshot {
  leagueName: string | null
  seasonLabel: string | null
  groups: LeagueSettingGroup[]
  scoring: LeagueScoringSummary
  provenance: LeagueSettingsProvenance
}

export interface SettingsClient {
  getSnapshot(): Promise<CommissionerPlatformResponse<LeagueSettingsSnapshot>>
}
