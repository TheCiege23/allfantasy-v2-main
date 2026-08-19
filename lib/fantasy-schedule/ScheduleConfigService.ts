/**
 * [NEW] lib/fantasy-schedule/ScheduleConfigService.ts
 * Sport-agnostic schedule config read/write from League.settings JSON.
 */

import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import type { SportScheduleConfig, ScheduleSport } from './types'
import { getDefaultScheduleConfig } from './types'

const PREFIX = 'fantasy_schedule_'

export async function getScheduleConfigForLeague(leagueId: string): Promise<SportScheduleConfig> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true, sport: true },
  })
  const sport = (league?.sport ?? 'NBA') as ScheduleSport
  const defaults = getDefaultScheduleConfig(sport)
  if (!league) return defaults

  const s = (league.settings as Record<string, unknown>) ?? {}
  return {
    sport,
    useDynamicLowVolumeDays: readBool(s, 'use_dynamic_low_volume_days', defaults.useDynamicLowVolumeDays),
    eliminationDayOverride: readNullableInt(s, 'elimination_day_override'),
    ceremonyDayOverride: readNullableInt(s, 'ceremony_day_override'),
    adminDayOverride: readNullableInt(s, 'admin_day_override'),
    volumeThresholdHeavy: readInt(s, 'volume_threshold_heavy', defaults.volumeThresholdHeavy),
    volumeThresholdModerate: readInt(s, 'volume_threshold_moderate', defaults.volumeThresholdModerate),
    adminOnSecondLeastBusy: readBool(s, 'admin_on_second_least_busy', defaults.adminOnSecondLeastBusy),
    balancedScoringDayCount: readInt(s, 'balanced_scoring_day_count', defaults.balancedScoringDayCount),
    finalWeekCounts: readBool(s, 'final_week_counts', defaults.finalWeekCounts),
    transitionDayCount: readInt(s, 'transition_day_count', defaults.transitionDayCount),
    separateSubtotalDisplay: readBool(s, 'separate_subtotal_display', defaults.separateSubtotalDisplay),
  }
}

export async function updateScheduleConfigForLeague(
  leagueId: string,
  patch: Partial<Omit<SportScheduleConfig, 'sport'>>
): Promise<void> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const current = (league?.settings as Record<string, unknown>) ?? {}
  const updates: Record<string, unknown> = { ...current }

  const map: Record<string, keyof typeof patch> = {
    use_dynamic_low_volume_days: 'useDynamicLowVolumeDays',
    elimination_day_override: 'eliminationDayOverride',
    ceremony_day_override: 'ceremonyDayOverride',
    admin_day_override: 'adminDayOverride',
    volume_threshold_heavy: 'volumeThresholdHeavy',
    volume_threshold_moderate: 'volumeThresholdModerate',
    admin_on_second_least_busy: 'adminOnSecondLeastBusy',
    balanced_scoring_day_count: 'balancedScoringDayCount',
    final_week_counts: 'finalWeekCounts',
    transition_day_count: 'transitionDayCount',
    separate_subtotal_display: 'separateSubtotalDisplay',
  }

  for (const [settingsKey, patchKey] of Object.entries(map)) {
    if ((patch as Record<string, unknown>)[patchKey] !== undefined) {
      updates[`${PREFIX}${settingsKey}`] = (patch as Record<string, unknown>)[patchKey]
    }
  }

  await prisma.league.update({ where: { id: leagueId }, data: { settings: toPrismaJsonInput(updates) } })
}

function readBool(s: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = s[`${PREFIX}${key}`]
  return typeof v === 'boolean' ? v : fallback
}
function readInt(s: Record<string, unknown>, key: string, fallback: number): number {
  const v = s[`${PREFIX}${key}`]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function readNullableInt(s: Record<string, unknown>, key: string): number | null {
  const v = s[`${PREFIX}${key}`]
  if (v === null || v === undefined) return null
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
