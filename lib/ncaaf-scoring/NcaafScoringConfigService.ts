/**
 * [NEW] lib/ncaaf-scoring/NcaafScoringConfigService.ts
 */
import { prisma } from '@/lib/prisma'
import { getNcaafScoringPreset, detectNcaafPresetMatch, buildFullNcaafScoringConfig, type NcaafScoringPresetKey, type NcaafScoringSource } from './NcaafScoringPresets'
import { receptionPointsForSportConfigPreset, storeSavedByPerson } from '@/lib/redraft/uiScoringStoreBridge'

const PREFIX = 'ncaaf_scoring_'

export interface LeagueNcaafScoringConfig {
  presetKey: NcaafScoringPresetKey; presetLabel: string; source: NcaafScoringSource
  rules: Record<string, number>; matchesPreset: boolean; premiumFeaturesUsed: boolean
  lastUpdatedAt: string | null; lastUpdatedBy: string | null; warningFlags: string[]
}

export async function getLeagueNcaafScoringConfig(leagueId: string): Promise<LeagueNcaafScoringConfig> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, sport: true } })
  if (!league || league.sport !== 'NCAAF') {
    const af = getNcaafScoringPreset('af_default')
    return { presetKey: 'af_default', presetLabel: af.label, source: 'AF_DEFAULT', rules: buildFullNcaafScoringConfig('af_default'), matchesPreset: true, premiumFeaturesUsed: false, lastUpdatedAt: null, lastUpdatedBy: null, warningFlags: [] }
  }
  const s = (league.settings as Record<string, unknown>) ?? {}
  const raw = s[`${PREFIX}config`] as Record<string, unknown> | undefined
  // Until a person saves this panel, reception is whatever the manager picked at create — the same
  // rule the scorer applies (uiScoringStoreBridge), so the panel shows what actually scores.
  const pickedReception = storeSavedByPerson(raw) ? null : receptionPointsForSportConfigPreset(s)
  if (!raw) {
    const af = getNcaafScoringPreset('af_default')
    const rules = buildFullNcaafScoringConfig('af_default')
    if (pickedReception != null) rules.reception = pickedReception
    return { presetKey: 'af_default', presetLabel: af.label, source: 'AF_DEFAULT', rules, matchesPreset: detectNcaafPresetMatch(rules) === 'af_default', premiumFeaturesUsed: false, lastUpdatedAt: null, lastUpdatedBy: null, warningFlags: [] }
  }
  const rules = { ...((raw.rules as Record<string, number>) ?? buildFullNcaafScoringConfig('af_default')) }
  if (pickedReception != null) rules.reception = pickedReception
  const pk = (raw.presetKey as NcaafScoringPresetKey) ?? 'af_default'
  return { presetKey: pk, presetLabel: getNcaafScoringPreset(pk).label, source: (raw.source as NcaafScoringSource) ?? 'AF_DEFAULT', rules, matchesPreset: detectNcaafPresetMatch(rules) === pk, premiumFeaturesUsed: Boolean(raw.premiumFeaturesUsed), lastUpdatedAt: (raw.lastUpdatedAt as string) ?? null, lastUpdatedBy: (raw.lastUpdatedBy as string) ?? null, warningFlags: Array.isArray(raw.warningFlags) ? raw.warningFlags as string[] : [] }
}

export async function saveLeagueNcaafScoringConfig(leagueId: string, config: { presetKey: NcaafScoringPresetKey; rules: Record<string, number>; source?: NcaafScoringSource; userId?: string; premiumFeaturesUsed?: boolean }): Promise<void> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const cs = (league?.settings as Record<string, unknown>) ?? {}
  const p = getNcaafScoringPreset(config.presetKey); const wf: string[] = []; if (p.warning) wf.push('external_preset')
  await prisma.league.update({ where: { id: leagueId }, data: { settings: { ...cs, [`${PREFIX}config`]: { presetKey: config.presetKey, source: config.source ?? (config.presetKey === 'af_default' ? 'AF_DEFAULT' : config.presetKey === 'custom' ? 'CUSTOM' : 'PLATFORM_PRESET'), rules: config.rules, matchesPreset: detectNcaafPresetMatch(config.rules) === config.presetKey, premiumFeaturesUsed: config.premiumFeaturesUsed ?? false, lastUpdatedAt: new Date().toISOString(), lastUpdatedBy: config.userId ?? null, warningFlags: wf } } } })
}

/**
 * Seed a new league's NCAAF scoring. `receptionPoints` is the manager's pick at create (PPR 1,
 * half 0.5, standard 0); without it every NCAAF league was seeded full PPR whatever was chosen.
 */
export async function applyDefaultNcaafScoringOnCreate(leagueId: string, receptionPoints?: number | null): Promise<void> {
  const rules = buildFullNcaafScoringConfig('af_default')
  if (receptionPoints != null && Number.isFinite(receptionPoints)) rules.reception = receptionPoints
  await saveLeagueNcaafScoringConfig(leagueId, { presetKey: 'af_default', rules, source: 'AF_DEFAULT' })
}
