/**
 * League Settings Validation Engine.
 * Prevents invalid league configurations (e.g. auction without budgets, devy without slots, C2C without college pool).
 * Deterministic; no AI.
 */

import type { LeagueSettingsValidationResult } from './types'
import { DYNASTY_SUPPORTED_TEAM_SIZES } from '@/lib/dynasty-core/constants'
import {
  getLeagueFormatDefinition,
  isDraftTypeAllowedForFormat,
  isLeagueFormatAllowedForSport,
  resolveLeagueFormat,
} from '@/lib/league/format-engine'

/** Input may be League.settings (snake_case), wizard payload (camelCase), or partial. */
export type LeagueSettingsInput = Record<string, unknown>

function num(x: unknown): number | null {
  if (typeof x === 'number' && !Number.isNaN(x)) return x
  if (typeof x === 'string') {
    const n = Number(x)
    return !Number.isNaN(n) ? n : null
  }
  return null
}

function arrayOfNumbers(x: unknown): number[] {
  if (!Array.isArray(x)) return []
  return x.filter((v) => typeof v === 'number' && !Number.isNaN(v))
}

function readNumberFrom(input: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      const value = num(input[key])
      if (value != null) return value
    }
  }
  return null
}

/**
 * A draft type in the league format's own vocabulary. The devy and C2C formats list theirs as
 * specialty ids (`devy_snake` / `devy_linear` / `devy_auction`, `c2c_*` — lib/draft-types/
 * draftTypeRegistry.ts), but a saved league's draft config carries the ENGINE core (`snake` /
 * `linear` / `auction` — DraftRoomConfigResolver's normalizeDraftRuntimeType), and the base ids map
 * into the format's contract (docs/devy-defaults-nfl-ncaaf-audit.md, "Draft Types";
 * normalizeDevyDraftType / normalizeC2CDraftType). Without this, every Settings › Draft save on a
 * devy or C2C league failed with "snake draft is not valid for devy leagues".
 */
function draftTypeForFormatCheck(leagueType: string, draftType: string): string {
  const d = draftType.trim().toLowerCase()
  const format = getLeagueFormatDefinition(leagueType).id
  if ((format === 'devy' || format === 'c2c') && (d === 'snake' || d === 'linear' || d === 'auction')) {
    return `${format}_${d}`
  }
  return d
}

/**
 * Validate league/draft settings. Returns errors that block save; warnings are advisory.
 */
