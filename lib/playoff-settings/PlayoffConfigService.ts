/**
 * [NEW] lib/playoff-settings/PlayoffConfigService.ts
 * Read/write playoff configuration from League.settings JSON.
 * Validates premium access before saving premium stages.
 */

import * as prismaJson from '@/lib/prisma-json'
import { prisma } from '@/lib/prisma'
import type { PlayoffConfig } from './types'
import { EMPTY_PLAYOFF_CONFIG } from './types'
import { hasPremiumStages, validateStageIds } from './PlayoffStageRegistry'
import { calculateScheduleAdjustment } from './PlayoffScheduleRecalculator'

const PREFIX = 'playoff_config_'

/** Read playoff config from a league's settings JSON. */
export async function getPlayoffConfig(leagueId: string): Promise<PlayoffConfig> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true, sport: true },
  })
  if (!league) return { ...EMPTY_PLAYOFF_CONFIG }

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const raw = settings[`${PREFIX}data`] as Record<string, unknown> | undefined

  if (!raw) {
    return { ...EMPTY_PLAYOFF_CONFIG, sport: league.sport }
  }

  return {
    sport: (raw.sport as string) ?? league.sport,
    includedStages: Array.isArray(raw.includedStages) ? raw.includedStages as string[] : [],
    startMode: (raw.startMode as string) ?? 'default',
    regularSeasonShiftApplied: Boolean(raw.regularSeasonShiftApplied),
    adjustedRegularSeasonEndWeek: typeof raw.adjustedRegularSeasonEndWeek === 'number' ? raw.adjustedRegularSeasonEndWeek : null,
    adjustedPlayoffStartWeek: typeof raw.adjustedPlayoffStartWeek === 'number' ? raw.adjustedPlayoffStartWeek : null,
    adjustedPlayoffWeeks: typeof raw.adjustedPlayoffWeeks === 'number' ? raw.adjustedPlayoffWeeks : null,
    premiumFeaturesUsed: Boolean(raw.premiumFeaturesUsed),
    lastUpdatedAt: (raw.lastUpdatedAt as string) ?? null,
  }
}

/** Save playoff config. Validates stage IDs and premium access. */
export async function savePlayoffConfig(
  leagueId: string,
  config: Partial<PlayoffConfig>,
  options?: { isPremium?: boolean }
): Promise<{ ok: boolean; error?: string; adjustment?: ReturnType<typeof calculateScheduleAdjustment> }> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true, sport: true, leagueVariant: true },
  })
  if (!league) return { ok: false, error: 'League not found' }

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
  const adjustment = calculateScheduleAdjustment(sport, currentConfig, includedStages, league.leagueVariant)

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
  await prisma.league.update({
    where: { id: leagueId },
    data: {
      settings: prismaJson.toPrismaJsonInput({
        ...currentSettings,
        [`${PREFIX}data`]: newConfig,
        // Also update the standard playoff fields for backward compatibility
        playoffStartWeek: adjustment.newPlayoffStartWeek,
      }),
    },
  })

  return { ok: true, adjustment }
}
