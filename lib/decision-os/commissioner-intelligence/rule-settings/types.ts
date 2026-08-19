/**
 * Commissioner Intelligence Platform — Phase 6: Rule / Settings display contract.
 *
 * `CommissionerRuleSettingsV1` answers "how is this league configured?" with
 * DETERMINISTIC, DESCRIPTIVE facts. It EXPLAINS/SUMMARIZES configuration — it
 * never judges the rules or recommends changes (no "you should change", "unfair",
 * "poorly configured", etc.). `playoffConfiguration:'needs_review'` is emitted
 * ONLY for an OBJECTIVE deterministic inconsistency (e.g. playoff teams exceed
 * league size), framed "worth a look", never as criticism.
 *
 * ── Canonical-source decision (Phase 5 audit) ────────────────────────────────
 * Consume NORMALIZED / RESOLVED settings, never raw JSON (raw `League.settings`
 * carries legacy flat keys alongside the typed snapshot). Resolver order:
 *   1. `parseSettingsSnapshot(League.settings)`  → typed `SettingsSnapshot`
 *   2. `resolveRedraftRosterConfig(sport, settings)` → normalized roster + source
 *   3. `getRedraftSportConfig(sport)` → per-sport DEFAULTS (the standard-vs-custom baseline)
 *   4. `League` dedicated columns (waiver/trade/playoff) as fallback/context
 * Deliberately NOT consumed: any AI/recommendation settings source
 * (division-settings/ai-name, redraft/ai/commissioner, lib/ai-commissioner/*).
 * NOTE: settings are STORED config (not DomainEvent projections), so this module
 * renders useful data even for import-only leagues.
 */

export const COMMISSIONER_RULE_SETTINGS_VERSION = 'commissioner-rule-settings.v1'

export type LeagueFormat = 'standard' | 'custom' | 'advanced' | 'unknown'
export type Complexity = 'simple' | 'moderate' | 'complex' | 'unknown'
export type TransactionPolicy = 'open' | 'reviewed' | 'restricted' | 'unknown'
export type PlayoffConfiguration = 'standard' | 'custom' | 'needs_review' | 'unknown'
export type RuleSettingsSource = 'settings_snapshot' | 'league_columns' | 'defaults' | 'mixed'

export interface CommissionerRuleSettingsV1 {
  version: typeof COMMISSIONER_RULE_SETTINGS_VERSION
  derivedAt: string

  leagueFormat: LeagueFormat
  rosterComplexity: Complexity
  scoringComplexity: Complexity
  transactionPolicy: TransactionPolicy
  playoffConfiguration: PlayoffConfiguration

  /** Neutral factual statements (e.g. "Uses FAAB waivers", "Includes Superflex"). */
  settingsHighlights: string[]
  caveats: string[]
  summary: string

  /** Provenance — how confident/where the values came from. */
  source?: RuleSettingsSource
}

// ── pure aggregator inputs (Prisma-decoupled, already normalized) ─────────────

export interface RuleSettingsDefaults {
  starterCount: number | null
  benchSlots: number | null
  irSlots: number | null
  scoringFormat: string | null
  playoffTeams: number | null
  teamCount: number | null
  waiverType: string | null
  seasonWeeks: number | null
}

export interface RuleSettingsInput {
  hasSettings: boolean
  source: RuleSettingsSource
  // roster (normalized via resolveRedraftRosterConfig + snapshot)
  starterSlots: Record<string, number>
  benchSlots: number
  irSlots: number
  taxiSlots: number
  devyCollegeSlots: number
  // scoring
  scoringFormat: string | null
  scoringMode: string | null
  scoringRules: Record<string, unknown> | null
  // concept
  leagueType: string | null
  // transactions
  waiverType: string | null
  tradeReviewMode: string | null
  tradeReviewHours: number | null
  tradeDeadlineWeek: number | null
  // playoff
  playoffTeams: number | null
  playoffStartWeek: number | null
  playoffSeedingRule: string | null
  leagueTeamCount: number | null
  // per-sport defaults (standard-vs-custom baseline)
  defaults: RuleSettingsDefaults | null
}
