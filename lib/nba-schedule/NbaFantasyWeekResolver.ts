/**
 * [NEW] lib/nba-schedule/NbaFantasyWeekResolver.ts
 * Given a league type + week, produces a FantasyWeekPlan by combining
 * game volume data with a league-type-specific schedule adapter.
 */

import { getWeekVolumeProfile } from './NbaGameVolumeService'
import { getNbaScheduleConfig } from './NbaScheduleConfigService'
import { getScheduleAdapter } from './adapters'
import type { FantasyWeekPlan } from './types'
import type { LeagueFormatId } from '@/lib/league/format-engine'

/**
 * Resolve the fantasy week plan for an NBA league.
 * Combines real game volume data with league-type-specific scheduling logic.
 */
export async function resolveNbaFantasyWeek(options: {
  leagueId: string
  leagueFormatId: LeagueFormatId
  leagueVariant?: string | null
  season: number
  week: number
  context?: Record<string, unknown>
}): Promise<FantasyWeekPlan> {
  const { leagueId, leagueFormatId, season, week, context } = options

  // Load NBA schedule config for this league
  const config = await getNbaScheduleConfig(leagueId)

  // Get the real game volume profile for this week
  const volumeProfile = await getWeekVolumeProfile(season, week, {
    thresholdHeavy: config.volumeThresholdHeavy,
    thresholdModerate: config.volumeThresholdModerate,
  })

  // Get the league-type-specific adapter
  const leagueType = mapVariantToFormatId(leagueFormatId, options.leagueVariant)
  const adapter = getScheduleAdapter(leagueType)

  // Resolve the fantasy week plan through the adapter
  return adapter.resolveFantasyWeek(volumeProfile, config, context)
}

/** Map specialty league variants to their base format ID for adapter selection. */
function mapVariantToFormatId(formatId: LeagueFormatId, variant?: string | null): LeagueFormatId {
  // Specialty variants map to their own format IDs
  if (variant === 'big_brother') return 'big_brother' as LeagueFormatId
  if (variant === 'devy_dynasty') return 'devy' as LeagueFormatId
  if (variant === 'merged_devy_c2c') return 'c2c' as LeagueFormatId
  if (variant === 'tournament_mode') return 'tournament' as LeagueFormatId
  return formatId
}
