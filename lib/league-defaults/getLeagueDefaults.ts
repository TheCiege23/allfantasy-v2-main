import type { LeagueSport } from '@prisma/client'
import { mapCanonicalDraftTypeToEngineCore } from '@/lib/draft-types/draftTypeRegistry'
import { CONCEPT_PRESET_CATALOG } from '@/lib/league-concepts/conceptPresetCatalog'
import type { ConceptPresetSeed } from '@/lib/league-concepts/conceptPresetCatalog'
import { normalizeConceptToFormat } from '@/lib/league-creation/canonical/normalizeConcept'
import { resolveLeagueFormat, type LeagueFormatId } from '@/lib/league/format-engine'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import {
  buildRedraftSettingsSnapshot,
  getRedraftDefaultContract,
  type RedraftDefaultContract,
} from '@/lib/league-concepts/redraftDefaults'
import {
  buildKeeperSettingsSnapshot,
  getKeeperDefaultContract,
  type KeeperDefaultContract,
} from '@/lib/league-concepts/keeperDefaults'
import {
  buildDevySettingsSnapshot,
  getDevyDefaultContract,
  type DevyDefaultContract,
} from '@/lib/league-concepts/devyDefaults'

export type LeagueFoundationDefaultsInput = {
  sport: LeagueSport | string
  format: string
  draftType: string
  managerCount?: number | null
  scoringPreset?: string | null
}

export type LeagueFoundationDefaults = {
  sport: LeagueSport
  format: LeagueFormatId
  draftType: string
  engineDraftType: 'snake' | 'linear' | 'auction'
  managerCount: number
  rosterSettings: Record<string, unknown>
  scoringSettings: Record<string, unknown>
  draftSettings: Record<string, unknown>
  waiverSettings: Record<string, unknown>
  playoffSettings: Record<string, unknown>
  scheduleSettings: Record<string, unknown>
  redraftContract?: RedraftDefaultContract | null
  keeperContract?: KeeperDefaultContract | null
  devyContract?: DevyDefaultContract | null
  playerPoolRules?: Record<string, unknown>
  proPlayerPoolRules?: Record<string, unknown>
  devyPlayerPoolRules?: Record<string, unknown>
  rookiePlayerPoolRules?: Record<string, unknown>
  tabsEnabled?: Record<string, unknown>
  mockDraftRules?: Record<string, unknown>
  liveDraftRules?: Record<string, unknown>
  disabledSettings?: Record<string, unknown>
  keeperPolicy?: Record<string, unknown>
  devySettings?: Record<string, unknown>
  devyConfig?: Record<string, unknown>
  tradeSettings?: Record<string, unknown>
  conceptPreset: {
    presetKey: string | null
    readiness: string
    isLaunchReady: boolean
    requiredDataFeeds: string[]
    aiEnabledFeatures: string[]
  }
}

function scorePresetMatch(args: {
  preset: ConceptPresetSeed
  sport: LeagueSport
  format: LeagueFormatId
  draftType: string
  engineDraftType: string
  scoringPreset: string
  modifiers: readonly string[]
}): number {
  const { preset, sport, format, draftType, engineDraftType, scoringPreset, modifiers } = args
  if (preset.sport !== sport || preset.leagueType !== format) return -1

  let score = 0
  if (preset.draftTypesAllowed.includes(draftType)) score += 20
  if (preset.draftTypesAllowed.includes(engineDraftType)) score += 12
  if (preset.scoringPreset === scoringPreset) score += 10

  const presetModifiers = new Set((preset.metadata.modifiers ?? []).map((m) => String(m)))
  for (const modifier of modifiers) {
    if (presetModifiers.has(String(modifier))) score += 4
  }
  if (preset.isLaunchReady) score += 1
  return score
}

function findBestConceptPreset(args: {
  sport: LeagueSport
  format: LeagueFormatId
  draftType: string
  engineDraftType: string
  scoringPreset: string
  modifiers: readonly string[]
}): ConceptPresetSeed | null {
  let best: { preset: ConceptPresetSeed; score: number } | null = null
  for (const preset of CONCEPT_PRESET_CATALOG) {
    const score = scorePresetMatch({ preset, ...args })
    if (score < 0) continue
    if (!best || score > best.score) best = { preset, score }
  }
  return best?.preset ?? null
}

function normalizeFormat(raw: string): LeagueFormatId {
  const normalized = normalizeConceptToFormat(raw)
  return (normalized?.formatId ?? 'redraft') as LeagueFormatId
}

