/**
 * Guillotine league creation and settings validation.
 * Deterministic: valid team count by sport, roster mode (redraft/best_ball only), draft types.
 * Uses sport schedule template for non-NFL team-count math.
 */

import type { LeagueSport } from '@prisma/client'
import { getScheduleTemplate } from '@/lib/sport-defaults/ScheduleTemplateResolver'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { toSportType } from '@/lib/sport-defaults/sport-type-utils'
import type { SportType } from '@/lib/sport-defaults/types'

/** Roster modes allowed for Guillotine (no dynasty/devy/keeper as base). */
export const GUILLOTINE_ALLOWED_ROSTER_MODES = ['redraft', 'best_ball'] as const
export type GuillotineRosterMode = (typeof GUILLOTINE_ALLOWED_ROSTER_MODES)[number]

/** Draft types allowed for Guillotine (snake, linear, auction; 3RR only for snake). */
export const GUILLOTINE_DRAFT_TYPES = ['snake', 'linear', 'auction'] as const

import {
  GUILLOTINE_MAX_TEAMS,
  GUILLOTINE_MIN_TEAMS,
  GUILLOTINE_SINGLE_ELIMINATION_MAX_TEAMS,
} from './teamCountLimits'

export interface ValidTeamCountRange {
  min: number
  max: number
  /** Largest league that finishes with one chop per week; above it needs double-elimination weeks. */
  singleEliminationMax: number
  /** When true, double (or more) eliminations per period may be needed for large leagues. */
  supportsDoubleElimination: boolean
}

/**
 * Get valid Guilly team count range. Same for every sport: 4–27 with single elimination,
 * up to 35 when the commissioner adds double-elimination weeks (see ./teamCountLimits.ts).
 */
export async function getValidGuillotineTeamCountRange(
  _sport: LeagueSport | string
): Promise<ValidTeamCountRange> {
  return {
    min: GUILLOTINE_MIN_TEAMS,
    max: GUILLOTINE_MAX_TEAMS,
    singleEliminationMax: GUILLOTINE_SINGLE_ELIMINATION_MAX_TEAMS,
    supportsDoubleElimination: true,
  }
}

/**
 * Normalize roster mode string to allowed Guillotine value. Accepts "bestball" or "best_ball".
 */
export function normalizeGuillotineRosterMode(mode: string | null | undefined): GuillotineRosterMode {
  if (!mode || typeof mode !== 'string') return 'redraft'
  const s = mode.toLowerCase().trim()
  if (s === 'best_ball' || s === 'bestball') return 'best_ball'
  if (s === 'redraft') return 'redraft'
  return 'redraft'
}

/**
 * Check if roster mode is allowed for Guillotine (redraft or best_ball only).
 * Accepts "bestball" as equivalent to "best_ball".
 */
export function isAllowedRosterModeForGuillotine(mode: string | null | undefined): mode is GuillotineRosterMode {
  if (!mode || typeof mode !== 'string') return false
  const s = mode.toLowerCase().trim()
  if (s === 'bestball' || s === 'best_ball') return true
  if (s === 'redraft') return true
  return false
}

/**
 * Get allowed draft types for Guillotine. Returns snake and auction.
 * 3RR applies only to snake (enforced in UI/settings).
 */
export function getAllowedDraftTypesForGuillotine(): readonly string[] {
  return [...GUILLOTINE_DRAFT_TYPES]
}

/**
 * Check if draft type is allowed for Guillotine.
 */
export function isAllowedDraftTypeForGuillotine(draftType: string | null | undefined): boolean {
  if (!draftType || typeof draftType !== 'string') return false
  return GUILLOTINE_DRAFT_TYPES.includes(draftType.toLowerCase().trim() as (typeof GUILLOTINE_DRAFT_TYPES)[number])
}

/**
 * Check if sport supports Guillotine (has schedule template and is supported).
 */
export function isSportSupportedForGuillotine(sport: LeagueSport | string): boolean {
  const s = String(sport).toUpperCase()
  return SUPPORTED_SPORTS.includes(s as LeagueSport)
}

/**
 * Validate that the final elimination week lands in the last two weeks of
 * the sport's regular season. Prevents the commissioner from scheduling the
 * final too early (leaving orphaned weeks) or past season end.
 */
export async function validateGuillotineFinalWeek(
  sport: LeagueSport | string,
  eliminationEndWeek: number,
): Promise<{ ok: true } | { ok: false; error: string; regularSeasonWeeks: number }> {
  const sportType = toSportType(sport as LeagueSport) as SportType
  const template = await getScheduleTemplate(sportType, 'DEFAULT')
  const weeks = template.regularSeasonWeeks ?? 17
  if (eliminationEndWeek > weeks) {
    return {
      ok: false,
      error: `eliminationEndWeek (${eliminationEndWeek}) exceeds regular season length (${weeks}).`,
      regularSeasonWeeks: weeks,
    }
  }
  if (eliminationEndWeek < weeks - 1) {
    return {
      ok: false,
      error: `eliminationEndWeek (${eliminationEndWeek}) must be within the last two weeks of the regular season (>= ${weeks - 1}).`,
      regularSeasonWeeks: weeks,
    }
  }
  return { ok: true }
}

export interface ValidateGuillotineCreationInput {
  sport: LeagueSport | string
  teamCount: number
  rosterMode?: string | null
  draftType?: string | null
}

export interface ValidateGuillotineCreationResult {
  valid: boolean
  error?: string
  teamCountRange?: ValidTeamCountRange
}

/**
 * Validate Guillotine league creation inputs (team count, roster mode, draft type).
 * Call before creating a league with leagueVariant guillotine.
 */
export async function validateGuillotineCreation(
  input: ValidateGuillotineCreationInput
): Promise<ValidateGuillotineCreationResult> {
  const { sport, teamCount, rosterMode, draftType } = input

  if (!isSportSupportedForGuillotine(sport)) {
    return { valid: false, error: 'This sport is not supported for Guilly leagues.' }
  }

  const range = await getValidGuillotineTeamCountRange(sport)
  if (teamCount < range.min || teamCount > range.max) {
    return {
      valid: false,
      error: `Guilly leagues support ${range.min}–${range.singleEliminationMax} teams, or up to ${range.max} with double-elimination weeks.`,
      teamCountRange: range,
    }
  }

  const effectiveRosterMode = (rosterMode ?? 'redraft').toString().toLowerCase().trim()
  if (!isAllowedRosterModeForGuillotine(effectiveRosterMode)) {
    return {
      valid: false,
      error: 'Guilly leagues support only Redraft or Best Ball. Dynasty, Keeper, and Devy are not supported.',
    }
  }

  if (draftType != null && draftType !== '') {
    if (!isAllowedDraftTypeForGuillotine(draftType)) {
      return {
        valid: false,
        error: 'Guilly supports Snake, Linear, or Auction draft only.',
      }
    }
  }

  return { valid: true, teamCountRange: range }
}
