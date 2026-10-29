/**
 * Resolves the best-matching concept preset for a given league creation request.
 * Used by the league create route to gate unsupported formats and merge preset
 * settings into the league settings blob.
 */

import { CONCEPT_PRESET_CATALOG, type ConceptPresetSeed } from './conceptPresetCatalog'
import { normalizeConceptToFormat } from '@/lib/league-creation/canonical/normalizeConcept'
import type { LeagueFormatId } from '@/lib/league/format-engine'
import {
  buildRedraftSettingsSnapshot,
  isFootballRedraftDefaultsSport,
  normalizeRedraftSettingsSnapshot,
} from '@/lib/league-concepts/redraftDefaults'
import {
  buildDailyRedraftSettingsSnapshot,
  isDailyRedraftDefaultsSport,
  normalizeDailyRedraftSettingsSnapshot,
} from '@/lib/league-concepts/dailySportRedraftDefaults'
import {
  buildDynastySettingsSnapshot,
  isDynastyEligibleSport,
  normalizeDynastySettingsSnapshot,
} from '@/lib/league-concepts/dynastyDefaults'
import {
  buildBestBallSettingsSnapshot,
  isBestBallEligibleSport,
  normalizeBestBallSettingsSnapshot,
} from '@/lib/league-concepts/bestBallDefaults'
import {
  buildKeeperSettingsSnapshot,
  isFootballKeeperDefaultsSport,
  normalizeKeeperSettingsSnapshot,
} from '@/lib/league-concepts/keeperDefaults'
import {
  buildGuillotineSettingsSnapshot,
  isGuillotineEligibleSport,
  normalizeGuillotineSettingsSnapshot,
} from '@/lib/league-concepts/guillotineDefaults'
import {
  buildTournamentSettingsSnapshot,
  isTournamentEligibleSport,
  normalizeTournamentSettingsSnapshot,
} from '@/lib/league-concepts/tournamentDefaults'
import {
  buildSurvivorSettingsSnapshot,
  isSurvivorEligibleSport,
  normalizeSurvivorSettingsSnapshot,
} from '@/lib/league-concepts/survivorDefaults'
import {
  buildDevySettingsSnapshot,
  isFootballDevyDefaultsSport,
  normalizeDevySettingsSnapshot,
} from '@/lib/league-concepts/devyDefaults'
import {
  buildSalaryCapSettingsSnapshot,
  isSalaryCapEligibleSport,
  normalizeSalaryCapSettingsSnapshot,
} from '@/lib/league-concepts/salaryCapDefaults'
import {
  buildC2CSettingsSnapshot,
  isC2CEligibleSport,
  normalizeC2CSettingsSnapshot,
} from '@/lib/league-concepts/c2cDefaults'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConceptPresetResolutionOk = {
  ok: true
  preset: ConceptPresetSeed
  settingsSnapshot: Record<string, unknown>
  presetKey: string
}

export type ConceptPresetResolutionFail = {
  ok: false
  message: string
  code: string
  status: number
  requiredFeatureFlag?: string | null
  preset?: ConceptPresetSeed | null
}

export type ConceptPresetResolution = ConceptPresetResolutionOk | ConceptPresetResolutionFail