function numericOr(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/**
 * Playoff and waiver defaults ship in two key spellings, both of which are widely consumed:
 * snake_case (the sport-defaults registry shape, e.g. `playoff_start_week`) and camelCase
 * (the format-contract shape, e.g. `playoffStartWeek`).
 *
 * They used to be assembled independently — the snake keys arrived by spreading the registry
 * defaults, the camel keys were recomputed underneath with their own fallback chains — so the
 * two could disagree about the same league. An NCAAF devy league reported playoffs starting in
 * week 13 under one spelling and week 15 under the other; an 8-manager NFL redraft league had
 * 6 playoff teams under one and 4 under the other; a dynasty league had FAAB waivers under one
 * and no waiver type at all under the other.
 *
 * Both spellings are now projected from a single resolved value per field. Nothing in this
 * module may write one spelling of a mirrored field on its own.
 */
type SettingsKeyMirror = readonly [snakeKey: string, camelKey: string]

const PLAYOFF_KEY_MIRRORS: readonly SettingsKeyMirror[] = [
  ['playoff_team_count', 'playoffTeams'],
  ['playoff_start_week', 'playoffStartWeek'],
  ['playoff_weeks', 'playoffWeeks'],
  ['first_round_byes', 'firstRoundByes'],
  ['total_rounds', 'totalRounds'],
  ['championship_length', 'championshipLength'],
  ['regular_season_end_week', 'regularSeasonEndWeek'],
  ['championship_week', 'championshipWeek'],
  /** One matchup per playoff round; the sport-defaults registry calls this `matchup_length`. */
  ['matchup_length', 'playoffWeeksPerRound'],
]

const WAIVER_KEY_MIRRORS: readonly SettingsKeyMirror[] = [
  ['waiver_type', 'waiverType'],
  ['FAAB_budget_default', 'faabBudget'],
  ['processing_days', 'processingDays'],
  ['processing_time_utc', 'processingTimeUtc'],
  ['free_agent_unlock_behavior', 'freeAgentUnlockBehavior'],
  ['game_lock_behavior', 'gameLockBehavior'],
]

/** `null` is a real value (no-playoff formats set `playoff_start_week: null`); only `undefined` means absent. */
function firstPresent(...values: readonly unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined) return value
  }
  return undefined
}

/**
 * Merge a snake_case registry default with a camelCase format contract, then force both
 * spellings of every mirrored field to the one winning value.
 *
 * Precedence per field: explicit override > format contract > sport/variant registry >
 * derived fallback. The format contract outranks the registry because it is the more specific
 * authority — it is resolved from sport, format *and* manager count, whereas the registry only
 * varies by sport and variant.
 */
function projectMirroredSettings(input: {
  mirrors: readonly SettingsKeyMirror[]
  registryDefaults: Record<string, unknown>
  contractSettings?: Record<string, unknown> | null
  overrides?: Record<string, unknown> | null
  fallbacks?: Record<string, unknown> | null
}): Record<string, unknown> {
  const { mirrors, registryDefaults, contractSettings, overrides, fallbacks } = input
  const merged: Record<string, unknown> = { ...registryDefaults, ...(contractSettings ?? {}) }

  for (const [snakeKey, camelKey] of mirrors) {
    const resolved = firstPresent(
      overrides?.[camelKey],
      overrides?.[snakeKey],
      contractSettings?.[camelKey],
      contractSettings?.[snakeKey],
      registryDefaults[snakeKey],
      registryDefaults[camelKey],
      fallbacks?.[camelKey],
      fallbacks?.[snakeKey],
    )
    if (resolved === undefined) {
      delete merged[snakeKey]
      delete merged[camelKey]
      continue
    }
    merged[snakeKey] = resolved
    merged[camelKey] = resolved
  }

  return merged
}

/**
 * The registry only knows when playoffs start; the redraft/keeper contracts additionally
 * publish where the regular season ends and when the championship is played. Derive those two
 * for the formats that have no contract (dynasty, devy, c2c, …) so every format answers the
 * question, and let a contract that states them explicitly win.
 */
function derivePlayoffWeekBounds(args: {
  startWeek: unknown
  playoffWeeks: unknown
}): { regularSeasonEndWeek: number | null; championshipWeek: number | null } {
  const startWeek = Number(args.startWeek)
  if (!Number.isFinite(startWeek) || startWeek <= 0) {
    return { regularSeasonEndWeek: null, championshipWeek: null }
  }
  const spanWeeks = numericOr(args.playoffWeeks, 1)
  return {
    regularSeasonEndWeek: startWeek - 1,
    championshipWeek: startWeek + spanWeeks - 1,
  }
}

