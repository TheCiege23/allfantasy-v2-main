/**
 * League Drama Engine — types for events, timeline, and drama types.
 */

import type { SupportedSport } from '@/lib/sport-scope'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

export const DRAMA_TYPES = [
  'REVENGE_GAME',
  'MAJOR_UPSET',
  'RIVALRY_CLASH',
  'WIN_STREAK',
  'LOSING_STREAK',
  'PLAYOFF_BUBBLE',
  'TITLE_DEFENSE',
  'TRADE_FALLOUT',
  'REBUILD_PROGRESS',
  'DYNASTY_SHIFT',
] as const
export type DramaType = (typeof DRAMA_TYPES)[number]

export const DRAMA_SPORTS: readonly SupportedSport[] = [...SUPPORTED_SPORTS]
export type DramaSport = SupportedSport

export interface DramaDetectionSignal {
  intensityFactor?: number
  rivalryScore?: number
  upsetMagnitude?: number
  playoffSwing?: number
  recencyWeight?: number
  managerBehaviorHeat?: number
  leagueGraphHeat?: number
}