type ResolveOptions = {
  /** Allow admin-only / coming_soon presets (dev/staging only). */
  allowAdmin?: boolean
  /** Feature flags enabled for the requesting user. */
  enabledFeatureFlags?: string[] | null
  /** User-supplied overrides merged on top of the preset snapshot. */
  userOverrides?: Record<string, unknown> | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeFormat(raw: string | null | undefined): LeagueFormatId {
  if (!raw) return 'redraft'
  const result = normalizeConceptToFormat(raw)
  return (result?.formatId ?? 'redraft') as LeagueFormatId
}

function scorePreset(
  preset: ConceptPresetSeed,
  sport: string,
  format: LeagueFormatId,
  scoringPreset: string,
  draftType: string,
  modifiers: string[],
): number {
  if (preset.sport !== sport || preset.leagueType !== format) return -1
  let score = 0
  if (preset.scoringPreset === scoringPreset) score += 20
  if (preset.draftTypesAllowed.includes(draftType)) score += 10
  const presetMods = new Set(preset.metadata.modifiers ?? [])
  for (const m of modifiers) {
    if (presetMods.has(m)) score += 3
  }
  if (preset.isLaunchReady) score += 1
  return score
}

function buildSettingsSnapshot(preset: ConceptPresetSeed): Record<string, unknown> {
  const redraftSnapshot =
    preset.leagueType === 'redraft' && isFootballRedraftDefaultsSport(preset.sport)
      ? buildRedraftSettingsSnapshot({
          sport: preset.sport,
          draftType: preset.draftTypesAllowed[0] ?? 'snake',
          scoringPresetId: preset.scoringPreset,
          teamCount: preset.defaultTeamCount,
        })
      : preset.leagueType === 'redraft' && isDailyRedraftDefaultsSport(preset.sport)
        ? buildDailyRedraftSettingsSnapshot({
            sport: preset.sport,
            draftType: preset.draftTypesAllowed[0] ?? 'snake',
            scoringPresetId: preset.scoringPreset,
            teamCount: preset.defaultTeamCount,
          })
        : null
  const dynastySnapshot =
    preset.leagueType === 'dynasty' && isDynastyEligibleSport(preset.sport)
      ? buildDynastySettingsSnapshot({
          sport: preset.sport,
          draftType: preset.draftTypesAllowed[0] ?? 'snake',
          scoringPresetId: preset.scoringPreset,
          teamCount: preset.defaultTeamCount,
        })
      : null
  const bestBallSnapshot =
    preset.leagueType === 'best_ball' && isBestBallEligibleSport(preset.sport)
      ? buildBestBallSettingsSnapshot({
          sport: preset.sport,
          draftType: preset.draftTypesAllowed[0] ?? 'snake',
          scoringPresetId: preset.scoringPreset,
          teamCount: preset.defaultTeamCount,
        })
      : null
  const keeperSnapshot =
    preset.leagueType === 'keeper' && isFootballKeeperDefaultsSport(preset.sport)
      ? buildKeeperSettingsSnapshot({
          sport: preset.sport,
          draftType: preset.draftTypesAllowed[0] ?? 'snake',
          scoringPresetId: preset.scoringPreset,
          teamCount: preset.defaultTeamCount,
        })
      : null
  const guillotineSnapshot =
    preset.leagueType === 'guillotine' && isGuillotineEligibleSport(preset.sport)
      ? buildGuillotineSettingsSnapshot({
          sport: preset.sport,
          draftType: preset.draftTypesAllowed[0] ?? 'snake',
          scoringPresetId: preset.scoringPreset,
          teamCount: preset.defaultTeamCount,
        })
      : null
  const tournamentSnapshot =
    preset.leagueType === 'tournament' && isTournamentEligibleSport(preset.sport)
      ? buildTournamentSettingsSnapshot({
          sport: preset.sport,
          draftType: preset.draftTypesAllowed[0] ?? 'snake',
          scoringPresetId: preset.scoringPreset,
          teamCount: preset.defaultTeamCount,
        })
      : null
  const survivorSnapshot =
    preset.leagueType === 'survivor' && isSurvivorEligibleSport(preset.sport)
      ? buildSurvivorSettingsSnapshot({
          sport: preset.sport,
          draftType: preset.draftTypesAllowed[0] ?? 'snake',
          scoringPresetId: preset.scoringPreset,
          teamCount: preset.defaultTeamCount,
        })
      : null
  const devySnapshot =
    preset.leagueType === 'devy' && isFootballDevyDefaultsSport(preset.sport)
      ? buildDevySettingsSnapshot({
          sport: preset.sport,
          draftType: preset.draftTypesAllowed[0] ?? 'devy_snake',
          scoringPresetId: preset.scoringPreset,
          teamCount: preset.defaultTeamCount,
        })
      : null
  const salaryCapSnapshot =
    preset.leagueType === 'salary_cap' && isSalaryCapEligibleSport(preset.sport)
      ? buildSalaryCapSettingsSnapshot({
          sport: preset.sport,
          draftType: preset.draftTypesAllowed[0] ?? 'auction',
          scoringPresetId: preset.scoringPreset,
          teamCount: preset.defaultTeamCount,
        })
      : null
  const c2cSnapshot =
    preset.leagueType === 'c2c' && isC2CEligibleSport(preset.sport)
      ? buildC2CSettingsSnapshot({
          sport: preset.sport,
          draftType: preset.draftTypesAllowed[0] ?? 'c2c_snake',
          scoringPresetId: preset.scoringPreset,
          teamCount: preset.defaultTeamCount,
        })
      : null
  return {
    ...(redraftSnapshot ?? {}),
    ...(dynastySnapshot ?? {}),
    ...(bestBallSnapshot ?? {}),
    ...(keeperSnapshot ?? {}),
    ...(guillotineSnapshot ?? {}),
    ...(tournamentSnapshot ?? {}),
    ...(survivorSnapshot ?? {}),
    ...(devySnapshot ?? {}),
    ...(salaryCapSnapshot ?? {}),
    ...(c2cSnapshot ?? {}),
    conceptPresetKey: preset.presetKey,
    leagueType: preset.leagueType,
    sport: preset.sport,
    scoringPreset: preset.scoringPreset,
    requiredDataFeeds: preset.requiredDataFeeds,
    aiEnabledFeatures: preset.aiEnabledFeatures,
    roster: {
      rosterSlots: preset.rosterSlots,
      benchSlots: preset.benchSlots,
      irSlots: preset.irSlots,
      taxiSlots: preset.taxiSlots ?? null,
      collegeRosterSlots: preset.collegeRosterSlots ?? null,
    },
    idpRules: preset.idpRules ?? null,
    modifiers: preset.metadata.modifiers ?? [],
    readiness: preset.readiness,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function resolveConceptPreset(args: {
  sport: string
  leagueType: string | null | undefined
  scoringPreset: string | null | undefined
  draftType: string | null | undefined
  modifiers?: string[]
  options?: ResolveOptions
}): ConceptPresetResolution {
  const sport = String(args.sport ?? '').toUpperCase()
  const format = normalizeFormat(args.leagueType)
  const scoringPreset = String(args.scoringPreset ?? '').trim()
  const draftType = String(args.draftType ?? 'snake').toLowerCase()
  const modifiers = args.modifiers ?? []
  const opts = args.options ?? {}

  // Find best-scoring preset
  let best: { preset: ConceptPresetSeed; score: number } | null = null
  for (const preset of CONCEPT_PRESET_CATALOG) {
    const s = scorePreset(preset, sport as any, format, scoringPreset, draftType, modifiers)
    if (s < 0) continue
    if (!best || s > best.score) best = { preset, score: s }
  }

  if (!best) {
    // No preset registered — allow the create flow to proceed with format-engine defaults
    return {
      ok: true,
      preset: {
        presetKey: `af:v2|concept=${format}|sport=${sport}|scoring=${scoringPreset || 'default'}|draft=${draftType}`,
        sport: sport as any,
        leagueType: format,
        scoringPreset: scoringPreset || 'default',
        draftTypesAllowed: [draftType],
        defaultTeamCount: 12,
        isLaunchReady: true,
        readiness: 'launch_ready',
        visibility: 'public',
        requiredDataFeeds: [],
        aiEnabledFeatures: [],
        metadata: { modifiers },
      },
      settingsSnapshot: {
        conceptPresetKey: null,
        leagueType: format,
        sport,
        scoringPreset,
        requiredDataFeeds: [],
        aiEnabledFeatures: [],
        modifiers,
        readiness: 'launch_ready',
      },
      presetKey: `af:v2|concept=${format}|sport=${sport}|scoring=${scoringPreset || 'default'}|draft=${draftType}`,
    }
  }

  const { preset } = best

  // Gate admin-only and coming-soon presets
  if (preset.visibility === 'admin_only' && !opts.allowAdmin) {
    return {
      ok: false,
      message: 'This league format is not yet available.',
      code: 'CONCEPT_NOT_AVAILABLE',
      status: 403,
      preset,
    }
  }

  // Gate beta presets — require a feature flag or allowAdmin
  if (preset.visibility === 'beta_only') {
    const flagKey = `beta_${preset.leagueType}_${sport.toLowerCase()}`
    const hasBetaFlag =
      opts.allowAdmin ||
      (Array.isArray(opts.enabledFeatureFlags) && opts.enabledFeatureFlags.includes(flagKey))
    if (!hasBetaFlag) {
      return {
        ok: false,
        message: `${preset.leagueType.toUpperCase()} is in beta. Access requires the ${flagKey} feature flag.`,
        code: 'CONCEPT_REQUIRES_FEATURE_FLAG',
        status: 403,
        requiredFeatureFlag: flagKey,
        preset,
      }
    }
  }

  const base = buildSettingsSnapshot(preset)
  const snapshotBase: Record<string, unknown> = {
    ...base,
    ...(opts.userOverrides ?? {}),
  }
  const snapshot =
    preset.leagueType === 'redraft' && isFootballRedraftDefaultsSport(sport)
      ? normalizeRedraftSettingsSnapshot({
          sport,
          draftType,
          scoringPresetId: preset.scoringPreset,
          teamCount: preset.defaultTeamCount,
          settings: snapshotBase,
        })
      : preset.leagueType === 'redraft' && isDailyRedraftDefaultsSport(sport)
        ? normalizeDailyRedraftSettingsSnapshot({
            sport,
            draftType,
            scoringPresetId: preset.scoringPreset,
            teamCount: preset.defaultTeamCount,
            settings: snapshotBase,
          })
      : preset.leagueType === 'dynasty' && isDynastyEligibleSport(sport)
        ? normalizeDynastySettingsSnapshot({
            sport,
            draftType,
            scoringPresetId: preset.scoringPreset,
            teamCount: preset.defaultTeamCount,
            settings: snapshotBase,
          })
        : preset.leagueType === 'best_ball' && isBestBallEligibleSport(sport)
          ? normalizeBestBallSettingsSnapshot({
              sport,
              draftType,
              scoringPresetId: preset.scoringPreset,
              teamCount: preset.defaultTeamCount,
              settings: snapshotBase,
            })
          : preset.leagueType === 'keeper' && isFootballKeeperDefaultsSport(sport)
            ? normalizeKeeperSettingsSnapshot({
                sport,
                draftType,
                scoringPresetId: preset.scoringPreset,
                teamCount: preset.defaultTeamCount,
                settings: snapshotBase,
              })
            : preset.leagueType === 'guillotine' && isGuillotineEligibleSport(sport)
              ? normalizeGuillotineSettingsSnapshot({
                  sport,
                  draftType,
                  scoringPresetId: preset.scoringPreset,
                  teamCount: preset.defaultTeamCount,
                  settings: snapshotBase,
                })
              : preset.leagueType === 'tournament' && isTournamentEligibleSport(sport)
                ? normalizeTournamentSettingsSnapshot({
                    sport,
                    draftType,
                    scoringPresetId: preset.scoringPreset,
                    teamCount: preset.defaultTeamCount,
                    settings: snapshotBase,
                  })
                : preset.leagueType === 'survivor' && isSurvivorEligibleSport(sport)
                  ? normalizeSurvivorSettingsSnapshot({
                      sport,
                      draftType,
                      scoringPresetId: preset.scoringPreset,
                      teamCount: preset.defaultTeamCount,
                      settings: snapshotBase,
                    })
                  : preset.leagueType === 'devy' && isFootballDevyDefaultsSport(sport)
                    ? normalizeDevySettingsSnapshot({
                        sport,
                        draftType,
                        scoringPresetId: preset.scoringPreset,
                        teamCount: preset.defaultTeamCount,
                        settings: snapshotBase,
                      })
                    : preset.leagueType === 'salary_cap' && isSalaryCapEligibleSport(sport)
                      ? normalizeSalaryCapSettingsSnapshot({
                          sport,
                          draftType,
                          scoringPresetId: preset.scoringPreset,
                          teamCount: preset.defaultTeamCount,
                          settings: snapshotBase,
                        })
                      : preset.leagueType === 'c2c' && isC2CEligibleSport(sport)
                        ? normalizeC2CSettingsSnapshot({
                            sport,
                            draftType,
                            scoringPresetId: preset.scoringPreset,
                            teamCount: preset.defaultTeamCount,
                            settings: snapshotBase,
                          })
                        : snapshotBase

  return {
    ok: true,
    preset,
    settingsSnapshot: snapshot,
    presetKey: preset.presetKey,
  }
}

/**
 * Merges preset settings into the league settings record (preset wins on conflicts
 * for structural keys; user settings win for optional overrides).
 */
export function mergeConceptPresetSettings(
  presetSnapshot: Record<string, unknown>,
  leagueSettings: Record<string, unknown>,
): Record<string, unknown> {
  const sport = String(presetSnapshot.sport ?? presetSnapshot.sport_type ?? leagueSettings.sport ?? leagueSettings.sport_type ?? '').toUpperCase()
  const leagueType = String(presetSnapshot.leagueType ?? presetSnapshot.league_type ?? leagueSettings.leagueType ?? leagueSettings.league_type ?? '').toLowerCase()
  if (leagueType === 'redraft' && isFootballRedraftDefaultsSport(sport)) {
    const merged = {
      ...presetSnapshot,
      ...leagueSettings,
      leagueName: leagueSettings.leagueName ?? presetSnapshot.leagueName,
      language: leagueSettings.language ?? presetSnapshot.language ?? 'en',
      timezone: leagueSettings.timezone ?? presetSnapshot.timezone,
    }
    return normalizeRedraftSettingsSnapshot({
      sport,
      draftType: leagueSettings.requested_draft_type ?? leagueSettings.draft_type ?? presetSnapshot.requested_draft_type ?? presetSnapshot.draft_type,
      scoringPresetId:
        typeof leagueSettings.scoring_preset_id === 'string'
          ? leagueSettings.scoring_preset_id
          : typeof presetSnapshot.scoring_preset_id === 'string'
            ? presetSnapshot.scoring_preset_id
            : typeof presetSnapshot.scoringPreset === 'string'
              ? presetSnapshot.scoringPreset
              : null,
      teamCount:
        typeof leagueSettings.default_team_count === 'number'
          ? leagueSettings.default_team_count
          : typeof presetSnapshot.default_team_count === 'number'
            ? presetSnapshot.default_team_count
            : null,
      settings: merged,
    })
  }

  if (leagueType === 'dynasty' && isDynastyEligibleSport(sport)) {
    const merged = {
      ...presetSnapshot,
      ...leagueSettings,
      leagueName: leagueSettings.leagueName ?? presetSnapshot.leagueName,
      language: leagueSettings.language ?? presetSnapshot.language ?? 'en',
      timezone: leagueSettings.timezone ?? presetSnapshot.timezone,
    }
    return normalizeDynastySettingsSnapshot({
      sport,
      draftType: leagueSettings.requested_draft_type ?? leagueSettings.draft_type ?? presetSnapshot.requested_draft_type ?? presetSnapshot.draft_type,
      scoringPresetId:
        typeof leagueSettings.scoring_preset_id === 'string'
          ? leagueSettings.scoring_preset_id
          : typeof presetSnapshot.scoring_preset_id === 'string'
            ? presetSnapshot.scoring_preset_id
            : typeof presetSnapshot.scoringPreset === 'string'
              ? presetSnapshot.scoringPreset
              : null,
      teamCount:
        typeof leagueSettings.default_team_count === 'number'
          ? leagueSettings.default_team_count
          : typeof presetSnapshot.default_team_count === 'number'
            ? presetSnapshot.default_team_count
            : null,
      settings: merged,
    })
  }

  if (leagueType === 'best_ball' && isBestBallEligibleSport(sport)) {
    const merged = {
      ...presetSnapshot,
      ...leagueSettings,
      leagueName: leagueSettings.leagueName ?? presetSnapshot.leagueName,
      language: leagueSettings.language ?? presetSnapshot.language ?? 'en',
      timezone: leagueSettings.timezone ?? presetSnapshot.timezone,
    }
    return normalizeBestBallSettingsSnapshot({
      sport,
      draftType: leagueSettings.requested_draft_type ?? leagueSettings.draft_type ?? presetSnapshot.requested_draft_type ?? presetSnapshot.draft_type,
      scoringPresetId:
        typeof leagueSettings.scoring_preset_id === 'string'
          ? leagueSettings.scoring_preset_id
          : typeof presetSnapshot.scoring_preset_id === 'string'
            ? presetSnapshot.scoring_preset_id
            : typeof presetSnapshot.scoringPreset === 'string'
              ? presetSnapshot.scoringPreset
              : null,
      teamCount:
        typeof leagueSettings.default_team_count === 'number'
          ? leagueSettings.default_team_count
          : typeof presetSnapshot.default_team_count === 'number'
            ? presetSnapshot.default_team_count
            : null,
      settings: merged,
    })
  }

  if (leagueType === 'keeper' && isFootballKeeperDefaultsSport(sport)) {
    const merged = {
      ...presetSnapshot,
      ...leagueSettings,
      leagueName: leagueSettings.leagueName ?? presetSnapshot.leagueName,
      language: leagueSettings.language ?? presetSnapshot.language ?? 'en',
      timezone: leagueSettings.timezone ?? presetSnapshot.timezone,
    }
    return normalizeKeeperSettingsSnapshot({
      sport,
      draftType: leagueSettings.requested_draft_type ?? leagueSettings.draft_type ?? presetSnapshot.requested_draft_type ?? presetSnapshot.draft_type,
      scoringPresetId:
        typeof leagueSettings.scoring_preset_id === 'string'
          ? leagueSettings.scoring_preset_id
          : typeof presetSnapshot.scoring_preset_id === 'string'
            ? presetSnapshot.scoring_preset_id
            : typeof presetSnapshot.scoringPreset === 'string'
              ? presetSnapshot.scoringPreset
              : null,
      teamCount:
        typeof leagueSettings.default_team_count === 'number'
          ? leagueSettings.default_team_count
          : typeof presetSnapshot.default_team_count === 'number'
            ? presetSnapshot.default_team_count
            : null,
      settings: merged,
    })
  }

  if (leagueType === 'guillotine' && isGuillotineEligibleSport(sport)) {
    const merged = {
      ...presetSnapshot,
      ...leagueSettings,
      leagueName: leagueSettings.leagueName ?? presetSnapshot.leagueName,
      language: leagueSettings.language ?? presetSnapshot.language ?? 'en',
      timezone: leagueSettings.timezone ?? presetSnapshot.timezone,
    }
    return normalizeGuillotineSettingsSnapshot({
      sport,
      draftType: leagueSettings.requested_draft_type ?? leagueSettings.draft_type ?? presetSnapshot.requested_draft_type ?? presetSnapshot.draft_type,
      scoringPresetId:
        typeof leagueSettings.scoring_preset_id === 'string'
          ? leagueSettings.scoring_preset_id
          : typeof presetSnapshot.scoring_preset_id === 'string'
            ? presetSnapshot.scoring_preset_id
            : typeof presetSnapshot.scoringPreset === 'string'
              ? presetSnapshot.scoringPreset
              : null,
      teamCount:
        typeof leagueSettings.default_team_count === 'number'
          ? leagueSettings.default_team_count
          : typeof presetSnapshot.default_team_count === 'number'
            ? presetSnapshot.default_team_count
            : null,
      settings: merged,
    })
  }

  if (leagueType === 'tournament' && isTournamentEligibleSport(sport)) {
    const merged = {
      ...presetSnapshot,
      ...leagueSettings,
      leagueName: leagueSettings.leagueName ?? presetSnapshot.leagueName,
      language: leagueSettings.language ?? presetSnapshot.language ?? 'en',
      timezone: leagueSettings.timezone ?? presetSnapshot.timezone,
    }
    return normalizeTournamentSettingsSnapshot({
      sport,
      draftType: leagueSettings.requested_draft_type ?? leagueSettings.draft_type ?? presetSnapshot.requested_draft_type ?? presetSnapshot.draft_type,
      scoringPresetId:
        typeof leagueSettings.scoring_preset_id === 'string'
          ? leagueSettings.scoring_preset_id
          : typeof presetSnapshot.scoring_preset_id === 'string'
            ? presetSnapshot.scoring_preset_id
            : typeof presetSnapshot.scoringPreset === 'string'
              ? presetSnapshot.scoringPreset
              : null,
      teamCount:
        typeof leagueSettings.default_team_count === 'number'
          ? leagueSettings.default_team_count
          : typeof presetSnapshot.default_team_count === 'number'
            ? presetSnapshot.default_team_count
            : null,
      settings: merged,
    })
  }

  if (leagueType === 'survivor' && isSurvivorEligibleSport(sport)) {
    const merged = {
      ...presetSnapshot,
      ...leagueSettings,
      leagueName: leagueSettings.leagueName ?? presetSnapshot.leagueName,
      language: leagueSettings.language ?? presetSnapshot.language ?? 'en',
      timezone: leagueSettings.timezone ?? presetSnapshot.timezone,
    }
    return normalizeSurvivorSettingsSnapshot({
      sport,
      draftType: leagueSettings.requested_draft_type ?? leagueSettings.draft_type ?? presetSnapshot.requested_draft_type ?? presetSnapshot.draft_type,
      scoringPresetId:
        typeof leagueSettings.scoring_preset_id === 'string'
          ? leagueSettings.scoring_preset_id
          : typeof presetSnapshot.scoring_preset_id === 'string'
            ? presetSnapshot.scoring_preset_id
            : typeof presetSnapshot.scoringPreset === 'string'
              ? presetSnapshot.scoringPreset
              : null,
      teamCount:
        typeof leagueSettings.default_team_count === 'number'
          ? leagueSettings.default_team_count
          : typeof presetSnapshot.default_team_count === 'number'
            ? presetSnapshot.default_team_count
            : null,
      settings: merged,
    })
  }

  if (leagueType === 'devy' && isFootballDevyDefaultsSport(sport)) {
    const merged = {
      ...presetSnapshot,
      ...leagueSettings,
      leagueName: leagueSettings.leagueName ?? presetSnapshot.leagueName,
      language: leagueSettings.language ?? presetSnapshot.language ?? 'en',
      timezone: leagueSettings.timezone ?? presetSnapshot.timezone,
    }
    return normalizeDevySettingsSnapshot({
      sport,
      draftType: leagueSettings.requested_draft_type ?? leagueSettings.draft_type ?? presetSnapshot.requested_draft_type ?? presetSnapshot.draft_type,
      scoringPresetId:
        typeof leagueSettings.scoring_preset_id === 'string'
          ? leagueSettings.scoring_preset_id
          : typeof presetSnapshot.scoring_preset_id === 'string'
            ? presetSnapshot.scoring_preset_id
            : typeof presetSnapshot.scoringPreset === 'string'
              ? presetSnapshot.scoringPreset
              : null,
      teamCount:
        typeof leagueSettings.default_team_count === 'number'
          ? leagueSettings.default_team_count
          : typeof presetSnapshot.default_team_count === 'number'
            ? presetSnapshot.default_team_count
            : null,
      settings: merged,
    })
  }

  if (leagueType === 'salary_cap' && isSalaryCapEligibleSport(sport)) {
    const merged = {
      ...presetSnapshot,
      ...leagueSettings,
      leagueName: leagueSettings.leagueName ?? presetSnapshot.leagueName,
      language: leagueSettings.language ?? presetSnapshot.language ?? 'en',
      timezone: leagueSettings.timezone ?? presetSnapshot.timezone,
    }
    return normalizeSalaryCapSettingsSnapshot({
      sport,
      draftType: leagueSettings.requested_draft_type ?? leagueSettings.draft_type ?? presetSnapshot.requested_draft_type ?? presetSnapshot.draft_type,
      scoringPresetId:
        typeof leagueSettings.scoring_preset_id === 'string'
          ? leagueSettings.scoring_preset_id
          : typeof presetSnapshot.scoring_preset_id === 'string'
            ? presetSnapshot.scoring_preset_id
            : typeof presetSnapshot.scoringPreset === 'string'
              ? presetSnapshot.scoringPreset
              : null,
      teamCount:
        typeof leagueSettings.default_team_count === 'number'
          ? leagueSettings.default_team_count
          : typeof presetSnapshot.default_team_count === 'number'
            ? presetSnapshot.default_team_count
            : null,
      settings: merged,
    })
  }

  if (leagueType === 'c2c' && isC2CEligibleSport(sport)) {
    const merged = {
      ...presetSnapshot,
      ...leagueSettings,
      leagueName: leagueSettings.leagueName ?? presetSnapshot.leagueName,
      language: leagueSettings.language ?? presetSnapshot.language ?? 'en',
      timezone: leagueSettings.timezone ?? presetSnapshot.timezone,
    }
    return normalizeC2CSettingsSnapshot({
      sport,
      draftType: leagueSettings.requested_draft_type ?? leagueSettings.draft_type ?? presetSnapshot.requested_draft_type ?? presetSnapshot.draft_type,
      scoringPresetId:
        typeof leagueSettings.scoring_preset_id === 'string'
          ? leagueSettings.scoring_preset_id
          : typeof presetSnapshot.scoring_preset_id === 'string'
            ? presetSnapshot.scoring_preset_id
            : typeof presetSnapshot.scoringPreset === 'string'
              ? presetSnapshot.scoringPreset
              : null,
      teamCount:
        typeof leagueSettings.default_team_count === 'number'
          ? leagueSettings.default_team_count
          : typeof presetSnapshot.default_team_count === 'number'
            ? presetSnapshot.default_team_count
            : null,
      settings: merged,
    })
  }

  return {
    ...leagueSettings,
    ...presetSnapshot,
    leagueName: leagueSettings.leagueName ?? presetSnapshot.leagueName,
    language: leagueSettings.language ?? presetSnapshot.language ?? 'en',
    timezone: leagueSettings.timezone ?? presetSnapshot.timezone,
  }
}
