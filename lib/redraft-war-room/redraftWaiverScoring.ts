/**
 * REDRAFT WAIVER SCORING — pure, deterministic football logic. No AI, no LLM, no provider calls,
 * no fabricated data. Turns already-available signals (existing projection / ROS projection /
 * season average / ADP) + roster construction into a recommendation score, confidence, tier,
 * FAAB band, and priority guidance. Used by `redraftWaiverEngine`.
 *
 * Methodology (all bounded 0-100 unless noted):
 *  - valueScore: the player's value signal normalized to a position-aware fantasy-points cap
 *    (projection/ROS/season-avg), or an ADP-derived score when only ADP exists.
 *  - score = 0.55*valueScore + needBoost + scarcityBoost + byeBoost + injuryReplacementBoost,
 *    clamped 0-100.
 *  - confidence: derived from the data quality behind the value (projection confidence level,
 *    ADP-only, or no signal), reduced for NCAAF limited data and for non-healthy injury status.
 *  - tier: from score, but CAPPED at "Worth Considering" when confidence is low (never present a
 *    Must/Strong Add on weak data).
 *  - FAAB band + priority guidance: a deterministic function of tier + critical need + scarcity.
 */

import type { ValueSource } from './playerValue'

export type WaiverTier = 'Must Add' | 'Strong Add' | 'Worth Considering' | 'Watch List' | 'Low Priority'
export type FaabBand = '1–3%' | '3–5%' | '5–10%' | '10–15%' | '15%+'
export type PriorityGuidance = 'use_now' | 'medium' | 'hold'
export type ConfidenceLevel = 'high' | 'medium' | 'low'

const FAAB_BANDS: FaabBand[] = ['1–3%', '3–5%', '5–10%', '10–15%', '15%+']
/** Midpoint of each band as a fraction of budget — used for the legacy numeric bid suggestion. */
const FAAB_BAND_MIDPOINT: Record<FaabBand, number> = {
  '1–3%': 0.02,
  '3–5%': 0.04,
  '5–10%': 0.075,
  '10–15%': 0.125,
  '15%+': 0.18,
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n))
}

/** Position-aware fantasy-points cap for normalizing a value to 0-100. */
function pointsCap(position: string): number {
  switch (position.toUpperCase()) {
    case 'QB':
      return 28
    case 'RB':
    case 'WR':
    case 'FLEX':
      return 22
    case 'TE':
      return 14
    case 'K':
    case 'DST':
    case 'DEF':
      return 12
    default:
      return 18
  }
}

/** Positional scarcity weight (deterministic heuristic; RB/TE are the scarce redraft spots). */
export function scarcityWeight(position: string): number {
  switch (position.toUpperCase()) {
    case 'RB':
      return 8
    case 'TE':
      return 6
    case 'QB':
      return 4
    case 'WR':
      return 3
    default:
      return 0
  }
}

export function isScarcePosition(position: string): boolean {
  return ['RB', 'TE'].includes(position.toUpperCase())
}

/** Normalize a player's value signal to a 0-100 value score. */
export function valueScoreFor(input: { value: number | null; source: ValueSource; position: string; adp: number | null }): number {
  const { value, source, position, adp } = input
  if (source === 'adp' && adp != null) {
    // Lower ADP = more valued. ADP 1 ≈ 99, 100 ≈ 71, 200 ≈ 43, 300+ ≈ 14.
    return clamp(100 * (1 - Math.min(adp, 300) / 350))
  }
  if (value != null && (source === 'projection' || source === 'ros_projection' || source === 'season_avg')) {
    return clamp((value / pointsCap(position)) * 100)
  }
  return 0
}

interface ScoreInput {
  valueScore: number
  position: string
  /** Need severity for this position from the team-needs engine. */
  needSeverity: 'critical' | 'high' | 'moderate' | null
  /** True when the team has bench depth weakness (not a hard need) at this position. */
  depthWeakness: boolean
  /** This add would cover a starter currently injured at the position. */
  injuryReplacement: boolean
  /** This add helps a bye-week stack the team carries. */
  byeCoverage: boolean
}

export function recommendationScore(input: ScoreInput): number {
  let score = 0.55 * input.valueScore
  if (input.needSeverity === 'critical') score += 25
  else if (input.needSeverity === 'high') score += 15
  else if (input.needSeverity === 'moderate') score += 9
  else if (input.depthWeakness) score += 6
  score += scarcityWeight(input.position)
  if (input.injuryReplacement) score += 8
  if (input.byeCoverage) score += 5
  return Math.round(clamp(score))
}

interface ConfidenceInput {
  source: ValueSource
  projectionConfidenceLevel?: 'high' | 'medium' | 'low' | 'none' | null
  /** NCAAF (or any sport) projections unavailable / limited. */
  limitedData: boolean
  injured: boolean
}

export function computeConfidence(input: ConfidenceInput): { score: number; level: ConfidenceLevel } {
  let base: number
  if (input.source === 'projection' || input.source === 'ros_projection') {
    base = input.projectionConfidenceLevel === 'high' ? 85 : input.projectionConfidenceLevel === 'medium' ? 68 : input.projectionConfidenceLevel === 'low' ? 48 : 60
  } else if (input.source === 'season_avg') {
    base = 58
  } else if (input.source === 'adp') {
    base = 52
  } else {
    base = 22 // no value signal
  }
  if (input.limitedData) base -= 20
  if (input.injured) base -= 10
  const score = Math.round(clamp(base, 10, 95))
  const level: ConfidenceLevel = score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low'
  return { score, level }
}

export function tierFromScore(score: number, confidence: ConfidenceLevel): WaiverTier {
  let tier: WaiverTier
  if (score >= 80) tier = 'Must Add'
  else if (score >= 65) tier = 'Strong Add'
  else if (score >= 45) tier = 'Worth Considering'
  else if (score >= 25) tier = 'Watch List'
  else tier = 'Low Priority'
  // Never surface a Must/Strong Add on low-confidence data.
  if (confidence === 'low' && (tier === 'Must Add' || tier === 'Strong Add')) tier = 'Worth Considering'
  return tier
}

export function faabBandForTier(tier: WaiverTier, opts: { criticalNeed: boolean; scarce: boolean }): FaabBand {
  const baseIndex: Record<WaiverTier, number> = {
    'Low Priority': 0,
    'Watch List': 1,
    'Worth Considering': 2,
    'Strong Add': 3,
    'Must Add': 4,
  }
  let idx = baseIndex[tier]
  if (opts.criticalNeed && opts.scarce) idx = Math.min(FAAB_BANDS.length - 1, idx + 1)
  return FAAB_BANDS[idx]
}

/** Numeric bid suggestion from a band midpoint × budget (legacy/compat field). */
export function faabBidFromBand(band: FaabBand, faabBudget: number | null): number | null {
  if (faabBudget == null || faabBudget <= 0) return null
  return Math.max(1, Math.round(faabBudget * FAAB_BAND_MIDPOINT[band]))
}

export function priorityGuidanceForTier(tier: WaiverTier, criticalNeed: boolean): PriorityGuidance {
  if (tier === 'Must Add' || criticalNeed) return 'use_now'
  if (tier === 'Strong Add') return 'medium'
  return 'hold'
}

export const PRIORITY_GUIDANCE_LABEL: Record<PriorityGuidance, string> = {
  use_now: 'Use priority now',
  medium: 'Medium urgency',
  hold: 'Hold priority',
}
