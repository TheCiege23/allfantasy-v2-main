/**
 * Preset rules engine — deterministic merge of format-engine resolution + canonical snapshot.
 * No AI. Same inputs + same ENGINE_VERSION ⇒ same presetKey (via buildPresetKey).
 */

import type { LeagueSport } from '@prisma/client'
import { buildPresetKey, SETTINGS_SNAPSHOT_VERSION, type SettingsSnapshot } from '@/lib/league-contract/types'
import { buildSettingsPreview } from '@/lib/league-defaults-orchestrator/LeagueSettingsPreviewBuilder'
import {
  resolveLeagueFormat,
  type LeagueFormatId,
  type LeagueFormatResolution,
} from '@/lib/league/format-engine'
import { normalizeToSupportedSport, supportsIdpLeagueSport } from '@/lib/sport-scope'
import { normalizeConceptToFormat, type NormalizedConcept } from '@/lib/league-creation/canonical/normalizeConcept'
import type { DerivedLeagueFlags, PresetEngineOutput } from '@/lib/league-creation/canonical/types'
import { buildRedraftSettingsSnapshot } from '@/lib/league-concepts/redraftDefaults'
import { buildDailyRedraftSettingsSnapshot } from '@/lib/league-concepts/dailySportRedraftDefaults'
import { buildDynastySettingsSnapshot, isDynastyEligibleSport } from '@/lib/league-concepts/dynastyDefaults'
import { buildBestBallSettingsSnapshot, isBestBallEligibleSport } from '@/lib/league-concepts/bestBallDefaults'
import { buildKeeperSettingsSnapshot } from '@/lib/league-concepts/keeperDefaults'
import { buildGuillotineSettingsSnapshot, isGuillotineEligibleSport } from '@/lib/league-concepts/guillotineDefaults'
import { buildTournamentSettingsSnapshot, isTournamentEligibleSport } from '@/lib/league-concepts/tournamentDefaults'
import { buildSurvivorSettingsSnapshot, isSurvivorEligibleSport } from '@/lib/league-concepts/survivorDefaults'
import { buildDevySettingsSnapshot, isFootballDevyDefaultsSport } from '@/lib/league-concepts/devyDefaults'

export const PRESET_ENGINE_VERSION = '1'

export interface RunPresetEngineInput {
  concept: string
  sport: LeagueSport | string
  teamCount: number
  draftType: string
  scoringPreset: string
  leagueName: string
  commissionerId: string
  conceptSetup?: Record<string, unknown> | null
}

function variantForFormat(formatId: LeagueFormatId): string | null {
  if (formatId === 'devy') return 'devy_dynasty'
  if (formatId === 'c2c') return 'merged_devy_c2c'
  return null
}

function rosterModeForFormat(
  formatId: LeagueFormatId
): 'redraft' | 'dynasty' | 'keeper' | undefined {
  if (formatId === 'dynasty' || formatId === 'devy' || formatId === 'c2c') return 'dynasty'
  if (formatId === 'keeper') return 'keeper'
  return undefined
}

function inferModifiersFromInput(
  normalized: NormalizedConcept,
  scoringPreset: string
): string[] | null {
  const mods: string[] = []
  if (normalized.aliasTags.includes('idp')) mods.push('idp')
  if (/idp/i.test(scoringPreset)) mods.push('idp')
  if (/superflex|super_flex/i.test(scoringPreset)) mods.push('superflex')
  return mods.length ? mods : null
}

function buildConceptRulesBlock(input: {
  formatId: LeagueFormatId
  aliasTags: string[]
  conceptSetup: Record<string, unknown> | null | undefined
  resolution: LeagueFormatResolution
}): Record<string, unknown> {
  const { formatId, aliasTags, conceptSetup, resolution } = input
  return {
    concept: formatId,
    version: 1,
    aliasTags,
    formatModifiers: resolution.modifiers,
    extensions: {
      ...(conceptSetup && typeof conceptSetup === 'object' ? conceptSetup : {}),
    },
  }
}

