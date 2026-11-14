/**
 * [NEW] lib/ncaaf-schedule/index.ts
 * NCAAF-specific schedule utilities. Thin wrapper over the sport-agnostic fantasy-schedule module.
 *
 * NCAAF has unique scheduling characteristics:
 * - Week 0 (late August, limited games)
 * - Saturday-heavy slates (40-60+ games)
 * - Thursday/Friday midweek games (MACtion, etc.)
 * - Rivalry week (final regular season week)
 * - Conference championship week
 * - Bowl season (mid-December through early January)
 * - College Football Playoff (December/January)
 * - Bye weeks less structured than NFL
 * - Conference-specific scheduling patterns
 * - Short season (12-15 regular season games per team)
 */

import { getWeekVolumeProfile as _getWeekVolumeProfile, getLeastBusyDay as _getLeastBusyDay, getMostBusyDay as _getMostBusyDay, getBalancedScoringDays as _getBalancedScoringDays, getWeekGameCounts as _getWeekGameCounts, getSeasonVolumeProfiles as _getSeasonVolumeProfiles, resolveFantasyWeek as _resolveFantasyWeek } from '@/lib/fantasy-schedule'
import type { FantasyWeekPlan } from '@/lib/fantasy-schedule'
import type { LeagueFormatId } from '@/lib/league/format-engine'

export type { WeekVolumeProfile, DayVolume, FantasyWeekPlan } from '@/lib/fantasy-schedule'
export { getScheduleConfigForLeague, updateScheduleConfigForLeague } from '@/lib/fantasy-schedule'

const SPORT = 'NCAAF' as const

// NCAAF-typed convenience functions
export const getNcaafWeekVolumeProfile = (season: number, week: number, options?: { thresholdHeavy?: number; thresholdModerate?: number }) =>
  _getWeekVolumeProfile(SPORT, season, week, options)

export const getNcaafSeasonVolumeProfiles = (season: number, startWeek: number, endWeek: number) =>
  _getSeasonVolumeProfiles(SPORT, season, startWeek, endWeek)

export async function resolveNcaafFantasyWeek(options: {
  leagueId: string
  leagueFormatId: LeagueFormatId
  leagueVariant?: string | null
  season: number
  week: number
  context?: Record<string, unknown>
}): Promise<FantasyWeekPlan> {
  return _resolveFantasyWeek({ ...options, sport: SPORT })
}
