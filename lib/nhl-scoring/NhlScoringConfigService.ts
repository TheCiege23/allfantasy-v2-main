/**
 * [NEW] lib/nhl-scoring/NhlScoringConfigService.ts
 * Read/write NHL scoring configuration from League.settings JSON.
 */

import { prisma } from '@/lib/prisma'
import { getNhlScoringPreset, detectNhlPresetMatch, buildFullNhlScoringConfig, type NhlScoringPresetKey, type NhlScoringSource } from './NhlScoringPresets'
import { NHL_UNAVAILABLE_SCORING_KEYS } from './NhlScoringCategories'
import { NHL_GATED_ENGINE_KEY_MAP, NHL_SCORING_ENGINE_VERSION, nhlStoreScoresGatedKeys } from './nhlScoringEngineContract'

const PREFIX = 'nhl_scoring_'

export interface LeagueNhlScoringConfig {
  presetKey: NhlScoringPresetKey
  presetLabel: string
  source: NhlScoringSource
  rules: Record<string, number>
  matchesPreset: boolean
  premiumFeaturesUsed: boolean
  lastUpdatedAt: string | null
  lastUpdatedBy: string | null
  warningFlags: string[]
}

export async function getLeagueNhlScoringConfig(leagueId: string): Promise<LeagueNhlScoringConfig> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, sport: true } })
  if (!league || league.sport !== 'NHL') {
    const af = getNhlScoringPreset('af_default')
    return { presetKey: 'af_default', presetLabel: af.label, source: 'AF_DEFAULT', rules: buildFullNhlScoringConfig('af_default'), matchesPreset: true, premiumFeaturesUsed: false, lastUpdatedAt: null, lastUpdatedBy: null, warningFlags: [] }
  }
  const settings = (league.settings as Record<string, unknown>) ?? {}
  const raw = settings[`${PREFIX}config`] as Record<string, unknown> | undefined
  if (!raw) {
    const af = getNhlScoringPreset('af_default')
    return { presetKey: 'af_default', presetLabel: af.label, source: 'AF_DEFAULT', rules: buildFullNhlScoringConfig('af_default'), matchesPreset: true, premiumFeaturesUsed: false, lastUpdatedAt: null, lastUpdatedBy: null, warningFlags: [] }
  }
  const storedRules = (raw.rules as Record<string, number>) ?? buildFullNhlScoringConfig('af_default')
  const rules = displayedRules(raw, storedRules)
  const presetKey = (raw.presetKey as NhlScoringPresetKey) ?? 'af_default'
  const preset = getNhlScoringPreset(presetKey)
  return {
    presetKey, presetLabel: preset.label, source: (raw.source as NhlScoringSource) ?? 'AF_DEFAULT', rules,
    // Against what was saved: zeroing not-yet-active rows for display is not a change of preset.
    matchesPreset: detectNhlPresetMatch(storedRules) === presetKey, premiumFeaturesUsed: Boolean(raw.premiumFeaturesUsed),
    lastUpdatedAt: (raw.lastUpdatedAt as string) ?? null, lastUpdatedBy: (raw.lastUpdatedBy as string) ?? null,
    warningFlags: Array.isArray(raw.warningFlags) ? raw.warningFlags as string[] : [],
  }
}

/**
 * The rules as they actually score, which is what the panel must show.
 *
 * 🛑 THE PANEL USED TO SHOW VALUES THE ENGINE IGNORED. A row the feed cannot supply is always 0, and
 * a row wired after this store was last saved by a person (`NHL_GATED_ENGINE_KEY_MAP`) is 0 until a
 * commissioner saves again — so an existing league's scores do not move without anyone choosing it,
 * and the screen says exactly that instead of showing a stored value that is not applied.
 */
function displayedRules(raw: Record<string, unknown>, rules: Record<string, number>): Record<string, number> {
  const gatedOn = nhlStoreScoresGatedKeys(raw)
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(rules)) {
    out[key] = NHL_UNAVAILABLE_SCORING_KEYS.has(key) || (!gatedOn && key in NHL_GATED_ENGINE_KEY_MAP) ? 0 : value
  }
  return out
}

export async function saveLeagueNhlScoringConfig(leagueId: string, config: { presetKey: NhlScoringPresetKey; rules: Record<string, number>; source?: NhlScoringSource; userId?: string; premiumFeaturesUsed?: boolean }): Promise<void> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const currentSettings = (league?.settings as Record<string, unknown>) ?? {}
  const preset = getNhlScoringPreset(config.presetKey)
  const warningFlags: string[] = []; if (preset.warning) warningFlags.push('external_preset')
  await prisma.league.update({ where: { id: leagueId }, data: { settings: { ...currentSettings, [`${PREFIX}config`]: { presetKey: config.presetKey, source: config.source ?? (config.presetKey === 'af_default' ? 'AF_DEFAULT' : config.presetKey === 'custom' ? 'CUSTOM' : 'PLATFORM_PRESET'), rules: config.rules, matchesPreset: detectNhlPresetMatch(config.rules) === config.presetKey, premiumFeaturesUsed: config.premiumFeaturesUsed ?? false, lastUpdatedAt: new Date().toISOString(), lastUpdatedBy: config.userId ?? null, warningFlags,
    // Only a person's save opts the league into the newly wired rows; the create-time seed does not.
    ...(config.userId ? { engineVersion: NHL_SCORING_ENGINE_VERSION } : {}) } } } })
}

export async function applyDefaultNhlScoringOnCreate(leagueId: string): Promise<void> {
  await saveLeagueNhlScoringConfig(leagueId, { presetKey: 'af_default', rules: buildFullNhlScoringConfig('af_default'), source: 'AF_DEFAULT' })
}
