/**
 * Product team-count rules for Create League v2 + canonical validation.
 * Single source of truth: concept + sport (+ optional draftType overrides).
 */

import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import type { SupportedSport } from '@/lib/create-league-v2/state'

/** Concepts that participate in team-count selection (IDP is separate from `redraft` leagueType). */
export type TeamCountConcept =
  | 'redraft'
  | 'dynasty'
  | 'keeper'
  | 'best_ball'
  | 'idp'
  | 'salary_cap'
  | 'devy'
  | 'c2c'
  | 'guillotine'
  | 'zombie'
  | 'survivor'
  | 'tournament'
  | 'big_brother'

export type TeamCountSelectionInput = {
  concept: TeamCountConcept
  sport: SupportedSport
  draftType?: string | null
  /** Reserved for future soccer pipeline-specific caps; currently unused for counts. */
  soccerPipeline?: 'mls' | 'euro' | null
}

const REDRAFT_MAJOR = [4, 6, 8, 10, 12, 14, 16, 18, 20] as const
const REDRAFT_COLLEGE = [4, 6, 8, 10, 12, 14, 16, 20, 24, 28] as const

const DYNASTY_NCAAF_TIERS = [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 64, 96, 128, 134] as const
const DYNASTY_NCAAB_TIERS = [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 64, 96, 128, 160, 192, 256, 320, 364] as const
const DYNASTY_SOCCER_TIERS = [4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40] as const

const GUILLOTINE_OPTIONS = [12, 14, 16, 18, 20, 22] as const

const GUILLOTINE_DEFAULT_BY_SPORT: Partial<Record<SupportedSport, number>> = {
  NFL: 18,
  NCAAF: 16,
  NBA: 20,
  MLB: 22,
  NHL: 20,
  NCAAB: 20,
  SOCCER: 20,
}

const TOURNAMENT_POOL_SIZES = [32, 64, 96, 128, 160, 192, 224] as const

const CONCEPT_LABELS: Record<TeamCountConcept, string> = {
  redraft: 'Redraft',
  dynasty: 'Dynasty',
  keeper: 'Keeper',
  best_ball: 'Best Ball',
  idp: 'IDP',
  salary_cap: 'Salary Cap',
  devy: 'Devy',
  c2c: 'C2C',
  guillotine: 'Guillotine',
  zombie: 'Zombie',
  survivor: 'Survivor',
  tournament: 'Tournament',
  big_brother: 'Big Brother',
}

/**
 * Future: per-draft overrides without changing call sites.
 * Shape: concept → sport → normalizedDraftKey → allowed sizes.
 */
export const TEAM_COUNT_DRAFT_OVERRIDES: Partial<
  Record<TeamCountConcept, Partial<Record<SupportedSport, Partial<Record<string, readonly number[]>>>>>
> = {}

export function normalizeDraftTypeForTeamCount(draftType: string | null | undefined): string {
  const s = String(draftType ?? 'snake').toLowerCase()
  if (s.includes('auction')) return 'auction'
  if (s.includes('linear')) return 'linear'
  if (s.includes('snake') || s.includes('slow') || s.includes('mock')) return 'snake'
  return s
}

function evenRange(from: number, to: number): number[] {
  const out: number[] = []
  for (let n = from; n <= to; n += 2) out.push(n)
  return out
}

function redraftLikeOptions(sport: SupportedSport): number[] {
  switch (sport) {
    case 'NCAAF':
    case 'NCAAB':
      return [...REDRAFT_COLLEGE]
    default:
      return [...REDRAFT_MAJOR]
  }
}

function dynastyFamilyOptions(sport: SupportedSport): number[] {
  switch (sport) {
    case 'NFL':
      return evenRange(4, 32)
    case 'NBA':
    case 'MLB':
      return evenRange(4, 30)
    case 'NHL':
      return evenRange(4, 32)
    case 'NCAAF':
      return [...DYNASTY_NCAAF_TIERS]
    case 'NCAAB':
      return [...DYNASTY_NCAAB_TIERS]
    case 'SOCCER':
      return [...DYNASTY_SOCCER_TIERS]
    default:
      return evenRange(4, 32)
  }
}

function zombieOptions(sport: SupportedSport): number[] {
  switch (sport) {
    case 'NFL':
    case 'NBA':
    case 'MLB':
    case 'NHL':
    case 'SOCCER':
      return [16, 18, 20, 22, 24]
    case 'NCAAF':
      return [16, 20, 24, 28, 32, 40]
    case 'NCAAB':
      return [16, 20, 24, 28, 32, 40, 48, 64]
    default:
      return [16, 18, 20, 22, 24]
  }
}

