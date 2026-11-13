/**
 * lib/engine/multi-factor-valuation.ts
 * Multi-factor player valuation model — 7 weighted components.
 *
 * VALUE =
 *   (MarketValue × 0.35) +
 *   (VORP × 0.20) +
 *   (TeamImpact × 0.15) +
 *   (ConsistencyScore × 0.10) +
 *   (UsageTrend × 0.10) +
 *   (MatchupStrength × 0.05) +
 *   (HistoricalPerformance × 0.05)
 *
 * Performance target: <10ms per player.
 */

import type { SportKey } from './trade-types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlayerValuationInput {
  name: string
  position: string
  sport: SportKey
  age?: number
  team?: string

  // Factor inputs (all on 0–1000 internal scale)
  marketValue: number
  vorpValue: number

  // Team context
  teamImpact?: number // How much the player moves the needle for THIS team

  // Performance factors
  consistencyScore?: number // 0–100: low variance = high consistency
  usageTrend?: number // 0–100: rising usage = higher value
  matchupStrength?: number // 0–100: upcoming matchup favorability
  historicalPerformance?: number // 0–100: career track record
}

interface PlayerValuationResult {
  totalValue: number // 0–1000 composite
  factors: {
    marketValue: { raw: number; weighted: number; weight: number }
    vorp: { raw: number; weighted: number; weight: number }
    teamImpact: { raw: number; weighted: number; weight: number }
    consistency: { raw: number; weighted: number; weight: number }
    usageTrend: { raw: number; weighted: number; weight: number }
    matchupStrength: { raw: number; weighted: number; weight: number }
    historicalPerformance: { raw: number; weighted: number; weight: number }
  }
  confidence: 'high' | 'medium' | 'low'
}

// ---------------------------------------------------------------------------
// Factor weights
// ---------------------------------------------------------------------------

const FACTOR_WEIGHTS = {
  marketValue: 0.35,
  vorp: 0.20,
  teamImpact: 0.15,
  consistency: 0.10,
  usageTrend: 0.10,
  matchupStrength: 0.05,
  historicalPerformance: 0.05,
} as const

// ---------------------------------------------------------------------------
// Sport-specific age peaks for historical performance weighting
// ---------------------------------------------------------------------------

const SPORT_AGE_PEAKS: Record<string, Record<string, number>> = {
  NFL: { QB: 30, RB: 25, WR: 27, TE: 28, K: 32, DEF: 28, DL: 27, LB: 27, DB: 27 },
  NBA: { PG: 28, SG: 27, SF: 27, PF: 28, C: 28 },
  MLB: { SP: 28, RP: 29, C: 28, '1B': 29, '2B': 28, SS: 27, '3B': 28, OF: 28, DH: 30 },
  NHL: { C: 27, LW: 27, RW: 27, D: 28, G: 29 },
  NCAAF: { QB: 22, RB: 21, WR: 22, TE: 22 },
  NCAAB: { PG: 22, SG: 22, SF: 22, PF: 22, C: 22 },
  SOCCER: { FW: 27, MF: 28, DF: 29, GK: 30 },
}

// ---------------------------------------------------------------------------
// Core valuation function
// ---------------------------------------------------------------------------

/**
 * Compute multi-factor player valuation.
 * All factor inputs should be on 0–1000 scale (marketValue, vorp) or 0–100 scale
 * (consistency, usage, matchup, historical). TeamImpact is 0–1000.
 */
