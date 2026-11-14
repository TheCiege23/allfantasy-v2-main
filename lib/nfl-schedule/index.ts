/**
 * [NEW] lib/nfl-schedule/index.ts
 * NFL-specific schedule utilities. Thin wrapper over the sport-agnostic fantasy-schedule module.
 *
 * NFL has a unique weekly structure:
 * - Thursday Night Football (1 game)
 * - Sunday early slate (6-8 games, 1pm ET)
 * - Sunday late slate (2-3 games, 4:05/4:25pm ET)
 * - Sunday Night Football (1 game, 8:20pm ET)
 * - Monday Night Football (1-2 games, 8:15pm ET)
 * - Occasional Saturday games (Weeks 15-18)
 * - Bye weeks (Weeks 5-14 typically)
 * - Thanksgiving (3 games)
 * - Black Friday (1 game, newer addition)
 * - International games (London, Munich, Mexico City)
 *
 * Admin/processing windows: Tuesday-Wednesday (post-MNF, pre-waivers)
 * Waiver processing: typically Wednesday morning
 * Lineup lock: first kickoff of the week (Thursday) or rolling per-game locks
 */

import { getWeekVolumeProfile as _getWeekVolumeProfile, getLeastBusyDay as _getLeastBusyDay, getMostBusyDay as _getMostBusyDay, getBalancedScoringDays as _getBalancedScoringDays, getWeekGameCounts as _getWeekGameCounts, getSeasonVolumeProfiles as _getSeasonVolumeProfiles, resolveFantasyWeek as _resolveFantasyWeek } from '@/lib/fantasy-schedule'
import type { FantasyWeekPlan } from '@/lib/fantasy-schedule'
import type { LeagueFormatId } from '@/lib/league/format-engine'

export type { WeekVolumeProfile, DayVolume, FantasyWeekPlan } from '@/lib/fantasy-schedule'
export { getScheduleConfigForLeague, updateScheduleConfigForLeague } from '@/lib/fantasy-schedule'

const SPORT = 'NFL' as const

// NFL-typed convenience functions
export const getNflWeekVolumeProfile = (season: number, week: number, options?: { thresholdHeavy?: number; thresholdModerate?: number }) =>
  _getWeekVolumeProfile(SPORT, season, week, options)

export const getNflSeasonVolumeProfiles = (season: number, startWeek: number, endWeek: number) =>
  _getSeasonVolumeProfiles(SPORT, season, startWeek, endWeek)

export async function resolveNflFantasyWeek(options: {
  leagueId: string
  leagueFormatId: LeagueFormatId
  leagueVariant?: string | null
  season: number
  week: number
  context?: Record<string, unknown>
}): Promise<FantasyWeekPlan> {
  return _resolveFantasyWeek({ ...options, sport: SPORT })
}
