/**
 * [NEW] lib/nba-schedule/NbaScheduleConfigService.ts
 * Read/write NBA schedule configuration from League.settings JSON.
 * Follows the same pattern as ScoringWindowResolver and MatchupCadenceResolver.
 */

import * as prismaJson from '@/lib/prisma-json'
import { prisma } from '@/lib/prisma'
import type { NbaScheduleConfig } from './types'
import { DEFAULT_NBA_SCHEDULE_CONFIG } from './types'

const SETTINGS_PREFIX = 'nba_schedule_'

/** Read NBA schedule config from a league's settings JSON. */
export async function getNbaScheduleConfig(leagueId: string): Promise<NbaScheduleConfig> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true, sport: true },
  })

  if (!league || league.sport !== 'NBA') return { ...DEFAULT_NBA_SCHEDULE_CONFIG }

  const settings = (league.settings as Record<string, unknown>) ?? {}
  return {
    useDynamicLowVolumeDays: readBool(settings, 'use_dynamic_low_volume_days', DEFAULT_NBA_SCHEDULE_CONFIG.useDynamicLowVolumeDays),
    eliminationDayOverride: readNullableInt(settings, 'elimination_day_override'),
    ceremonyDayOverride: readNullableInt(settings, 'ceremony_day_override'),
    adminDayOverride: readNullableInt(settings, 'admin_day_override'),
    volumeThresholdHeavy: readInt(settings, 'volume_threshold_heavy', DEFAULT_NBA_SCHEDULE_CONFIG.volumeThresholdHeavy),
    volumeThresholdModerate: readInt(settings, 'volume_threshold_moderate', DEFAULT_NBA_SCHEDULE_CONFIG.volumeThresholdModerate),
    adminOnSecondLeastBusy: readBool(settings, 'admin_on_second_least_busy', DEFAULT_NBA_SCHEDULE_CONFIG.adminOnSecondLeastBusy),
    balancedScoringDayCount: readInt(settings, 'balanced_scoring_day_count', DEFAULT_NBA_SCHEDULE_CONFIG.balancedScoringDayCount),
    finalWeekCounts: readBool(settings, 'final_week_counts', DEFAULT_NBA_SCHEDULE_CONFIG.finalWeekCounts),
    transitionDayCount: readInt(settings, 'transition_day_count', DEFAULT_NBA_SCHEDULE_CONFIG.transitionDayCount),
    separateSubtotalDisplay: readBool(settings, 'separate_subtotal_display', DEFAULT_NBA_SCHEDULE_CONFIG.separateSubtotalDisplay),
  }
}

/** Write NBA schedule config into a league's settings JSON (partial update). */
export async function updateNbaScheduleConfig(
  leagueId: string,
  patch: Partial<NbaScheduleConfig>
): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })

  const current = (league?.settings as Record<string, unknown>) ?? {}
  const updates: Record<string, unknown> = { ...current }

  if (patch.useDynamicLowVolumeDays !== undefined) updates[`${SETTINGS_PREFIX}use_dynamic_low_volume_days`] = patch.useDynamicLowVolumeDays
  if (patch.eliminationDayOverride !== undefined) updates[`${SETTINGS_PREFIX}elimination_day_override`] = patch.eliminationDayOverride
  if (patch.ceremonyDayOverride !== undefined) updates[`${SETTINGS_PREFIX}ceremony_day_override`] = patch.ceremonyDayOverride
  if (patch.adminDayOverride !== undefined) updates[`${SETTINGS_PREFIX}admin_day_override`] = patch.adminDayOverride
  if (patch.volumeThresholdHeavy !== undefined) updates[`${SETTINGS_PREFIX}volume_threshold_heavy`] = patch.volumeThresholdHeavy
  if (patch.volumeThresholdModerate !== undefined) updates[`${SETTINGS_PREFIX}volume_threshold_moderate`] = patch.volumeThresholdModerate
  if (patch.adminOnSecondLeastBusy !== undefined) updates[`${SETTINGS_PREFIX}admin_on_second_least_busy`] = patch.adminOnSecondLeastBusy
  if (patch.balancedScoringDayCount !== undefined) updates[`${SETTINGS_PREFIX}balanced_scoring_day_count`] = patch.balancedScoringDayCount
  if (patch.finalWeekCounts !== undefined) updates[`${SETTINGS_PREFIX}final_week_counts`] = patch.finalWeekCounts
  if (patch.transitionDayCount !== undefined) updates[`${SETTINGS_PREFIX}transition_day_count`] = patch.transitionDayCount
  if (patch.separateSubtotalDisplay !== undefined) updates[`${SETTINGS_PREFIX}separate_subtotal_display`] = patch.separateSubtotalDisplay

  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: prismaJson.toPrismaJsonInput(updates) },
  })
}

// --- Helpers ---

function readBool(settings: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = settings[`${SETTINGS_PREFIX}${key}`]
  return typeof v === 'boolean' ? v : fallback
}

function readInt(settings: Record<string, unknown>, key: string, fallback: number): number {
  const v = settings[`${SETTINGS_PREFIX}${key}`]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function readNullableInt(settings: Record<string, unknown>, key: string): number | null {
  const v = settings[`${SETTINGS_PREFIX}${key}`]
  if (v === null || v === undefined) return null
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