export function computeMultiFactorValue(input: PlayerValuationInput): PlayerValuationResult {
  // Normalize all factors to 0–1000 scale
  const mv = clamp(input.marketValue, 0, 1000)
  const vorp = clamp(input.vorpValue, 0, 1000)
  const ti = clamp(input.teamImpact ?? estimateTeamImpact(input), 0, 1000)
  const cons = clamp((input.consistencyScore ?? 50) * 10, 0, 1000) // 0-100 → 0-1000
  const usage = clamp((input.usageTrend ?? 50) * 10, 0, 1000)
  const matchup = clamp((input.matchupStrength ?? 50) * 10, 0, 1000)
  const hist = clamp((input.historicalPerformance ?? computeHistoricalFactor(input)) * 10, 0, 1000)

  // Weighted sum
  const weighted = {
    marketValue: mv * FACTOR_WEIGHTS.marketValue,
    vorp: vorp * FACTOR_WEIGHTS.vorp,
    teamImpact: ti * FACTOR_WEIGHTS.teamImpact,
    consistency: cons * FACTOR_WEIGHTS.consistency,
    usageTrend: usage * FACTOR_WEIGHTS.usageTrend,
    matchupStrength: matchup * FACTOR_WEIGHTS.matchupStrength,
    historicalPerformance: hist * FACTOR_WEIGHTS.historicalPerformance,
  }

  const totalValue = Math.round(
    weighted.marketValue +
    weighted.vorp +
    weighted.teamImpact +
    weighted.consistency +
    weighted.usageTrend +
    weighted.matchupStrength +
    weighted.historicalPerformance
  )

  // Confidence based on how many factors we had real data for
  const factorsWithData = [
    input.marketValue > 0,
    input.vorpValue > 0,
    input.teamImpact != null,
    input.consistencyScore != null,
    input.usageTrend != null,
    input.matchupStrength != null,
    input.historicalPerformance != null,
  ].filter(Boolean).length

  const confidence: 'high' | 'medium' | 'low' =
    factorsWithData >= 5 ? 'high' : factorsWithData >= 3 ? 'medium' : 'low'

  return {
    totalValue: clamp(totalValue, 0, 1000),
    factors: {
      marketValue: { raw: mv, weighted: Math.round(weighted.marketValue), weight: FACTOR_WEIGHTS.marketValue },
      vorp: { raw: vorp, weighted: Math.round(weighted.vorp), weight: FACTOR_WEIGHTS.vorp },
      teamImpact: { raw: ti, weighted: Math.round(weighted.teamImpact), weight: FACTOR_WEIGHTS.teamImpact },
      consistency: { raw: cons, weighted: Math.round(weighted.consistency), weight: FACTOR_WEIGHTS.consistency },
      usageTrend: { raw: usage, weighted: Math.round(weighted.usageTrend), weight: FACTOR_WEIGHTS.usageTrend },
      matchupStrength: { raw: matchup, weighted: Math.round(weighted.matchupStrength), weight: FACTOR_WEIGHTS.matchupStrength },
      historicalPerformance: { raw: hist, weighted: Math.round(weighted.historicalPerformance), weight: FACTOR_WEIGHTS.historicalPerformance },
    },
    confidence,
  }
}

// ---------------------------------------------------------------------------
// Derived factor estimators (when raw data not available)
// ---------------------------------------------------------------------------

/**
 * Estimate team impact from position scarcity and roster context.
 */
function estimateTeamImpact(input: PlayerValuationInput): number {
  // Proxy: market value weighted by position scarcity
  const posScarcity: Record<string, number> = {
    QB: 0.90, RB: 0.80, WR: 0.75, TE: 0.60,
    PG: 0.85, SG: 0.80, SF: 0.80, PF: 0.75, C: 0.70,
    SP: 0.90, RP: 0.50, SS: 0.75, OF: 0.65,
    FW: 0.85, MF: 0.80, DF: 0.60, GK: 0.45,
  }
  const scarcity = posScarcity[input.position] ?? 0.70
  return Math.round(input.marketValue * scarcity)
}

/**
 * Compute historical performance factor from age curve.
 * Players near peak age get higher scores; those past peak get lower.
 */
function computeHistoricalFactor(input: PlayerValuationInput): number {
  if (!input.age) return 50 // Default to neutral

  const sportPeaks = SPORT_AGE_PEAKS[input.sport] ?? SPORT_AGE_PEAKS.NFL
  const peakAge = sportPeaks[input.position] ?? 27

  const ageDiff = input.age - peakAge
  if (ageDiff <= -3) return 40 // Young, unproven
  if (ageDiff <= 0) return 70 // Approaching or at peak
  if (ageDiff <= 2) return 55 // Just past peak
  if (ageDiff <= 4) return 35 // Declining
  return 20 // Well past peak
}

// ---------------------------------------------------------------------------
// Batch valuation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export { FACTOR_WEIGHTS, SPORT_AGE_PEAKS }
