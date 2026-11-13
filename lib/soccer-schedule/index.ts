/**
 * [NEW] lib/soccer-schedule/index.ts
 * Soccer-specific schedule utilities. Thin wrapper over the sport-agnostic fantasy-schedule module.
 *
 * Soccer has unique scheduling characteristics:
 * - Matchday-based (not weekly like US sports)
 * - 38 matchdays in a typical league season (Aug-May)
 * - International breaks (5-6 per season, ~2 weeks each)
 * - Double gameweeks (DGW) — teams play twice in one fantasy week
 * - Blank gameweeks (BGW) — some teams don't play due to cup rescheduling
 * - Domestic cups (FA Cup, League Cup, etc.) running concurrently
 * - Continental competitions (Champions League, Europa League) midweek
 * - Winter break (varies by league — Bundesliga yes, Premier League partial)
 * - Holiday fixture congestion (Boxing Day, New Year's)
 * - Transfer windows (January, Summer)
 * - No playoffs in most leagues (table position determines champion)
 */

import {
  getWeekVolumeProfile as _getWeekVolumeProfile,
  getLeastBusyDay as _getLeastBusyDay,
  getMostBusyDay as _getMostBusyDay,
  getBalancedScoringDays as _getBalancedScoringDays,
  getWeekGameCounts as _getWeekGameCounts,
  getSeasonVolumeProfiles as _getSeasonVolumeProfiles,
  resolveFantasyWeek as _resolveFantasyWeek,
  getScheduleConfigForLeague,
  updateScheduleConfigForLeague,
} from '@/lib/fantasy-schedule'
import type { WeekVolumeProfile, DayVolume, FantasyWeekPlan } from '@/lib/fantasy-schedule'
import type { LeagueFormatId } from '@/lib/league/format-engine'

export type { WeekVolumeProfile, DayVolume, FantasyWeekPlan } from '@/lib/fantasy-schedule'
export { getScheduleConfigForLeague, updateScheduleConfigForLeague } from '@/lib/fantasy-schedule'

const SPORT = 'SOCCER' as const

// Soccer-typed convenience functions
export const getSoccerWeekVolumeProfile = (season: number, week: number, options?: { thresholdHeavy?: number; thresholdModerate?: number }) =>
  _getWeekVolumeProfile(SPORT, season, week, options)

export const getSoccerSeasonVolumeProfiles = (season: number, startWeek: number, endWeek: number) =>
  _getSeasonVolumeProfiles(SPORT, season, startWeek, endWeek)

export async function resolveSoccerFantasyWeek(options: {
  leagueId: string
  leagueFormatId: LeagueFormatId
  leagueVariant?: string | null
  season: number
  week: number
  context?: Record<string, unknown>
}): Promise<FantasyWeekPlan> {
  return _resolveFantasyWeek({ ...options, sport: SPORT })
}
