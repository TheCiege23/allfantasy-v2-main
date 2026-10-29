/**
 * [NEW] lib/playoff-settings/PlayoffScheduleRecalculator.ts
 * Recalculates fantasy schedule when playoff stage settings change.
 * Deterministic: adjusts week numbers based on stage additions/removals.
 */

import { resolveDefaultPlayoffConfig } from '@/lib/sport-defaults/DefaultPlayoffConfigResolver'
import { getPlayoffStagesBySport } from './PlayoffStageRegistry'
import type { PlayoffConfig, ScheduleAdjustmentSummary } from './types'
import type { SportType } from '@/lib/sport-defaults/types'

/**
 * Calculate the schedule impact of enabling/disabling playoff stages.
 * Returns a summary of changes + new week numbers.
 *
 * `options.playoffStartWeek` (native leagues): the commissioner's chosen start week, from
 * resolvePlayoffStartWeek. The start week is then FIXED — stages only change the playoff length,
 * and a season-shortening stage does not move it (the quick "Playoff start week" field does).
 * Without it (imported leagues), the original sport-default computation is unchanged.
 */
export function calculateScheduleAdjustment(
  sport: string,
  currentConfig: PlayoffConfig,
  newIncludedStages: string[],
  variant?: string | null,
  options?: { playoffStartWeek?: number | null }
): ScheduleAdjustmentSummary {
  const fixedStartWeek =
    typeof options?.playoffStartWeek === 'number' && options.playoffStartWeek > 0 ? options.playoffStartWeek : null
  const sportType = sport.toUpperCase() as SportType
  const defaults = resolveDefaultPlayoffConfig(sportType, variant)
  const allStages = getPlayoffStagesBySport(sport)

  // Calculate additional weeks from enabled stages
  let additionalWeeks = 0
  let seasonShortenedWeeks = 0
  const changes: string[] = []

  for (const stageId of newIncludedStages) {
    const stage = allStages.find((s) => s.id === stageId)
    if (!stage) continue
    additionalWeeks += stage.additionalWeeks
    if (stage.shortensSeason) {
      if (fixedStartWeek != null) {
        changes.push(
          `${stage.label}: playoffs still start Week ${fixedStartWeek} - change "Playoffs start (week)" in Quick schedule to end the regular season earlier`
        )
      } else {
        seasonShortenedWeeks += stage.additionalWeeks || 1
        changes.push(`Regular season shortened by ${stage.additionalWeeks || 1} week(s) for ${stage.label}`)
      }
    }
    if (stage.additionalWeeks > 0) {
      changes.push(`${stage.label} adds ${stage.additionalWeeks} playoff week(s)`)
    } else {
      changes.push(`${stage.label} included (no extra weeks)`)
    }
    if (stage.warning) {
      changes.push(`Note: ${stage.warning}`)
    }
  }

  // Compare with previously enabled stages
  const previousStages = new Set(currentConfig.includedStages)
  const newStageSet = new Set(newIncludedStages)
  const added = newIncludedStages.filter((id) => !previousStages.has(id))
  const removed = currentConfig.includedStages.filter((id) => !newStageSet.has(id))

  if (added.length > 0) {
    const addedLabels = added.map((id) => allStages.find((s) => s.id === id)?.label ?? id)
    changes.unshift(`Added: ${addedLabels.join(', ')}`)
  }
  if (removed.length > 0) {
    const removedLabels = removed.map((id) => allStages.find((s) => s.id === id)?.label ?? id)
    changes.unshift(`Removed: ${removedLabels.join(', ')}`)
  }

  const basePlayoffStartWeek = fixedStartWeek ?? defaults.playoff_start_week ?? 15
  const basePlayoffWeeks = defaults.playoff_weeks ?? 3

  const newRegularSeasonEndWeek = basePlayoffStartWeek - 1 - seasonShortenedWeeks
  const newPlayoffStartWeek = newRegularSeasonEndWeek + 1
  const newPlayoffWeeks = basePlayoffWeeks + additionalWeeks
  const newChampionshipWeek = newPlayoffStartWeek + newPlayoffWeeks - 1
  const totalWeeksChanged = additionalWeeks - seasonShortenedWeeks

  if (totalWeeksChanged !== 0) {
    changes.push(`Fantasy playoffs now span ${newPlayoffWeeks} weeks (was ${basePlayoffWeeks})`)
    changes.push(`Playoffs begin Week ${newPlayoffStartWeek}, championship Week ${newChampionshipWeek}`)
  }

  return {
    changes,
    newRegularSeasonEndWeek,
    newPlayoffStartWeek,
    newPlayoffWeeks,
    newChampionshipWeek,
    totalWeeksChanged,
  }
}
