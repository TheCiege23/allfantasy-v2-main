/**
 * [NEW] lib/ncaab-schedule/index.ts
 * NCAAB-specific schedule utilities. Thin wrapper over the sport-agnostic fantasy-schedule module.
 *
 * NCAAB has unique scheduling characteristics:
 * - Very high game volume (350+ D1 teams)
 * - Non-conference season (Nov-Dec): holiday tournaments, invitationals
 * - Conference play (Jan-Mar): structured round-robin within conferences
 * - Conference tournaments (early March): one per conference
 * - Selection Sunday (mid-March)
 * - NCAA Tournament / March Madness (mid-March through early April)
 * - Final Four + Championship (first weekend of April)
 * - Games spread across all days but heaviest Tue/Wed/Sat
 * - Bracket mode support for March Madness-style fantasy
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

const SPORT = 'NCAAB' as const

// NCAAB-typed convenience functions
export const getNcaabWeekVolumeProfile = (season: number, week: number, options?: { thresholdHeavy?: number; thresholdModerate?: number }) =>
  _getWeekVolumeProfile(SPORT, season, week, options)

export const getNcaabSeasonVolumeProfiles = (season: number, startWeek: number, endWeek: number) =>
  _getSeasonVolumeProfiles(SPORT, season, startWeek, endWeek)

export async function resolveNcaabFantasyWeek(options: {
  leagueId: string
  leagueFormatId: LeagueFormatId
  leagueVariant?: string | null
  season: number
  week: number
  context?: Record<string, unknown>
}): Promise<FantasyWeekPlan> {
  return _resolveFantasyWeek({ ...options, sport: SPORT })
}
