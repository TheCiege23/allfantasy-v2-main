/**
 * Create League v2 — rules engine.
 *
 * Pure functions that delegate to existing format-engine, league-type-registry,
 * and sport-team-limits. The UI imports only from this file so filtering logic
 * stays testable and DRY.
 */

import type { LeagueTypeId, DraftTypeId } from '@/lib/league-creation-wizard/types'
import type { SupportedSport } from '@/lib/create-league-v2/state'
import { getAllowedSportsForLeagueType } from '@/lib/league-creation-wizard/league-type-registry'
import { getTeamCountOptionsForSport } from '@/lib/league-creation-wizard/sport-team-limits'
import { SUPPORTED_SPORTS, supportsIdpLeagueSport } from '@/lib/sport-scope'
import {
  getDraftTypeUiHint,
  getDraftTypeUiLabel,
  resolveEffectiveDraftTypeForConcept,
} from '@/lib/draft-types/draftTypeRegistry'
import { getCreateLeagueDraftTypes } from '@/lib/league/format-engine'
import { getGuillotineSportConfig } from '@/lib/guillotine/sportConfig'
import { BEST_BALL_DRAFT_MODES } from '@/lib/bestball/rules'
import { getClientLeagueCreateOptionsCatalog } from '@/lib/create-league-v2/options-catalog-client'
import {
  listScoringPresetOptions,
  resolveScoringPresetId,
  type ScoringPresetOption,
} from '@/lib/league-creation-preset/scoring-presets'
import { UNIVERSAL_CREATE_TEAM_COUNTS } from '@/lib/create-league-v2/simple-create'

// ── Sport filtering ─────────────────────────────────────────────────

/** Which sports are allowed for a given league type? */
export function getAllowedSportsForType(leagueType: LeagueTypeId): SupportedSport[] {
  const catalog = getClientLeagueCreateOptionsCatalog()
  const seeded = catalog?.allowedSportsByConcept?.[leagueType]
  if (Array.isArray(seeded) && seeded.length > 0) {
    return seeded.filter((s) => (SUPPORTED_SPORTS as readonly string[]).includes(s)) as SupportedSport[]
  }

  // IDP availability is controlled by sport-scope (NFL + NCAAF today).
  const allowed = getAllowedSportsForLeagueType(leagueType)
  return allowed.filter((s) => (SUPPORTED_SPORTS as readonly string[]).includes(s)) as SupportedSport[]
}

export function isSportAllowedForType(sport: SupportedSport, leagueType: LeagueTypeId): boolean {
  return getAllowedSportsForType(leagueType).includes(sport)
}

// ── Team count ──────────────────────────────────────────────────────

/**
 * Per-sport max team count caps. These mirror the number of real-world clubs
 * in each league so a fantasy manager can (at most) claim one unique team.
 *
 * Sources (2025–2026 seasons):
 * - NFL: 32 clubs
 * - NBA: 30 clubs
 * - MLB: 30 clubs
 * - NHL: 32 clubs
 * - NCAAB: 80 (per product spec — caps the Power 5 + high-major pool)
 * - NCAAF: 86 (per product spec — caps the Power 4 + non-conference pool)
 * - SOCCER (MLS): 30 clubs in 2026
 * - SOCCER (Big 5 European): 96 clubs combined (EPL 20 + La Liga 20 + Serie A 20 + Bundesliga 18 + Ligue 1 18)
 */
const SPORT_MAX_TEAMS_STANDARD: Record<string, number> = {
  NFL: 32,
  NBA: 30,
  MLB: 30,
  NHL: 32,
  NCAAF: 86,
  NCAAB: 80,
  SOCCER: 30, // default — refined below for MLS vs Euro
}
const SOCCER_EURO_MAX = 96
const SOCCER_MLS_MAX = 30

/** Resolve the per-sport max for team count. Accepts a soccer pipeline hint. */
export function getMaxTeamsForSport(
  sport: SupportedSport,
  soccerPipeline?: 'mls' | 'euro' | null
): number {
  if (sport === 'SOCCER') {
    return soccerPipeline === 'euro' ? SOCCER_EURO_MAX : SOCCER_MLS_MAX
  }
  return SPORT_MAX_TEAMS_STANDARD[sport] ?? 32
}

/** Universal simple-create team counts from 2 through the sport cap, inclusive. */
function evenTeamCountsUpTo(max: number): number[] {
  return UNIVERSAL_CREATE_TEAM_COUNTS.filter((n) => n <= max)
}

/** Fixed tournament pool sizes — user-facing tiers. */
const TOURNAMENT_POOL_SIZES = [32, 64, 96, 128, 160, 192, 224] as const

/** Big Brother: fixed house sizes (12 / 14 / 16 / 18). */
const BIG_BROTHER_SIZES = [12, 14, 16, 18] as const

