/**
 * Canonical league contract — aligns with Prisma `League` + `settings` JSON + `LeagueSettings` draft row.
 *
 * - Core queryable fields: see `League` model (`presetKey`, `scoringPresetId`, `settingsSnapshotVersion`, `leagueType`).
 * - Full snapshot: `League.settings` should conform to `SettingsSnapshot` (versioned via `settingsSnapshotVersion`).
 * - Draft operations: `LeagueSettings` holds live draft room fields; mirror critical defaults in `settings.draftSettings`.
 */

import type { LeagueSport } from '@prisma/client'

/** Matches `League.leagueType` / wizard concept ids */
type LeagueConceptId = string

export const SETTINGS_SNAPSHOT_VERSION = 1 as const

export interface SettingsSnapshot {
  /** Redundant with `League.settingsSnapshotVersion` when stored on row; useful for exported JSON bundles */
  snapshotVersion?: number

  rosterSettings?: RosterSettingsSlice
  scoringSettings?: ScoringSettingsSlice
  draftSettings?: DraftSettingsSlice
  waiverSettings?: WaiverSettingsSlice
  playoffSettings?: PlayoffSettingsSlice
  commissionerSettings?: CommissionerSettingsSlice
  mediaSettings?: MediaSettingsSlice
  visualTheme?: VisualThemeSlice

  /** Create-time specialty answers (minimal); optional after shell exists */
  conceptSetup?: ConceptSetupSlice
  /** Generated specialty rules; optional */
  conceptRules?: ConceptRulesSlice

  metadata?: {
    createdFromFlow?: string
    creationPresetSnapshot?: Record<string, unknown>
    importNormalizationVersion?: string
    lastSyncedAt?: string
    [key: string]: unknown
  }

  /** Legacy flat keys coexist during migration — do not strip arbitrarily */
  [key: string]: unknown
}

interface RosterSettingsSlice {
  starterSlots?: Record<string, number>
  benchSlots?: number
  irSlots?: number
  taxiSlots?: number
  devyCollegeSlots?: number
  positionEligibility?: Record<string, unknown>
  /** Mirrors commissioner flags for UI split — `resolveRosterTransactionRules` reads these as fallbacks. */
  illegalRosterBlocksTrades?: boolean
  illegalRosterBlocksWaiverClaims?: boolean
  illegalRosterCommissionerBypass?: boolean
}

interface ScoringSettingsSlice {
  format?: string
  scoringTemplateId?: string
  /** Passed to `server/services/scoringEngine` — supports `thresholdBonuses`, `positionMultipliers`, `idpStatAllowlist`, `matchupTiebreaker`, `standingsTiebreakerOrder`. */
  rules?: Record<string, unknown>
  source?: string
  preset?: string
  /**
   * Canonical scoring-mode identifier. Mirrors `settings.scoring_mode` in the
   * flat snapshot and `ScoringMode` in `lib/category-scoring/types.ts`. When
   * set to `'h2h_category'`, the weekly matchup engine resolves winners per
   * category instead of summing fantasy points; paired with `categoryPresetId`.
   */
  scoringMode?: 'points' | 'h2h_category' | 'roto'
  /** Resolves to a list of category definitions at runtime (NBA 8/9-cat, more to come). */
  categoryPresetId?: string
  [key: string]: unknown
}

interface DraftSettingsSlice {
  draftType?: string
  rounds?: number
  pickOrderRules?: string
  timerSeconds?: number
  thirdRoundReversal?: boolean
  auctionBudgetPerTeam?: number
  [key: string]: unknown
}

interface WaiverSettingsSlice {
  waiverType?: string
  faabBudget?: number
  processingDays?: number[]
  processingTimeUtc?: string
  [key: string]: unknown
}

interface PlayoffSettingsSlice {
  playoffTeams?: number
  playoffStartWeek?: number
  seedingRule?: string
  [key: string]: unknown
}

interface CommissionerSettingsSlice {
  tradeReviewMode?: string
  tradeDeadlineWeek?: number
  /** When true, block proposing/accepting/processing trades if either party’s roster fails legality (see `rosterTransactionGates`). */
  illegalRosterBlocksTrades?: boolean
  /** When true, block waiver / add-drop claims while roster is illegal. */
  illegalRosterBlocksWaiverClaims?: boolean
  /** Alias supported in gates: `illegalRosterBlocksWaivers` */
  illegalRosterBlocksWaivers?: boolean
  /** When true (default in resolver), elevated commissioners bypass illegal-roster blocks on trades/waivers. */
  illegalRosterCommissionerBypass?: boolean
  [key: string]: unknown
}

interface MediaSettingsSlice {
  introVideo?: { url?: string; key?: string }
  [key: string]: unknown
}

interface VisualThemeSlice {
  accent?: string
  logoUrl?: string
  [key: string]: unknown
}

/** Minimum create-time specialty payload — extend per concept without new tables */
type ConceptSetupSlice = Record<string, unknown>

interface ConceptRulesSlice {
  concept?: LeagueConceptId
  version?: number
  extensions?: Record<string, unknown>
  [key: string]: unknown
}

export function parseSettingsSnapshot(raw: unknown): SettingsSnapshot | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as SettingsSnapshot
}

/** Build stable preset fingerprint for `League.presetKey` */
export function buildPresetKey(parts: {
  concept: string
  sport: LeagueSport | string
  scoringPresetId: string
  draftType: string
  teamCount?: number
}): string {
  const t = parts.teamCount != null ? `|teams=${parts.teamCount}` : ''
  return `af:v${SETTINGS_SNAPSHOT_VERSION}|concept=${parts.concept}|sport=${parts.sport}|scoring=${parts.scoringPresetId}|draft=${parts.draftType}${t}`
}
