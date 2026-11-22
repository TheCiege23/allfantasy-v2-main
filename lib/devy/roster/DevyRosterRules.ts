/**
 * Devy Dynasty roster rules: lineup legality, devy slots, taxi, reserve. PROMPT 2/6.
 * Deterministic: devy college players do NOT score until promoted.
 */

import type { DevyLeagueConfigShape, DevySportAdapterId } from '../types'
import {
  DEFAULT_DEVY_SLOTS_NFL,
  DEFAULT_DEVY_SLOTS_NBA,
  DEFAULT_TAXI_NFL,
  DEFAULT_TAXI_NBA,
} from '../constants'

export interface RosterSlotConstraint {
  slotName: string
  slotType: 'starter' | 'bench' | 'ir' | 'taxi' | 'devy'
  maxCount: number
  /** Devy slots accept only devy-eligible (college) players who have not graduated. */
  devyOnly?: boolean
  /** Taxi slots typically accept rookies or devy; rules are league-specific. */
  taxiEligible?: boolean
}

export interface LineupLegalityResult {
  legal: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validate that a roster respects devy slot constraints.
 * - Devy slots: only devy-eligible, non-graduated players.
 * - Starters/bench: pro (veteran or graduated) only for scoring; devy players in devy slots do not score.
 */
export function validateDevyRosterSlots(args: {
  config: DevyLeagueConfigShape
  devySlotCount: number
  /** Count of players currently in devy slots that are devy-eligible and not graduated. */
  devySlotsFilled: number
  /** Count of players in devy slots that are graduated (illegal). */
  devySlotsGraduated: number
}): LineupLegalityResult {
  const { devySlotCount, devySlotsFilled, devySlotsGraduated } = args
  const errors: string[] = []
  const warnings: string[] = []

  if (devySlotsGraduated > 0) {
    errors.push(`Devy slots must not contain graduated players. Move ${devySlotsGraduated} to active/bench.`)
  }

  if (devySlotsFilled > devySlotCount) {
    errors.push(`Devy slots overflow: ${devySlotsFilled} devy players but only ${devySlotCount} devy slots.`)
  }

  return {
    legal: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Devy players do not score until promoted (graduated to pro).
 * Use this when computing best ball or lineup optimization: exclude devy-only players from scoring.
 */
export function isEligibleToScore(isDevyPlayer: boolean, isGraduated: boolean): boolean {
  if (!isDevyPlayer) return true
  return isGraduated
}

/**
 * Resolve effective devy slot count from config (commissioner setting).
 */
export function getDevySlotCount(config: DevyLeagueConfigShape): number {
  return config.devySlotCount
}

/**
 * Resolve effective taxi size from config.
 */
export function getTaxiSize(config: DevyLeagueConfigShape): number {
  return config.taxiSize
}

// ─── Taxi eligibility ────────────────────────────────────────────────────────

export interface TaxiEligibilityResult {
  eligible: boolean
  reason?: string
}

/**
 * Check whether a player may occupy a taxi slot.
 * Taxi is for: (a) pro players in their first or second year in the league, OR
 * (b) players promoted from devy who just entered the pro pool.
 * `leagueYear` is the league's current season integer.
 * `playerProEntryYear` is the year the player first appeared in the pro league (draft class year).
 * `isDevyPromoted` is true if the player was promoted from a devy slot.
 * Commissioner may allow 2 years on taxi via `taxiYears` config field.
 */
export function validateTaxiEligibility(args: {
  playerProEntryYear: number
  leagueYear: number
  /** Whether player was elevated from a devy slot via promotion. */
  isDevyPromoted: boolean
  /** Commissioner-configured max years a player may remain on taxi (default 1). */
  taxiYears?: number
}): TaxiEligibilityResult {
  const { playerProEntryYear, leagueYear, taxiYears = 1 } = args
  const yearsInPro = leagueYear - playerProEntryYear
  // Always eligible in the entry year (year 0)
  if (yearsInPro < 0) {
    return { eligible: false, reason: 'Player has not yet entered the pro pool.' }
  }
  // Devy-promoted count their promotion year as year 0
  const maxYears = taxiYears
  if (yearsInPro <= maxYears) {
    return { eligible: true }
  }
  return {
    eligible: false,
    reason: `Player has been in the pro pool for ${yearsInPro} year(s); taxi limit is ${maxYears}.`,
  }
}

// ─── Full lineup legality ────────────────────────────────────────────────────

export interface LineupSlotFill {
  /** Slot category being checked. */
  slotType: 'starter' | 'flex' | 'bench' | 'ir' | 'taxi' | 'devy'
  /** Key matching DevyRosterSlot.slotKey (e.g. 'QB', 'RB', 'FLEX', 'SUPERFLEX', 'BN', 'IR', 'TAXI', 'DEVY'). */
  slotKey: string
  /** How many players the roster has in this slot. */
  filledCount: number
  /** Max allowed for this slot. */
  maxCount: number
}

/** Per-sport min starter counts for full lineup legality. */
const NFL_MIN_STARTERS: Record<string, number> = {
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2,
}
const NBA_MIN_STARTERS: Record<string, number> = {
  G: 2, F: 2, C: 1, FLEX: 2,
}

/** Per-sport max slot counts (including optional SUPERFLEX for NFL). */
export function getSlotMaxCounts(
  adapterId: DevySportAdapterId | 'NFL' | 'NBA',
  config: DevyLeagueConfigShape
): Record<string, number> {
  const isNba = adapterId === 'nba_devy' || adapterId === 'NBA'
  if (isNba) {
    return {
      G: 2, F: 2, C: 1, FLEX: 2,
      BN: 10,
      IR: 3,
      TAXI: config.taxiSize ?? DEFAULT_TAXI_NBA,
      DEVY: config.devySlotCount ?? DEFAULT_DEVY_SLOTS_NBA,
    }
  }
  // NFL
  const hasSuperFlex = !!(config as { bestBallSuperflex?: boolean }).bestBallSuperflex
  return {
    QB: 1,
    RB: 2,
    WR: 2,
    TE: 1,
    FLEX: 2,
    ...(hasSuperFlex ? { SUPERFLEX: 1 } : {}),
    BN: 12,
    IR: 3,
    TAXI: config.taxiSize ?? DEFAULT_TAXI_NFL,
    DEVY: config.devySlotCount ?? DEFAULT_DEVY_SLOTS_NFL,
  }
}

/**
 * Validate the full lineup for legality given per-sport slot rules.
 * @param adapterId - sport adapter ('nfl_devy' | 'nba_devy' | 'NFL' | 'NBA')
 * @param fills - actual fill counts per slot
 * @param config - current DeviLeagueConfigShape
 */
export function validateFullLineupLegality(
  adapterId: DevySportAdapterId | 'NFL' | 'NBA',
  fills: LineupSlotFill[],
  config: DevyLeagueConfigShape
): LineupLegalityResult {
  const errors: string[] = []
  const warnings: string[] = []
  const maxCounts = getSlotMaxCounts(adapterId, config)

  for (const fill of fills) {
    const max = maxCounts[fill.slotKey]
    if (max == null) {
      warnings.push(`Unknown slot key '${fill.slotKey}' — skipped.`)
      continue
    }
    if (fill.filledCount > max) {
      errors.push(`${fill.slotKey}: ${fill.filledCount} players exceeds max ${max}.`)
    }
  }

  // Check minimum starter requirements
  const isNba = adapterId === 'nba_devy' || adapterId === 'NBA'
  const minStarters = isNba ? NBA_MIN_STARTERS : NFL_MIN_STARTERS
  for (const [slotKey, minCount] of Object.entries(minStarters)) {
    const fill = fills.find((f) => f.slotKey === slotKey)
    const filled = fill?.filledCount ?? 0
    if (filled < minCount) {
      errors.push(`${slotKey}: requires at least ${minCount} player(s), found ${filled}.`)
    }
  }

  return { legal: errors.length === 0, errors, warnings }
}