function deriveFlags(formatId: LeagueFormatId, resolution: LeagueFormatResolution): DerivedLeagueFlags {
  const waiverMode = String(
    (resolution.waiverDefaults as { waiver_type?: string })?.waiver_type ?? ''
  ).toLowerCase()
  const usesFAAB = waiverMode.includes('faab') || waiverMode === 'faab'
  const usesAuction =
    resolution.draftType === 'auction' ||
    String(resolution.draftType).includes('auction')

  return {
    isDynasty: formatId === 'dynasty' || formatId === 'devy' || formatId === 'c2c',
    isKeeper: formatId === 'keeper',
    isBestBall: formatId === 'best_ball',
    isDevy: formatId === 'devy',
    isC2C: formatId === 'c2c',
    hasTaxi: resolution.modifiers.includes('taxi'),
    hasDevy: formatId === 'devy' || resolution.modifiers.includes('devy'),
    hasPlayoffs: formatId !== 'guillotine',
    usesFAAB,
    usesAuction,
    usesElimination: formatId === 'guillotine' || formatId === 'survivor' || formatId === 'zombie',
    usesSpecialBracket: formatId === 'tournament',
  }
}

/**
 * Main entry — `resolvePreset` equivalent for the Create League pipeline.
 */
export function runPresetEngine(input: RunPresetEngineInput): PresetEngineOutput {
  const normalizedConcept = normalizeConceptToFormat(input.concept)
  if (!normalizedConcept) {
    throw new Error('INVALID_CONCEPT')
  }

  const { formatId, aliasTags } = normalizedConcept
  const sport = normalizeToSupportedSport(input.sport)
  const requestedModifiers = inferModifiersFromInput(normalizedConcept, input.scoringPreset)

  const leagueVariant = aliasTags.includes('idp') && supportsIdpLeagueSport(sport) ? 'IDP' : null

  const resolution = resolveLeagueFormat({
    sport,
    leagueType: formatId,
    draftType: input.draftType,
    leagueVariant,
    requestedModifiers,
  })

  const rm = rosterModeForFormat(formatId)
  const legacy = buildSettingsPreview(sport, variantForFormat(formatId), {
    roster_mode: rm,
    superflex: resolution.modifiers.includes('superflex'),
    extra: {
      default_team_count: input.teamCount,
      scoring_preset_id: input.scoringPreset,
    },
  })
  // Football redraft (NFL/NCAAF) or the daily-sport redraft preset (NBA/NHL/MLB); null for others.
  const redraftSnapshot =
    (formatId === 'redraft' || formatId === 'pirate')
      ? buildRedraftSettingsSnapshot({
          sport,
          draftType: input.draftType,
          scoringPresetId: input.scoringPreset,
          teamCount: input.teamCount,
        }) ??
        buildDailyRedraftSettingsSnapshot({
          sport,
          draftType: input.draftType,
          scoringPresetId: input.scoringPreset,
          teamCount: input.teamCount,
        })
      : null
  const keeperSnapshot =
    formatId === 'keeper'
      ? buildKeeperSettingsSnapshot({
          sport,
          draftType: input.draftType,
          scoringPresetId: input.scoringPreset,
          teamCount: input.teamCount,
        })
      : null

  const dynastySnapshot =
    formatId === 'dynasty' && isDynastyEligibleSport(sport)
      ? buildDynastySettingsSnapshot({
          sport,
          draftType: input.draftType,
          scoringPresetId: input.scoringPreset,
          teamCount: input.teamCount,
        })
      : null

  const bestBallSnapshot =
    formatId === 'best_ball' && isBestBallEligibleSport(sport)
      ? buildBestBallSettingsSnapshot({
          sport,
          draftType: input.draftType,
          scoringPresetId: input.scoringPreset,
          teamCount: input.teamCount,
        })
      : null
  const devySnapshot =
    formatId === 'devy' && isFootballDevyDefaultsSport(sport)
      ? buildDevySettingsSnapshot({
          sport,
          draftType: input.draftType,
          scoringPresetId: input.scoringPreset,
          teamCount: input.teamCount,
        })
      : null

  const derivedFlags = deriveFlags(formatId, resolution)
  const conceptRules = buildConceptRulesBlock({
    formatId,
    aliasTags,
    conceptSetup: input.conceptSetup ?? null,
    resolution,
  })
  const guillotineSnapshot =
    formatId === 'guillotine' && isGuillotineEligibleSport(sport)
      ? buildGuillotineSettingsSnapshot({
          sport,
          draftType: input.draftType,
          scoringPresetId: input.scoringPreset,
          teamCount: input.teamCount,
        })
      : null

  const tournamentSnapshot =
    formatId === 'tournament' && isTournamentEligibleSport(sport)
      ? buildTournamentSettingsSnapshot({
          sport,
          draftType: input.draftType,
          scoringPresetId: input.scoringPreset,
          teamCount: input.teamCount,
        })
      : null

  const survivorSnapshot =
    formatId === 'survivor' && isSurvivorEligibleSport(sport)
      ? buildSurvivorSettingsSnapshot({
          sport,
          draftType: input.draftType,
          scoringPresetId: input.scoringPreset,
          teamCount: input.teamCount,
        })
      : null

  const canonicalSnapshot =
    redraftSnapshot ??
    dynastySnapshot ??
    bestBallSnapshot ??
    keeperSnapshot ??
    guillotineSnapshot ??
    tournamentSnapshot ??
    survivorSnapshot ??
    devySnapshot ??
    null

  const settingsSnapshot: SettingsSnapshot = {
    snapshotVersion: SETTINGS_SNAPSHOT_VERSION,
    ...(legacy as Record<string, unknown>),
    ...(canonicalSnapshot ?? {}),
    rosterSettings: (canonicalSnapshot?.rosterSettings ??
      resolution.roster) as unknown as SettingsSnapshot['rosterSettings'],
    scoringSettings: (canonicalSnapshot?.scoringSettings ?? {
      ...(resolution.scoring as Record<string, unknown>),
      preset: input.scoringPreset,
      scoringTemplateId: input.scoringPreset,
      format: (resolution.scoring as { format?: string })?.format,
    }) as SettingsSnapshot['scoringSettings'],
    draftSettings: (canonicalSnapshot?.draftSettings ?? {
      draftType: resolution.draftType,
      rounds: resolution.draftDefaults.rounds_default,
      timerSeconds: resolution.draftDefaults.timer_seconds_default ?? undefined,
    }) as SettingsSnapshot['draftSettings'],
    waiverSettings: (canonicalSnapshot?.waiverSettings ??
      resolution.waiverDefaults) as unknown as SettingsSnapshot['waiverSettings'],
    playoffSettings: resolution.playoffDefaults as unknown as SettingsSnapshot['playoffSettings'],
    commissionerSettings: {},
    mediaSettings: {
      introVideo: { key: formatId },
    },
    visualTheme: {
      accent: formatId,
    },
    conceptRules,
    conceptSetup: input.conceptSetup ?? undefined,
    metadata: {
      createdFromFlow: 'post_api_leagues_v1',
      presetEngineVersion: PRESET_ENGINE_VERSION,
      commissionerId: input.commissionerId,
      derivedFlags,
    },
  }

  const presetKey = buildPresetKey({
    concept: formatId,
    sport,
    scoringPresetId: input.scoringPreset,
    draftType: String(resolution.draftType),
    teamCount: input.teamCount,
  })

  const warnings: PresetEngineOutput['warnings'] = []
  if (input.teamCount % 2 === 1 && formatId !== 'tournament' && formatId !== 'survivor') {
    warnings.push({
      path: 'teamCount',
      message: 'Odd team counts can complicate balanced divisions.',
      code: 'ODD_TEAM_COUNT',
    })
  }

  return {
    presetKey,
    settingsSnapshot,
    conceptRules,
    visualTheme: (settingsSnapshot.visualTheme ?? {}) as Record<string, unknown>,
    mediaSettings: (settingsSnapshot.mediaSettings ?? {}) as Record<string, unknown>,
    derivedFlags,
    warnings,
    formatResolution: resolution,
    leagueFormatId: formatId,
  }
}
