/**
 * [NEW] lib/mlb-scoring/MlbScoringConfigService.ts
 * Read/write MLB scoring configuration from League.settings JSON.
 */

import { prisma } from '@/lib/prisma'
import { bridgeSportUiScoringStore } from '@/lib/redraft/uiScoringStoreBridge'
import { importedMlbScoring } from '@/lib/league-creation/canonical/importedMlbScoring'
import type { Prisma } from '@prisma/client'
import {
  getMlbScoringPreset,
  detectMlbPresetMatch,
  buildFullMlbScoringConfig,
  type MlbScoringPresetKey,
  type MlbScoringSource,
} from './MlbScoringPresets'

const PREFIX = 'mlb_scoring_'

export interface LeagueMlbScoringConfig {
  presetKey: MlbScoringPresetKey
  presetLabel: string
  source: MlbScoringSource
  rules: Record<string, number>
  matchesPreset: boolean
  premiumFeaturesUsed: boolean
  lastUpdatedAt: string | null
  lastUpdatedBy: string | null
  warningFlags: string[]
}

export async function getLeagueMlbScoringConfig(leagueId: string): Promise<LeagueMlbScoringConfig> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, sport: true } })
  if (!league || league.sport !== 'MLB') {
    const af = getMlbScoringPreset('af_default')
    return { presetKey: 'af_default', presetLabel: af.label, source: 'AF_DEFAULT', rules: buildFullMlbScoringConfig('af_default'), matchesPreset: true, premiumFeaturesUsed: false, lastUpdatedAt: null, lastUpdatedBy: null, warningFlags: [] }
  }
  const settings = (league.settings as Record<string, unknown>) ?? {}
  const raw = settings[`${PREFIX}config`] as Record<string, unknown> | undefined
  if (!raw) {
    const af = getMlbScoringPreset('af_default')
    return { presetKey: 'af_default', presetLabel: af.label, source: 'AF_DEFAULT', rules: buildFullMlbScoringConfig('af_default'), matchesPreset: true, premiumFeaturesUsed: false, lastUpdatedAt: null, lastUpdatedBy: null, warningFlags: [] }
  }
  const rules = (raw.rules as Record<string, number>) ?? buildFullMlbScoringConfig('af_default')
  const presetKey = (raw.presetKey as MlbScoringPresetKey) ?? 'af_default'
  const preset = getMlbScoringPreset(presetKey)
  return {
    presetKey, presetLabel: preset.label,
    source: (raw.source as MlbScoringSource) ?? 'AF_DEFAULT', rules,
    matchesPreset: detectMlbPresetMatch(rules) === presetKey,
    premiumFeaturesUsed: Boolean(raw.premiumFeaturesUsed),
    lastUpdatedAt: (raw.lastUpdatedAt as string) ?? null, lastUpdatedBy: (raw.lastUpdatedBy as string) ?? null,
    warningFlags: Array.isArray(raw.warningFlags) ? raw.warningFlags as string[] : [],
  }
}

export async function saveLeagueMlbScoringConfig(leagueId: string, config: { presetKey: MlbScoringPresetKey; rules: Record<string, number>; source?: MlbScoringSource; userId?: string; premiumFeaturesUsed?: boolean }): Promise<void> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const currentSettings = (league?.settings as Record<string, unknown>) ?? {}
  const preset = getMlbScoringPreset(config.presetKey)
  const warningFlags: string[] = []
  if (preset.warning) warningFlags.push('external_preset')
  const nextSettings = { ...currentSettings, [`${PREFIX}config`]: { presetKey: config.presetKey, source: config.source ?? (config.presetKey === 'af_default' ? 'AF_DEFAULT' : config.presetKey === 'custom' ? 'CUSTOM' : 'PLATFORM_PRESET'), rules: config.rules, matchesPreset: detectMlbPresetMatch(config.rules) === config.presetKey, premiumFeaturesUsed: config.premiumFeaturesUsed ?? false, lastUpdatedAt: new Date().toISOString(), lastUpdatedBy: config.userId ?? null, warningFlags } }
  if (currentSettings.importCarryover) {
    const points = bridgeSportUiScoringStore('MLB', nextSettings) ?? {}
    const resolved = importedMlbScoring({ scoringSettings: { format: 'points', source: 'allfantasy', rules: points } })
    const sportConfig = currentSettings.sportConfig && typeof currentSettings.sportConfig === 'object' ? currentSettings.sportConfig as Record<string, unknown> : {}
    await prisma.$transaction(async tx => {
      await tx.league.update({ where: { id: leagueId }, data: { settings: { ...nextSettings, scoringSettings: resolved.scoringSettings, sportConfig: { ...sportConfig, categoryPoints: resolved.categoryPoints } } as Prisma.InputJsonValue } })
      await tx.leagueScoringOverride.deleteMany({ where: { leagueId } })
      await tx.leagueScoringOverride.createMany({ data: Object.entries(resolved.templatePoints).map(([statKey, pointsValue]) => ({ leagueId, statKey, pointsValue, enabled: true })) })
    })
    return
  }
  await prisma.league.update({ where: { id: leagueId }, data: { settings: nextSettings as Prisma.InputJsonValue } })
}

export async function applyDefaultMlbScoringOnCreate(leagueId: string): Promise<void> {
  await saveLeagueMlbScoringConfig(leagueId, { presetKey: 'af_default', rules: buildFullMlbScoringConfig('af_default'), source: 'AF_DEFAULT' })
}
