/**
 * Canonical Create League API — request/response types (concept-first preset pipeline).
 */

import type { LeagueFormatResolution } from '@/lib/league/format-engine'
import type { SettingsSnapshot } from '@/lib/league-contract/types'
import type { MetaEventPayload } from '@/lib/meta-events'

export interface DerivedLeagueFlags {
  isDynasty: boolean
  isKeeper: boolean
  isBestBall: boolean
  isDevy: boolean
  isC2C: boolean
  hasTaxi: boolean
  hasDevy: boolean
  hasPlayoffs: boolean
  usesFAAB: boolean
  usesAuction: boolean
  usesElimination: boolean
  usesSpecialBracket: boolean
}

export interface ValidationIssue {
  path: string
  message: string
  code?: string
}

export interface PresetEngineOutput {
  presetKey: string
  settingsSnapshot: SettingsSnapshot
  conceptRules: Record<string, unknown>
  visualTheme: Record<string, unknown>
  mediaSettings: Record<string, unknown>
  derivedFlags: DerivedLeagueFlags
  warnings: ValidationIssue[]
  /** Full format resolution for DB rows (draft/waiver/roster/scoring). */
  formatResolution: LeagueFormatResolution
  /** Normalized league type / format id (snake_case) */
  leagueFormatId: string
}

export interface CreateLeagueSuccessResponse {
  success: true
  league: {
    id: string
    leagueName: string
    concept: string
    sport: string
    teamCount: number
    draftType: string
    scoringPreset: string
    status: string
    presetKey: string
  }
  homepageUrl?: string
  /** Present when multiple Zombie leagues were committed together. */
  universeId?: string
  leagueIds?: string[]
  /** Non-fatal preset warnings (e.g. odd team count). */
  warnings?: ValidationIssue[]
  metaEvent?: MetaEventPayload
  /** Present for a "Create a test league" request: open seats filled with placeholder AI managers. */
  testLeague?: { placeholdersFilled: number }
}

export interface CreateLeagueErrorResponse {
  success: false
  error: string
  errors: ValidationIssue[]
  detail?: string
}
