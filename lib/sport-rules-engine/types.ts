/**
 * Sport-Specific Settings Engine — types.
 * Supported sports: NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

import type { LeagueSport } from '@prisma/client'
import type { PlatformSportRulesDraftTypeId } from '@/lib/draft-types/draftTypeRegistry'

export type SportKey = LeagueSport | string

/** A single roster slot rule: name, allowed positions, count, and whether it's a flex slot. */
export interface RosterSlotRule {
  slotName: string
  allowedPositions: string[]
  starterCount: number
  benchCount: number
  reserveCount: number
  isFlexibleSlot: boolean
  slotOrder: number
}

/** Valid roster slots for a sport (and optional format). */
export interface RosterRules {
  sport: string
  formatType: string
  slots: RosterSlotRule[]
  /** All player positions valid for this sport/format (for pool and validation). */
  allPositions: string[]
  benchSlots: number
  irSlots: number
}

/** Valid scoring format for a sport. */
interface ScoringFormatOption {
  value: string
  label: string
}

/** Valid scoring settings for a sport. */
export interface ScoringRules {
  sport: string
  defaultFormat: string
  validFormats: ScoringFormatOption[]
  categoryType: 'points' | 'category' | 'roto'
}

/** Player pool configuration for a sport. */
export interface PlayerPoolRules {
  sport: string
  /** Source identifier (e.g. 'sleeper', 'sports_player', 'adp'). */
  source: string
  /** Valid positions for pool filtering (same as roster allPositions when applicable). */
  validPositions: string[]
  /** Suggested or max pool size for draft (e.g. 300). */
  poolSizeLimit: number
  /** Whether devy/college players can be in pool (NFL/NCAAF). */
  devyEligible: boolean
}

/** Default pick-order mode when sport defaults do not specify another id. */
type SportRulesDefaultDraftType = Exclude<PlatformSportRulesDraftTypeId, 'mock_draft'>

/** Draft options for a sport. */
export interface DraftOptionRules {
  sport: string
  formatType: string
  /** Allowed draft types for this sport (aligned with `PLATFORM_SPORT_RULES_DRAFT_TYPES` in draft-type registry). */
  allowedDraftTypes: PlatformSportRulesDraftTypeId[]
  /** Default draft type to pre-select for this sport. */
  defaultDraftType: SportRulesDefaultDraftType
  roundsDefault: number
  roundsMin: number
  roundsMax: number
  timerSecondsDefault: number | null
  /** Pick order rules label (e.g. 'snake', 'linear'). */
  pickOrderRules: string
  thirdRoundReversalSupported: boolean
  keeperDynastyCarryoverSupported: boolean
  queueSizeLimit: number
  preDraftRankingSource: string
}

/** Full sport rules: roster, scoring, player pool, draft. */
export interface SportRules {
  sport: string
  formatType: string
  displayName: string
  roster: RosterRules
  scoring: ScoringRules
  playerPool: PlayerPoolRules
  draft: DraftOptionRules
}