function survivorOptions(sport: SupportedSport): number[] {
  switch (sport) {
    case 'NFL':
    case 'NBA':
    case 'MLB':
    case 'NHL':
    case 'SOCCER':
      return [12, 15, 16, 20, 24]
    case 'NCAAF':
      return [12, 15, 16, 20, 24, 28, 32]
    case 'NCAAB':
      return [12, 15, 16, 20, 24, 28, 32, 40]
    default:
      return [12, 15, 16, 20, 24]
  }
}

function bigBrotherOptions(sport: SupportedSport): number[] {
  switch (sport) {
    case 'NFL':
    case 'NCAAF':
      return [12, 14, 16, 18]
    case 'NBA':
    case 'MLB':
    case 'NHL':
    case 'NCAAB':
      return [14, 16, 18, 20, 22, 24]
    case 'SOCCER':
      return [12, 14, 16, 18, 20]
    default:
      return [12, 14, 16, 18]
  }
}

function baseOptionsForConcept(concept: TeamCountConcept, sport: SupportedSport): number[] {
  switch (concept) {
    case 'redraft':
    case 'keeper':
    case 'best_ball':
      return redraftLikeOptions(sport)
    case 'dynasty':
    case 'idp':
    case 'salary_cap':
    case 'devy':
    case 'c2c':
      return dynastyFamilyOptions(sport)
    case 'guillotine':
      return [...GUILLOTINE_OPTIONS]
    case 'zombie':
      return zombieOptions(sport)
    case 'survivor':
      return survivorOptions(sport)
    case 'tournament':
      return [...TOURNAMENT_POOL_SIZES]
    case 'big_brother':
      return bigBrotherOptions(sport)
    default:
      return redraftLikeOptions(sport)
  }
}

function applyDraftOverrides(base: number[], input: TeamCountSelectionInput): number[] {
  const draftKey = normalizeDraftTypeForTeamCount(input.draftType)
  const row = TEAM_COUNT_DRAFT_OVERRIDES[input.concept]?.[input.sport]?.[draftKey]
  if (row && row.length > 0) return [...row]
  return base
}

export function getTeamCountOptionsForSelection(input: TeamCountSelectionInput): number[] {
  const base = baseOptionsForConcept(input.concept, input.sport)
  return applyDraftOverrides(base, input)
}

function pickDefault(concept: TeamCountConcept, sport: SupportedSport, opts: number[]): number {
  if (opts.length === 0) return 12

  switch (concept) {
    case 'survivor':
      if (opts.includes(16)) return 16
      if (opts.includes(20)) return 20
      break
    case 'guillotine': {
      const g = GUILLOTINE_DEFAULT_BY_SPORT[sport]
      if (g !== undefined && opts.includes(g)) return g
      break
    }
    case 'tournament':
      if (opts.includes(32)) return 32
      break
    case 'big_brother':
      if (opts.includes(16)) return 16
      if (opts.includes(14)) return 14
      break
    default:
      if (opts.includes(12)) return 12
  }

  return opts[Math.floor(opts.length / 2)] ?? opts[0]!
}

export function getDefaultTeamCountForSelection(input: TeamCountSelectionInput): number {
  const opts = getTeamCountOptionsForSelection(input)
  return pickDefault(input.concept, input.sport, opts)
}

export function isTeamCountAllowedForSelection(
  input: TeamCountSelectionInput & { teamCount: number },
): boolean {
  return getTeamCountOptionsForSelection(input).includes(input.teamCount)
}

/** Maps wizard league type + IDP flag → team-count concept (IDP uses dynasty-family sizes). */
export function resolveTeamCountConcept(leagueType: LeagueTypeId, idpSelected: boolean): TeamCountConcept {
  if (idpSelected) return 'idp'
  return leagueType as TeamCountConcept
}

export function formatTeamCountRejectedMessage(params: {
  teamCount: number
  concept: TeamCountConcept
  sport: SupportedSport
  draftType: string
  allowed: number[]
}): string {
  const label = CONCEPT_LABELS[params.concept] ?? params.concept
  const draft = String(params.draftType || 'snake')
  return `Team count ${params.teamCount} is not allowed for ${label} ${params.sport} ${draft} leagues. Allowed values: ${params.allowed.join(', ')}`
}
