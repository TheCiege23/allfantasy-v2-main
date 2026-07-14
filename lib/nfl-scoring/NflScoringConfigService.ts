/**
 * [NEW] lib/nfl-scoring/NflScoringConfigService.ts
 * Read/write NFL scoring configuration from League.settings JSON.
 */

import { prisma } from '@/lib/prisma'
import { getNflScoringPreset, detectNflPresetMatch, buildFullNflScoringConfig, type NflScoringPresetKey, type NflScoringSource } from './NflScoringPresets'
import { bridgeUiRulesToEngineCategoryPoints } from './scoringKeyBridge'

const PREFIX = 'nfl_scoring_'

export interface LeagueNflScoringConfig {
  presetKey: NflScoringPresetKey
  presetLabel: string
  source: NflScoringSource
  rules: Record<string, number>
  matchesPreset: boolean
  premiumFeaturesUsed: boolean
  lastUpdatedAt: string | null
  lastUpdatedBy: string | null
  warningFlags: string[]
}

export async function getLeagueNflScoringConfig(leagueId: string): Promise<LeagueNflScoringConfig> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, sport: true } })
  if (!league || league.sport !== 'NFL') {
    const af = getNflScoringPreset('af_default')
    return { presetKey: 'af_default', presetLabel: af.label, source: 'AF_DEFAULT', rules: buildFullNflScoringConfig('af_default'), matchesPreset: true, premiumFeaturesUsed: false, lastUpdatedAt: null, lastUpdatedBy: null, warningFlags: [] }
  }
  const settings = (league.settings as Record<string, unknown>) ?? {}
  const raw = settings[`${PREFIX}config`] as Record<string, unknown> | undefined
  if (!raw) {
    const af = getNflScoringPreset('af_default')
    return { presetKey: 'af_default', presetLabel: af.label, source: 'AF_DEFAULT', rules: buildFullNflScoringConfig('af_default'), matchesPreset: true, premiumFeaturesUsed: false, lastUpdatedAt: null, lastUpdatedBy: null, warningFlags: [] }
  }
  const rules = (raw.rules as Record<string, number>) ?? buildFullNflScoringConfig('af_default')
  const presetKey = (raw.presetKey as NflScoringPresetKey) ?? 'af_default'
  return {
    presetKey, presetLabel: getNflScoringPreset(presetKey).label,
    source: (raw.source as NflScoringSource) ?? 'AF_DEFAULT', rules,
    matchesPreset: detectNflPresetMatch(rules) === presetKey,
    premiumFeaturesUsed: Boolean(raw.premiumFeaturesUsed),
    lastUpdatedAt: (raw.lastUpdatedAt as string) ?? null, lastUpdatedBy: (raw.lastUpdatedBy as string) ?? null,
    warningFlags: Array.isArray(raw.warningFlags) ? raw.warningFlags as string[] : [],
  }
}

export async function saveLeagueNflScoringConfig(leagueId: string, config: { presetKey: NflScoringPresetKey; rules: Record<string, number>; source?: NflScoringSource; userId?: string; premiumFeaturesUsed?: boolean }): Promise<void> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const currentSettings = (league?.settings as Record<string, unknown>) ?? {}
  const preset = getNflScoringPreset(config.presetKey)
  const warningFlags: string[] = []; if (preset.warning) warningFlags.push('external_preset')

  // R1: also write the CANONICAL engine store (`sportConfig.categoryPoints`) by
  // bridging the UI rule keys → engine keys, so commissioner scoring edits made in
  // the panel actually change scored points. `nfl_scoring_config` is preserved for
  // the panel's own GET (backwards compatibility).
  const currentSportConfig = (currentSettings.sportConfig as Record<string, unknown> | undefined) ?? {}
  const categoryPoints = bridgeUiRulesToEngineCategoryPoints(config.rules)

  await prisma.league.update({
    where: { id: leagueId },
    data: {
      settings: {
        ...currentSettings,
        sportConfig: { ...currentSportConfig, categoryPoints },
        [`${PREFIX}config`]: {
          presetKey: config.presetKey,
          source: config.source ?? (config.presetKey === 'af_default' ? 'AF_DEFAULT' : config.presetKey === 'custom' ? 'CUSTOM' : 'PLATFORM_PRESET'),
          rules: config.rules,
          matchesPreset: detectNflPresetMatch(config.rules) === config.presetKey,
          premiumFeaturesUsed: config.premiumFeaturesUsed ?? false,
          lastUpdatedAt: new Date().toISOString(),
          lastUpdatedBy: config.userId ?? null,
          warningFlags,
        },
      },
    },
  })
}

export async function applyDefaultNflScoringOnCreate(leagueId: string): Promise<void> {
  await saveLeagueNflScoringConfig(leagueId, { presetKey: 'af_default', rules: buildFullNflScoringConfig('af_default'), source: 'AF_DEFAULT' })
}