export function getLeagueDefaults(input: LeagueFoundationDefaultsInput): LeagueFoundationDefaults {
  const sport = normalizeToSupportedSport(input.sport)
  const format = normalizeFormat(input.format)
  const engineDraftType = mapCanonicalDraftTypeToEngineCore(input.draftType)
  const scoringPreset = String(input.scoringPreset ?? '').trim()
  const redraftContract =
    format === 'redraft'
      ? getRedraftDefaultContract({
          sport,
          draftType: input.draftType,
          scoringPresetId: scoringPreset || null,
          teamCount: input.managerCount,
        })
      : null
  const redraftSnapshot =
    redraftContract
      ? buildRedraftSettingsSnapshot({
          sport,
          draftType: input.draftType,
          scoringPresetId: redraftContract.scoring_preset_id,
          teamCount: input.managerCount,
        })
      : null
  const keeperContract =
    format === 'keeper'
      ? getKeeperDefaultContract({
          sport,
          draftType: input.draftType,
          scoringPresetId: scoringPreset || null,
          teamCount: input.managerCount,
        })
      : null
  const keeperSnapshot =
    keeperContract
      ? buildKeeperSettingsSnapshot({
          sport,
          draftType: input.draftType,
          scoringPresetId: keeperContract.scoring_preset_id,
          teamCount: input.managerCount,
        })
      : null
  const devyContract =
    format === 'devy'
      ? getDevyDefaultContract({
          sport,
          draftType: input.draftType,
          scoringPresetId: scoringPreset || null,
          teamCount: input.managerCount,
        })
      : null
  const devySnapshot =
    devyContract
      ? buildDevySettingsSnapshot({
          sport,
          draftType: input.draftType,
          scoringPresetId: devyContract.scoring_preset_id,
          teamCount: input.managerCount,
        })
      : null
  const resolution = resolveLeagueFormat({
    sport,
    leagueType: format,
    draftType: input.draftType,
    leagueVariant: String(input.format).toLowerCase().includes('idp') ? 'IDP' : null,
  })
  const preset = findBestConceptPreset({
    sport,
    format,
    draftType: String(input.draftType).trim().toLowerCase(),
    engineDraftType,
    scoringPreset,
    modifiers: resolution.modifiers,
  })
  const managerCount = numericOr(
    input.managerCount,
    devyContract?.teams ?? keeperContract?.teams ?? redraftContract?.teams ?? preset?.defaultTeamCount ?? resolution.leagueDefaults.default_team_count ?? 12,
  )
  const canonicalSnapshot = redraftSnapshot ?? keeperSnapshot ?? devySnapshot ?? null
  const canonicalDraftSettings = (canonicalSnapshot?.draftSettings as Record<string, unknown> | undefined) ?? null
  const canonicalWaiverSettings = (canonicalSnapshot?.waiverSettings as Record<string, unknown> | undefined) ?? null
  const canonicalPlayoffSettings = (canonicalSnapshot?.playoffSettings as Record<string, unknown> | undefined) ?? null
  const rounds = numericOr(canonicalDraftSettings?.rounds ?? resolution.draftDefaults.rounds_default, engineDraftType === 'auction' ? 15 : 15)
  const timerSeconds = numericOr(canonicalDraftSettings?.timerSeconds ?? resolution.draftDefaults.timer_seconds_default, 90)
  const playoff = resolution.playoffDefaults as unknown as Record<string, unknown>
  const scoring = resolution.scoring as unknown as Record<string, unknown>
  const roster = resolution.roster as unknown as Record<string, unknown>
  const waiverDefaults = resolution.waiverDefaults as unknown as Record<string, unknown>
  const scheduleDefaults = resolution.scheduleDefaults as unknown as Record<string, unknown>
  const canonicalRosterSettings = (canonicalSnapshot?.rosterSettings as Record<string, unknown> | undefined) ?? {}
  /** Guillotine crowns the last team standing rather than running a bracket. */
  const playoffOverrides = format === 'guillotine' ? { playoffTeams: 1, playoffStartWeek: null } : null
  const playoffWeekBounds = derivePlayoffWeekBounds({
    startWeek: firstPresent(
      playoffOverrides?.playoffStartWeek,
      canonicalPlayoffSettings?.playoffStartWeek,
      playoff.playoff_start_week,
    ),
    playoffWeeks: firstPresent(canonicalPlayoffSettings?.playoffWeeks, playoff.playoff_weeks),
  })

  return {
    sport,
    format,
    draftType: String(input.draftType).trim().toLowerCase(),
    engineDraftType,
    managerCount,
    rosterSettings: {
      ...roster,
      ...canonicalRosterSettings,
      rosterSlots: canonicalRosterSettings.rosterSlots ?? preset?.rosterSlots,
      benchSlots: canonicalRosterSettings.benchSlots ?? preset?.benchSlots,
      irSlots: canonicalRosterSettings.irSlots ?? preset?.irSlots,
      taxiSlots: canonicalRosterSettings.taxiSlots ?? preset?.taxiSlots,
      collegeRosterSlots: canonicalRosterSettings.collegeRosterSlots ?? preset?.collegeRosterSlots,
    },
    scoringSettings: {
      ...scoring,
      ...((canonicalSnapshot?.scoringSettings as Record<string, unknown> | undefined) ?? {}),
      preset: scoringPreset || preset?.scoringPreset || scoring.scoringTemplateId,
      scoringTemplateId: scoringPreset || preset?.scoringPreset || scoring.scoringTemplateId,
      scoringMode: scoring.scoringMode ?? 'points',
      rules: {
        ...(scoring.rules && typeof scoring.rules === 'object' ? scoring.rules : {}),
        ...(preset?.idpRules ? { idp: preset.idpRules } : {}),
      },
    },
    draftSettings: {
      ...resolution.draftDefaults,
      ...canonicalDraftSettings,
      draftType: engineDraftType,
      requestedDraftType: String(input.draftType).trim().toLowerCase(),
      ...(canonicalDraftSettings?.requestedDraftType
        ? { requestedDraftType: canonicalDraftSettings.requestedDraftType }
        : {}),
      rounds,
      timerSeconds,
      auctionBudgetPerTeam: engineDraftType === 'auction' ? 200 : null,
      devyConfig:
        format === 'devy'
          ? ((devySnapshot?.devyConfig as Record<string, unknown> | undefined) ?? {
              enabled: true,
              devyRounds: [Math.max(1, rounds - 1), rounds],
            })
          : null,
      c2cConfig: format === 'c2c' ? { enabled: true, collegeRounds: [Math.max(1, rounds - 1), rounds] } : null,
    },
    waiverSettings: projectMirroredSettings({
      mirrors: WAIVER_KEY_MIRRORS,
      registryDefaults: waiverDefaults,
      contractSettings: canonicalWaiverSettings,
    }),
    playoffSettings: {
      ...projectMirroredSettings({
        mirrors: PLAYOFF_KEY_MIRRORS,
        registryDefaults: playoff,
        contractSettings: canonicalPlayoffSettings,
        overrides: playoffOverrides,
        fallbacks: { ...playoffWeekBounds, playoffWeeksPerRound: 1 },
      }),
      seedingRule: canonicalPlayoffSettings?.standingsRule ?? playoff.seedingRule ?? playoff.seeding ?? 'record_then_points',
      lowerBracket: canonicalPlayoffSettings?.lowerBracket ?? playoff.lowerBracket ?? 'consolation',
    },
    scheduleSettings: scheduleDefaults,
    redraftContract,
    keeperContract,
    devyContract,
    playerPoolRules: (canonicalSnapshot?.playerPoolRules as Record<string, unknown> | undefined) ?? undefined,
    proPlayerPoolRules: (canonicalSnapshot?.proPlayerPoolRules as Record<string, unknown> | undefined) ?? undefined,
    devyPlayerPoolRules: (canonicalSnapshot?.devyPlayerPoolRules as Record<string, unknown> | undefined) ?? undefined,
    rookiePlayerPoolRules: (canonicalSnapshot?.rookiePlayerPoolRules as Record<string, unknown> | undefined) ?? undefined,
    tabsEnabled: (canonicalSnapshot?.tabsEnabled as Record<string, unknown> | undefined) ?? undefined,
    mockDraftRules: (canonicalSnapshot?.mockDraftRules as Record<string, unknown> | undefined) ?? undefined,
    liveDraftRules: (canonicalSnapshot?.liveDraftRules as Record<string, unknown> | undefined) ?? undefined,
    disabledSettings: redraftContract?.disabledSettings ?? keeperContract?.disabledSettings ?? devyContract?.disabledSettings,
    keeperPolicy: (keeperSnapshot?.keeperSettings as Record<string, unknown> | undefined) ?? undefined,
    devySettings: (devySnapshot?.devySettings as Record<string, unknown> | undefined) ?? undefined,
    devyConfig: (devySnapshot?.devyConfig as Record<string, unknown> | undefined) ?? undefined,
    tradeSettings: ((redraftSnapshot ?? keeperSnapshot ?? devySnapshot)?.tradeSettings as Record<string, unknown> | undefined) ?? undefined,
    conceptPreset: {
      presetKey: preset?.presetKey ?? null,
      readiness: preset?.readiness ?? 'launch_ready',
      isLaunchReady: preset?.isLaunchReady ?? true,
      requiredDataFeeds: preset?.requiredDataFeeds ?? [],
      aiEnabledFeatures: preset?.aiEnabledFeatures ?? [],
    },
  }
}
