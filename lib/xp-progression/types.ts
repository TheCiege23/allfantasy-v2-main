/**
 * Career XP + Tier System — types for XP events, profiles, and tiers.
 * Supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

/** XP event types generated from season history and platform actions. */
export const GENERATED_XP_EVENT_TYPES = [
  'win_matchup',
  'make_playoffs',
  'championship',
  'successful_trade',
  'season_completion',
  'draft_accuracy',
  'league_participation',
  'commissioner_service',
] as const

/** XP events that are granted directly from platform systems such as referrals. */
const MANUAL_XP_EVENT_TYPES = [
  'referral_bonus',
  'creator_referral_bonus',
] as const

/** XP event types (sources of XP). */
export const XP_EVENT_TYPES = [
  ...GENERATED_XP_EVENT_TYPES,
  ...MANUAL_XP_EVENT_TYPES,
] as const

export type XPEventType = (typeof XP_EVENT_TYPES)[number]
export type GeneratedXPEventType = (typeof GENERATED_XP_EVENT_TYPES)[number]

/** XP values per event type (prompt examples + extensions). */
export const XP_VALUES: Record<XPEventType, number> = {
  win_matchup: 10,
  make_playoffs: 50,
  championship: 200,
  successful_trade: 10,
  season_completion: 25,
  draft_accuracy: 15,
  league_participation: 5,
  commissioner_service: 25,
  referral_bonus: 50,
  creator_referral_bonus: 100,
}

/** Tiers (Bronze → Legendary). */
export const XP_TIERS = [
  'Bronze GM',
  'Silver GM',
  'Gold GM',
  'Elite GM',
  'Legendary GM',
] as const

export type XPTier = (typeof XP_TIERS)[number]

/** XP thresholds: min XP to be in tier. Legendary has no cap. */
export const XP_TIER_THRESHOLDS: Record<XPTier, number> = {
  'Bronze GM': 0,
  'Silver GM': 100,
  'Gold GM': 300,
  'Elite GM': 600,
  'Legendary GM': 1000,
}

/** XP required to reach next tier from current (for progress bar). */
export const XP_TO_NEXT_TIER: Record<XPTier, number> = {
  'Bronze GM': 100,
  'Silver GM': 200,
  'Gold GM': 300,
  'Elite GM': 400,
  'Legendary GM': 0, // no next tier
}

export interface ManagerXPProfileView {
  profileId: string
  managerId: string
  totalXP: number
  currentTier: string
  xpToNextTier: number
  updatedAt: Date
  tierBadgeColor?: string
  progressInTier?: number // 0-100 for progress bar within current tier
}

export interface XPEventView {
  eventId: string
  managerId: string
  eventType: XPEventType
  xpValue: number
  sport: string
  createdAt: Date
}
