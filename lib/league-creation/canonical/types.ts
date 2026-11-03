/**
 * Canonical Create League API — request/response types (concept-first preset pipeline).
 */

import type { LeagueSport } from '@prisma/client'
import type { LeagueFormatResolution } from '@/lib/league/format-engine'
import type { SettingsSnapshot } from '@/lib/league-contract/types'
import type { MetaEventPayload } from '@/lib/meta-events'

export type CanonicalDraftType =
  | 'snake'
  | 'linear'
  | 'auction'
  | 'slow_draft'
  | 'mock_draft'
  | 'devy_snake'
  | 'devy_auction'
  | 'c2c_snake'
  | 'c2c_auction'
  | 'offline'
  | 'auto'
  | 'team'

export interface CreateLeagueRequestBody {
  concept: string
  sport: LeagueSport | string
  scoringPreset: string
  teamCount: number
  draftType: CanonicalDraftType | string
  leagueName: string
  conceptSetup?: Record<string, unknown> | null
  /** Required when sport is SOCCER */
  soccerPipeline?: 'mls' | 'euro' | null
  /** Defaults applied server-side if omitted */
  timezone?: string
  language?: 'en' | 'es'
  tradeReviewMode?: 'commissioner' | 'league_vote' | 'instant' | 'none'
}

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
}

export interface CreateLeagueErrorResponse {
  success: false
  error: string
  errors: ValidationIssue[]
  detail?: string
}