/**
 * Team count options for the pill row.
 * - tournament → fixed tiers [32, 64, 96, 128, 160, 192, 224]
 * - guillotine → even counts 4 up to the sport's regular-season week max
 * - big_brother → fixed [12, 14, 16, 18]
 * - survivor → 16 / 20 / 24 (fixed cast sizes)
 * - all others → even numbers 4 up to the sport's real-world club cap
 */
export function getTeamCountOptions(
  sport: SupportedSport,
  leagueType: LeagueTypeId,
  soccerPipeline?: 'mls' | 'euro' | null
): number[] {
  const catalog = getClientLeagueCreateOptionsCatalog()
  const seeded = catalog?.teamCountOptionsByConceptSport?.[leagueType]?.[sport]
  if (Array.isArray(seeded) && seeded.length > 0) {
    return [...seeded]
  }

  if (leagueType === 'tournament') {
    return [...TOURNAMENT_POOL_SIZES]
  }
  if (leagueType === 'big_brother') {
    return [...BIG_BROTHER_SIZES]
  }
  if (leagueType === 'guillotine') {
    const profile = getGuillotineSportConfig(sport)
    const minTeams = Math.max(4, profile?.minTeams ?? 8)
    const maxTeams = Math.max(minTeams, profile?.maxTeams ?? 18)
    const options: number[] = []
    for (let teams = minTeams; teams <= maxTeams; teams += 1) {
      options.push(teams)
    }
    return options
  }
  if (leagueType === 'survivor') {
    return [16, 20, 24]
  }
  const max = getMaxTeamsForSport(sport, soccerPipeline)
  return evenTeamCountsUpTo(max)
}

/** Pick a sensible default from the options list. */
export function getDefaultTeamCount(
  sport: SupportedSport,
  leagueType: LeagueTypeId,
  soccerPipeline?: 'mls' | 'euro' | null
): number {
  const opts = getTeamCountOptions(sport, leagueType, soccerPipeline)
  if (opts.length === 0) return 12
  // Prefer 12 if available, otherwise middle of the list
  if (opts.includes(12)) return 12
  return opts[Math.floor(opts.length / 2)] ?? opts[0]!
}

// ── Draft types ─────────────────────────────────────────────────────

/**
 * Execution modes shown on the create-league wizard.
 * Best Ball exposes `offline` + `auto` because those modes are part of the
 * core Best Ball product surface. Other formats keep `offline` settings-tab-only.
 */
const EXECUTION_DRAFT_IDS = ['auto', 'offline'] as const
const KEEPER_EXECUTION_DRAFT_IDS = ['auto', 'offline', 'team'] as const
const NON_PICKABLE_REDFRAFT_DRAFT_IDS = ['slow_draft'] as const

/** Widened string type so the UI can accept execution-mode ids that aren't Prisma DraftTypeIds. */
export type WizardDraftTypeId = DraftTypeId | 'auto' | 'offline' | 'team'

export interface DraftTypeOption {
  id: WizardDraftTypeId
  label: string
  hint: string
}

/** Draft types to show in the create-league wizard for a given league type + sport. */
export function getDraftTypeOptions(leagueType: LeagueTypeId, sport: SupportedSport = 'NFL'): DraftTypeOption[] {
  const catalog = getClientLeagueCreateOptionsCatalog()
  const seeded = catalog?.allowedDraftTypesByConcept?.[leagueType]

  const sportAllowed = getCreateLeagueDraftTypes(sport, leagueType)
  const seededNormalized = Array.isArray(seeded)
    ? seeded
        .map((dt) => resolveEffectiveDraftTypeForConcept(leagueType, dt))
        .filter((dt) => sportAllowed.includes(dt as DraftTypeId))
    : []
  const allowed = seededNormalized.length > 0 ? seededNormalized : sportAllowed
  const result: DraftTypeOption[] = []
  const blocked = leagueType === 'redraft' ? new Set<string>(NON_PICKABLE_REDFRAFT_DRAFT_IDS) : new Set<string>()

  for (const dt of allowed) {
    if (blocked.has(dt)) continue

    result.push({
      id: dt as WizardDraftTypeId,
      label: getDraftTypeUiLabel(dt, leagueType),
      hint: getDraftTypeUiHint(dt),
    })
  }

  // Best Ball keeps execution modes visible on the create surface so the
  // underlying order algorithm and execution mode can both be selected up front.
  if (leagueType === 'best_ball' || leagueType === 'redraft' || leagueType === 'keeper') {
    const existing = new Set(result.map((option) => option.id))
    const executionModes =
      leagueType === 'best_ball'
        ? BEST_BALL_DRAFT_MODES
        : leagueType === 'keeper'
          ? KEEPER_EXECUTION_DRAFT_IDS
          : EXECUTION_DRAFT_IDS
    for (const mode of executionModes) {
      if (mode === 'snake' || mode === 'linear' || mode === 'auction') continue
      if (existing.has(mode)) continue
      result.push({
        id: mode,
        label: mode === 'auto' ? 'Auto' : mode === 'team' ? 'Team' : 'Offline',
        hint:
          mode === 'auto'
            ? 'CPU drafts for every team'
            : mode === 'team'
              ? 'Co-managers share draft controls'
              : 'Commissioner records picks manually',
      })
    }
  } else if (leagueType === 'devy') {
    const existing = new Set(result.map((option) => option.id))
    for (const mode of EXECUTION_DRAFT_IDS) {
      if (existing.has(mode)) continue
      result.push({
        id: mode,
        label: mode === 'auto' ? 'Auto' : 'Offline',
        hint: mode === 'auto' ? 'CPU drafts for everyone' : 'Commissioner records picks manually',
      })
    }
  } else if (leagueType !== 'big_brother' && leagueType !== 'zombie') {
    result.push({
      id: 'auto',
      label: 'Auto',
      hint: 'CPU drafts for everyone',
    })
  }

  return result
}

