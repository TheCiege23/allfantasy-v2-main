/**
 * [NEW] lib/playoff-settings/PlayoffConfigService.ts
 * Read/write playoff configuration from League.settings JSON.
 * Validates premium access before saving premium stages.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { PlayoffConfig } from './types'
import { EMPTY_PLAYOFF_CONFIG } from './types'
import { hasPremiumStages, validateStageIds } from './PlayoffStageRegistry'
import { calculateScheduleAdjustment } from './PlayoffScheduleRecalculator'
import { readChosenPlayoffStartWeek, resolvePlayoffStartWeek, type PlayoffStartWeekLeague } from './resolvePlayoffStartWeek'
import { isNativePlatform } from '@/lib/league/isNativeLeague'

const PREFIX = 'playoff_config_'

const START_WEEK_SELECT = { playoffStartWeek: true, platform: true, leagueVariant: true } as const

/**
 * Native leagues: the start week the stage editor uses — the commissioner's chosen week
 * (resolvePlayoffStartWeek). Imported leagues: undefined, i.e. the original sport-default behaviour.
 */
export function stageEditorPlayoffStartWeek(
  league: PlayoffStartWeekLeague & { platform?: string | null },
): number | undefined {
  if (!isNativePlatform(league.platform)) return undefined
  return resolvePlayoffStartWeek(league).week
}

/** Read playoff config from a league's settings JSON. */
export async function getPlayoffConfig(leagueId: string): Promise<PlayoffConfig> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true, sport: true, ...START_WEEK_SELECT },
  })
  if (!league) return { ...EMPTY_PLAYOFF_CONFIG }

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const raw = settings[`${PREFIX}data`] as Record<string, unknown> | undefined
  // Native: seed from the chosen week, never from whatever this config stored (it used to store a
  // sport-default week).
  const startWeek = stageEditorPlayoffStartWeek(league)
  const seeded = (config: PlayoffConfig): PlayoffConfig =>
    startWeek == null
      ? config
      : { ...config, adjustedPlayoffStartWeek: startWeek, adjustedRegularSeasonEndWeek: startWeek - 1 }

  if (!raw) {
    return seeded({ ...EMPTY_PLAYOFF_CONFIG, sport: league.sport })
  }

  return seeded({
    sport: (raw.sport as string) ?? league.sport,
    includedStages: Array.isArray(raw.includedStages) ? raw.includedStages as string[] : [],
    startMode: (raw.startMode as string) ?? 'default',
    regularSeasonShiftApplied: Boolean(raw.regularSeasonShiftApplied),
    adjustedRegularSeasonEndWeek: typeof raw.adjustedRegularSeasonEndWeek === 'number' ? raw.adjustedRegularSeasonEndWeek : null,
    adjustedPlayoffStartWeek: typeof raw.adjustedPlayoffStartWeek === 'number' ? raw.adjustedPlayoffStartWeek : null,
    adjustedPlayoffWeeks: typeof raw.adjustedPlayoffWeeks === 'number' ? raw.adjustedPlayoffWeeks : null,
    premiumFeaturesUsed: Boolean(raw.premiumFeaturesUsed),
    lastUpdatedAt: (raw.lastUpdatedAt as string) ?? null,
  })
}

/** Save playoff config. Validates stage IDs and premium access. */
export async function savePlayoffConfig(
  leagueId: string,
  config: Partial<PlayoffConfig>,
  options?: { isPremium?: boolean }
): Promise<{ ok: boolean; error?: string; adjustment?: ReturnType<typeof calculateScheduleAdjustment> }> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true, sport: true, ...START_WEEK_SELECT },
  })
  if (!league) return { ok: false, error: 'League not found' }
  const startWeek = stageEditorPlayoffStartWeek(league)

  const sport = league.sport
  const includedStages = config.includedStages ?? []

  // Validate stage IDs
  const { valid, invalidIds } = validateStageIds(sport, includedStages)
  if (!valid) return { ok: false, error: `Invalid stage IDs: ${invalidIds.join(', ')}` }

  // Check premium access
  if (hasPremiumStages(sport, includedStages) && !options?.isPremium) {
    return { ok: false, error: 'premiumRequired' }
  }

  // Calculate schedule adjustment
  const currentConfig = await getPlayoffConfig(leagueId)
  const adjustment = calculateScheduleAdjustment(sport, currentConfig, includedStages, league.leagueVariant, {
    playoffStartWeek: startWeek,
  })

  // Build the new config
  const newConfig: PlayoffConfig = {
    sport,
    includedStages,
    startMode: config.startMode ?? 'default',
    regularSeasonShiftApplied: adjustment.totalWeeksChanged !== 0,
    adjustedRegularSeasonEndWeek: adjustment.newRegularSeasonEndWeek,
    adjustedPlayoffStartWeek: adjustment.newPlayoffStartWeek,
    adjustedPlayoffWeeks: adjustment.newPlayoffWeeks,
    premiumFeaturesUsed: hasPremiumStages(sport, includedStages),
    lastUpdatedAt: new Date().toISOString(),
  }

  // Save to League.settings
  const currentSettings = (league.settings as Record<string, unknown>) ?? {}
  const nextSettings: Record<string, unknown> = { ...currentSettings, [`${PREFIX}data`]: newConfig }
  if (startWeek == null) {
    // Imported leagues: the original backward-compatibility copy.
    nextSettings.playoffStartWeek = adjustment.newPlayoffStartWeek
  } else {
    // Native: the start week belongs to the quick field. Re-assert the chosen week on this copy
    // (older saves left a sport-default week here); with no chosen week, leave it unset.
    const chosen = readChosenPlayoffStartWeek(league)
    if (chosen != null) nextSettings.playoffStartWeek = chosen
  }
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: nextSettings as Prisma.InputJsonValue },
  })

  return { ok: true, adjustment }
}
