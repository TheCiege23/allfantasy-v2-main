/**
 * [NEW] lib/nfl-scoring/NflScoringConfigService.ts
 * Read/write NFL scoring configuration from League.settings JSON.
 */

import { prisma } from '@/lib/prisma'
import { getNflScoringPreset, detectNflPresetMatch, buildFullNflScoringConfig, type NflScoringPresetKey, type NflScoringSource } from './NflScoringPresets'

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
  await prisma.league.update({ where: { id: leagueId }, data: { settings: { ...currentSettings, [`${PREFIX}config`]: { presetKey: config.presetKey, source: config.source ?? (config.presetKey === 'af_default' ? 'AF_DEFAULT' : config.presetKey === 'custom' ? 'CUSTOM' : 'PLATFORM_PRESET'), rules: config.rules, matchesPreset: detectNflPresetMatch(config.rules) === config.presetKey, premiumFeaturesUsed: config.premiumFeaturesUsed ?? false, lastUpdatedAt: new Date().toISOString(), lastUpdatedBy: config.userId ?? null, warningFlags } } } })
}

/**
 * Seed the league's scoring store at create. `presetKey` must follow the preset the manager
 * picked — this store is what the live scorer reads, so seeding `af_default` regardless turned
 * every Full PPR and Standard league into a half-PPR one.
 */
export async function applyDefaultNflScoringOnCreate(
  leagueId: string,
  presetKey: NflScoringPresetKey = 'af_default',
): Promise<void> {
  await saveLeagueNflScoringConfig(leagueId, { presetKey, rules: buildFullNflScoringConfig(presetKey), source: 'AF_DEFAULT' })
}