/** Is a specific draft type allowed for this league type? */
export function isDraftTypeAllowedForType(draftType: WizardDraftTypeId | string, leagueType: LeagueTypeId): boolean {
  const options = getDraftTypeOptions(leagueType)
  return options.some((o) => o.id === draftType)
}

export function getIdpDraftTypeOptions(): DraftTypeOption[] {
  return [
    { id: 'snake', label: 'Snake', hint: 'Pick order reverses every round' },
    { id: 'linear', label: 'Linear', hint: 'Pick order stays fixed each round' },
    { id: 'auction', label: 'Auction', hint: 'Managers bid with budget for every player' },
    { id: 'offline', label: 'Offline', hint: 'Commissioner enters picks manually' },
    { id: 'auto', label: 'Auto', hint: 'CPU drafts all teams automatically' },
  ]
}

export function isIdpDraftTypeAllowed(draftType: WizardDraftTypeId | string): boolean {
  return getIdpDraftTypeOptions().some((option) => option.id === draftType)
}

// ── Effective draft type mapping ────────────────────────────────────

/** Map wizard selection to canonical API draft ids (devy/c2c specialty variants). */
export function resolveEffectiveDraftType(leagueType: LeagueTypeId, baseDraftType: WizardDraftTypeId | string): string {
  return resolveEffectiveDraftTypeForConcept(leagueType, String(baseDraftType))
}

// ── Survivor tribe helpers ──────────────────────────────────────────

/** Valid tribe counts for a given team count (must divide evenly). */
export function getSurvivorTribeOptions(teamCount: number): number[] {
  return [2, 3, 4].filter((t) => teamCount % t === 0)
}

// ── 3RR availability ────────────────────────────────────────────────

export function isThirdRoundReversalAvailable(draftType: WizardDraftTypeId | string): boolean {
  const x = String(draftType).toLowerCase()
  return (
    x === 'snake' ||
    x === 'devy_snake' ||
    x === 'c2c_snake' ||
    x === 'mock_draft'
  )
}

// ── IDP helpers ─────────────────────────────────────────────────────

/** IDP is available for football (NFL + NCAAF). */
export function isIdpAvailableForSport(sport: SupportedSport): boolean {
  return supportsIdpLeagueSport(sport)
}

type ScoringSelection = {
  leagueType: LeagueTypeId
  sport: SupportedSport
  idpSelected: boolean
}

export function getScoringPresetOptionsForSelection(input: ScoringSelection): ScoringPresetOption[] {
  const raw = listScoringPresetOptions(input)
  const conceptId = input.idpSelected ? 'idp' : input.leagueType
  const catalog = getClientLeagueCreateOptionsCatalog()
  const allowed = catalog?.allowedScoringPresetsByConceptSport?.[conceptId]?.[input.sport]

  if (!Array.isArray(allowed) || allowed.length === 0) {
    return raw
  }

  const allowedSet = new Set(allowed)
  const filtered = raw.filter((option) => allowedSet.has(option.id))
  return filtered.length > 0 ? filtered : raw
}

export function resolveValidScoringPresetIdForSelection(
  currentScoringPresetId: string,
  input: ScoringSelection,
): string {
  const options = getScoringPresetOptionsForSelection(input)
  if (options.length === 0) {
    return resolveScoringPresetId(currentScoringPresetId, input)
  }

  const resolved = resolveScoringPresetId(currentScoringPresetId, input)
  if (options.some((option) => option.id === resolved)) {
    return resolved
  }

  return options[0]?.id ?? resolved
}

export function resolveValidDraftTypeForSelection(input: {
  leagueType: LeagueTypeId
  sport: SupportedSport
  idpSelected: boolean
  currentDraftType: WizardDraftTypeId | string
}): WizardDraftTypeId {
  const options = input.idpSelected
    ? getIdpDraftTypeOptions()
    : getDraftTypeOptions(input.leagueType, input.sport)

  if (options.some((option) => option.id === input.currentDraftType)) {
    return input.currentDraftType as WizardDraftTypeId
  }

  return options[0]?.id ?? 'snake'
}
