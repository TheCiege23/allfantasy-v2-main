/**
 * [NEW] lib/nhl-schedule/index.ts
 * NHL-specific schedule utilities. Thin wrapper over the sport-agnostic fantasy-schedule module.
 * Provides NHL-typed convenience functions and NHL-specific calendar metadata.
 */

import { getWeekVolumeProfile as _getWeekVolumeProfile, getLeastBusyDay as _getLeastBusyDay, getMostBusyDay as _getMostBusyDay, getBalancedScoringDays as _getBalancedScoringDays, getWeekGameCounts as _getWeekGameCounts, getSeasonVolumeProfiles as _getSeasonVolumeProfiles, resolveFantasyWeek as _resolveFantasyWeek } from '@/lib/fantasy-schedule'
import type { FantasyWeekPlan } from '@/lib/fantasy-schedule'
import type { LeagueFormatId } from '@/lib/league/format-engine'

// Re-export generalized types
export type { WeekVolumeProfile, DayVolume, FantasyWeekPlan } from '@/lib/fantasy-schedule'
export { getScheduleConfigForLeague, updateScheduleConfigForLeague } from '@/lib/fantasy-schedule'

const SPORT = 'NHL' as const

// NHL-typed convenience functions
export const getNhlWeekVolumeProfile = (season: number, week: number, options?: { thresholdHeavy?: number; thresholdModerate?: number }) =>
  _getWeekVolumeProfile(SPORT, season, week, options)

export const getNhlSeasonVolumeProfiles = (season: number, startWeek: number, endWeek: number) =>
  _getSeasonVolumeProfiles(SPORT, season, startWeek, endWeek)

export async function resolveNhlFantasyWeek(options: {
  leagueId: string
  leagueFormatId: LeagueFormatId
  leagueVariant?: string | null
  season: number
  week: number
  context?: Record<string, unknown>
}): Promise<FantasyWeekPlan> {
  return _resolveFantasyWeek({ ...options, sport: SPORT })
}
