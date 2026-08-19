/**
 * Centralized sport configuration types — used by DB seed, API, scoring context, and commissioner UI metadata.
 */

export type ScoringCategory = {
  key: string
  label: string
  defaultPoints: number
  isToggleable: boolean
  group: string
  sport: string
  unit?: string
  minForBonus?: number
  /** When set, category only applies if this toggle is active (e.g. IDP, TE_PREMIUM). */
  requiresToggle?: string
  /** Threshold-tier scoring (e.g. team-defense points/yards allowed): award the
   *  category's points when rawStats[tierStatKey] falls within [tierMin, tierMax].
   *  tierMin/tierMax are inclusive; omit tierMax for an open-ended top tier. */
  tierStatKey?: string
  tierMin?: number
  tierMax?: number
}

export type ScoringPreset = {
  name: string
  categories: (ScoringCategory & { points: number })[]
}

export type RosterSlot = {
  key: string
  label: string
  eligiblePositions: string[]
  defaultCount: number
  minCount: number
  maxCount: number
  isOptional: boolean
  requiresToggle?: string
  side?: 'campus' | 'canton'
}

export type SettingDef = {
  key: string
  label: string
  description?: string
  type: 'toggle' | 'number' | 'select' | 'scoring_editor' | 'roster_editor'
  defaultValue: unknown
  options?: { value: unknown; label: string }[]
  min?: number
  max?: number
  requiresToggle?: string
  locksAfterStart?: boolean
  section: string
  isAfSubGated?: boolean
}

export type SportConfigFull = {
  sport: string
  displayName: string
  slug: string
  defaultScoringSystem: string
  scoringCategories: ScoringCategory[]
  scoringPresets: ScoringPreset[]
  defaultRosterSlots: RosterSlot[]
  defaultBenchSlots: number
  defaultIRSlots: number
  defaultTaxiSlots: number
  defaultDevySlots: number
  positionEligibility: Record<string, string[]>
  defaultSeasonWeeks: number
  defaultPlayoffStartWeek: number
  defaultPlayoffTeams: number
  defaultMatchupPeriodDays: number
  lineupLockType: string
  supportsRedraft: boolean
  supportsDynasty: boolean
  supportsKeeper: boolean
  supportsDevy: boolean
  supportsC2C: boolean
  supportsIDP: boolean
  supportsSuperflex: boolean
  supportsTEPremium: boolean
  supportsPPR: boolean
  supportsCategories: boolean
  supportsDailyLineups: boolean
  commissionerSettings: SettingDef[]
  aiMetadata: Record<string, unknown>
  /** Legacy redraft seed: weekly | daily | per_match */
  lineupFrequency?: string
  /** Legacy redraft seed: has bye weeks */
  hasBye?: boolean
}