export function validateLeagueSettings(input: LeagueSettingsInput): LeagueSettingsValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const draftType = (input.draft_type ?? input.draftType ?? '') as string
  const leagueType = String(input.league_type ?? input.leagueType ?? '').toLowerCase()
  const leagueVariant = String(input.league_variant ?? input.leagueVariant ?? '').toLowerCase()
  const sport = String(input.sport ?? input.sport_type ?? 'NFL').toUpperCase()

  if (leagueType && !isLeagueFormatAllowedForSport(sport, leagueType)) {
    errors.push(`${leagueType} leagues are not available for ${sport}.`)
  }

  if (leagueType && draftType && !isDraftTypeAllowedForFormat(sport, leagueType, draftTypeForFormatCheck(leagueType, String(draftType)))) {
    errors.push(`${draftType} draft is not valid for ${leagueType} leagues.`)
  }

  if (!leagueType || !errors.length) {
    const resolution = resolveLeagueFormat({
      sport,
      leagueType: leagueType || 'redraft',
      draftType: draftType || 'snake',
      leagueVariant,
    })
    if (resolution.format.id === 'salary_cap') {
      const salaryCap = num(input.salary_cap ?? input.salaryCap ?? input.cap_limit ?? 0)
      if (salaryCap == null || salaryCap <= 0) {
        warnings.push('Salary cap leagues should set a positive cap limit in league settings.')
      }
    }
  }

  // --- Auction: draft_type === 'auction' requires a positive budget ---
  const auctionBudget =
    num(input.auction_budget_per_team) ??
    num(input.auctionBudgetPerTeam) ??
    (input.draftSettings && typeof input.draftSettings === 'object' && (input.draftSettings as Record<string, unknown>).auctionBudgetPerTeam != null
      ? num((input.draftSettings as Record<string, unknown>).auctionBudgetPerTeam)
      : null)
  if (String(draftType).toLowerCase() === 'auction') {
    if (auctionBudget == null || auctionBudget <= 0) {
      errors.push('Auction draft requires a positive budget per team (auction_budget_per_team or auctionBudgetPerTeam).')
    }
  }

  // --- Devy: league_type === 'devy' or devyConfig.enabled requires non-empty devy rounds/slots ---
  const devyConfig = input.devyConfig ?? input.devy_config
  const devyConfigObj =
    devyConfig && typeof devyConfig === 'object' ? (devyConfig as Record<string, unknown>) : null
  const devyRounds =
    Array.isArray(devyConfigObj?.devyRounds)
      ? (devyConfigObj.devyRounds as number[])
      : Array.isArray(devyConfigObj?.devy_rounds)
        ? (devyConfigObj.devy_rounds as number[])
        : input.draftSettings && typeof input.draftSettings === 'object'
          ? arrayOfNumbers((input.draftSettings as Record<string, unknown>).devyRounds)
          : arrayOfNumbers(input.devy_rounds ?? input.devyRounds)
  const devySlots =
    readNumberFrom(input, ['devy_slots', 'devySlots', 'devy_college_slots_creation']) ??
    (input.roster && typeof input.roster === 'object'
      ? readNumberFrom(input.roster as Record<string, unknown>, ['devy_slots', 'devySlots'])
      : null) ??
    (devyConfigObj
      ? readNumberFrom(devyConfigObj, ['slots', 'devySlots', 'devy_slots', 'poolSize'])
      : null)
  const isDevyLeague =
    String(leagueType).toLowerCase() === 'devy' ||
    leagueVariant === 'devy_dynasty' ||
    Boolean(devyConfigObj?.enabled)
  if (isDevyLeague) {
    const rounds = Array.isArray(devyRounds) ? devyRounds : []
    if (rounds.length === 0) {
      errors.push('Devy league requires at least one devy round (devyRounds / devy_rounds or devyConfig.devyRounds).')
    }
    if (devySlots == null || devySlots <= 0) {
      errors.push('Devy league requires at least one devy slot (devy_slots / devySlots or devyConfig.slots).')
    }
    const rosterModeDevy = (input.roster_mode ?? input.rosterMode ?? '') as string
    if (String(rosterModeDevy).toLowerCase() === 'redraft') {
      errors.push('Devy and Merged Devy / C2C are dynasty-only; they cannot be created as redraft.')
    }
  }

  // --- C2C: league_type === 'c2c' or c2cConfig.enabled requires non-empty college rounds/pool ---
  const c2cConfig = input.c2cConfig ?? input.c2c_config
  const c2cConfigObj =
    c2cConfig && typeof c2cConfig === 'object' ? (c2cConfig as Record<string, unknown>) : null
  const collegeRounds =
    Array.isArray(c2cConfigObj?.collegeRounds)
      ? (c2cConfigObj.collegeRounds as number[])
      : Array.isArray(c2cConfigObj?.college_rounds)
        ? (c2cConfigObj.college_rounds as number[])
        : input.draftSettings && typeof input.draftSettings === 'object'
          ? arrayOfNumbers((input.draftSettings as Record<string, unknown>).c2cCollegeRounds)
          : arrayOfNumbers(input.c2c_college_rounds ?? input.c2cCollegeRounds)
  const collegePoolSize =
    readNumberFrom(input, [
      'c2c_college_roster_size',
      'c2cCollegeRosterSize',
      'c2c_college_slots',
      'c2cCollegeSlots',
      'c2c_college_slots_creation',
      'college_pool_size',
      'collegePoolSize',
    ]) ??
    (c2cConfigObj
      ? readNumberFrom(c2cConfigObj, [
          'collegeRosterSize',
          'college_roster_size',
          'collegeSlots',
          'college_slots',
          'collegePoolSize',
          'college_pool_size',
        ])
      : null)
  const isC2CLeague =
    String(leagueType).toLowerCase() === 'c2c' ||
    leagueVariant === 'merged_devy_c2c' ||
    Boolean(c2cConfigObj?.enabled)
  if (isC2CLeague) {
    const rounds = Array.isArray(collegeRounds) ? collegeRounds : []
    if (rounds.length === 0) {
      errors.push('C2C league requires at least one college round (collegeRounds / c2cCollegeRounds or c2cConfig.collegeRounds).')
    }
    if (collegePoolSize == null || collegePoolSize <= 0) {
      errors.push('C2C league requires a college pool capacity (c2c_college_roster_size / c2cCollegeRosterSize or c2cConfig.collegeRosterSize).')
    }
    const rosterModeC2C = (input.roster_mode ?? input.rosterMode ?? '') as string
    if (String(rosterModeC2C).toLowerCase() === 'redraft') {
      errors.push('Devy and Merged Devy / C2C are dynasty-only; they cannot be created as redraft.')
    }
  }

  // --- Standard redraft: no dynasty-only features (devy, taxi) ---
  if (leagueType === 'redraft') {
    const taxiSlots = num(input.taxi_slots ?? input.taxiSlots ?? 0)
    if (taxiSlots != null && taxiSlots > 0) {
      errors.push('Standard redraft leagues do not support taxi slots. Use dynasty or keeper for taxi.')
    }
    if (isDevyLeague) {
      errors.push('Standard redraft leagues do not support devy. Use dynasty/devy league type for devy.')
    }
    if (isC2CLeague) {
      errors.push('Standard redraft leagues do not support C2C. Use C2C league type for campus-to-canton.')
    }
  }

  // --- Keeper: distinct from devy/C2C; no devy or C2C in keeper mode ---
  if (leagueType === 'keeper') {
    if (isDevyLeague) {
      errors.push('Keeper leagues do not support devy. Use Devy league type for devy.')
    }
    if (isC2CLeague) {
      errors.push('Keeper leagues do not support C2C. Use C2C league type for campus-to-canton.')
    }
  }

  // --- Dynasty: league size must be in supported team sizes (4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 32) ---
  const rosterMode = (input.roster_mode ?? input.rosterMode ?? '') as string
  const leagueSize = num(input.league_size ?? input.leagueSize ?? input.leagueSize)
  const isDynasty =
    String(rosterMode).toLowerCase() === 'dynasty' ||
    String(leagueType).toLowerCase() === 'dynasty' ||
    String(leagueType).toLowerCase() === 'devy' ||
    isDevyLeague ||
    isC2CLeague
  if (isDynasty && leagueSize != null) {
    if (!(DYNASTY_SUPPORTED_TEAM_SIZES as readonly number[]).includes(leagueSize)) {
      errors.push(
        `Dynasty league size must be one of: ${(DYNASTY_SUPPORTED_TEAM_SIZES as readonly number[]).join(', ')}.`
      )
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Alias for validateLeagueSettings (LeagueSettingsValidator entry point).
 */
export function validate(input: LeagueSettingsInput): LeagueSettingsValidationResult {
  return validateLeagueSettings(input)
}

/**
 * OO entry-point for callers that prefer explicit validator service naming.
 */
export class LeagueSettingsValidator {
  static validate(input: LeagueSettingsInput): LeagueSettingsValidationResult {
    return validateLeagueSettings(input)
  }
}
