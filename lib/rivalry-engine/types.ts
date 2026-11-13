/**
 * Rivalry Engine — types for records, events, tiers, and scoring.
 */

import type { SupportedSport } from '@/lib/sport-scope'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

export const RIVALRY_TIERS = ['Emerging', 'Heated', 'Blood Feud', 'League Classic'] as const
export type RivalryTier = (typeof RIVALRY_TIERS)[number]

/** Configurable score thresholds for tiers (defaults). */
export const DEFAULT_TIER_THRESHOLDS: Record<RivalryTier, { min: number; max?: number }> = {
  'Emerging': { min: 0, max: 39 },
  'Heated': { min: 40, max: 64 },
  'Blood Feud': { min: 65, max: 84 },
  'League Classic': { min: 85 },
}

export const RIVALRY_EVENT_TYPES = [
  'h2h_matchup',
  'playoff_matchup',
  'elimination',
  'championship_clash',
  'trade',
  'close_game',
  'upset_win',
  'streak',
  'drama',
] as const
export type RivalryEventType = (typeof RIVALRY_EVENT_TYPES)[number]

export interface RivalryScoreInput {
  totalMatchups: number
  closeGameCount: number
  playoffMeetings: number
  eliminationEvents: number
  championshipMeetings: number
  upsetWins: number
  tradeCount: number
  contentionOverlapScore: number
  dramaEventCount: number
}

export const RIVALRY_SPORTS: readonly SupportedSport[] = [...SUPPORTED_SPORTS]
export type RivalrySport = SupportedSport
