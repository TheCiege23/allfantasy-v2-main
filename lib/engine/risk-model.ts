/**
 * lib/engine/risk-model.ts
 * Risk model — SEPARATE from value. 6-factor risk score (0–1 scale).
 *
 * RISK SCORE includes:
 * - Injury probability (API + history)
 * - Age curve decay (sport-specific)
 * - Position volatility (RB > WR > QB etc.)
 * - Depth chart risk
 * - Coaching/system changes
 * - News sentiment (negative spike → increase risk)
 *
 * FINAL: FinalTradeValue = VALUE - (RISK × 0.25 × VALUE)
 *
 * Performance target: <3ms per player.
 */

import type { SportKey } from './trade-types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskInput {
  name: string
  position: string
  sport: SportKey
  age?: number

  // Injury
  injuryStatus?: string // 'healthy' | 'questionable' | 'doubtful' | 'out' | 'ir' | 'pup'
  injuryHistoryScore?: number // 0–100: higher = more injury-prone
  expectedReturnWeeks?: number

  // Depth chart
  depthChartPosition?: number // 1 = starter, 2 = backup, etc.
  snapPercentage?: number // 0–100

  // Coaching
  coachingChange?: boolean
  systemChange?: boolean
  newTeam?: boolean

  // Sentiment
  newsSentiment?: number // -100 to +100 (negative = bad news)
}

interface RiskResult {
  totalRisk: number // 0–1 scale
  factors: {
    injury: number // 0–1
    ageCurve: number // 0–1
    positionVolatility: number // 0–1
    depthChart: number // 0–1
    coachingSystem: number // 0–1
    newsSentiment: number // 0–1
  }
  riskLabel: 'low' | 'moderate' | 'elevated' | 'high' | 'extreme'
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Risk factor weights
// ---------------------------------------------------------------------------

const RISK_WEIGHTS = {
  injury: 0.30,
  ageCurve: 0.25,
  positionVolatility: 0.15,
  depthChart: 0.12,
  coachingSystem: 0.10,
  newsSentiment: 0.08,
} as const

// ---------------------------------------------------------------------------
// Position volatility by sport
// ---------------------------------------------------------------------------

const POSITION_VOLATILITY: Record<string, Record<string, number>> = {
  NFL: { RB: 0.75, WR: 0.45, TE: 0.55, QB: 0.25, K: 0.20, DEF: 0.30, DL: 0.50, LB: 0.45, DB: 0.50 },
  NBA: { PG: 0.35, SG: 0.40, SF: 0.40, PF: 0.35, C: 0.30 },
  MLB: { SP: 0.50, RP: 0.70, C: 0.40, '1B': 0.35, '2B': 0.40, SS: 0.35, '3B': 0.40, OF: 0.40, DH: 0.30 },
  NHL: { C: 0.35, LW: 0.40, RW: 0.40, D: 0.30, G: 0.45 },
  NCAAF: { QB: 0.30, RB: 0.65, WR: 0.45, TE: 0.50 },
  NCAAB: { PG: 0.35, SG: 0.40, SF: 0.40, PF: 0.35, C: 0.30 },
  SOCCER: { FW: 0.40, MF: 0.35, DF: 0.25, GK: 0.20 },
}

// ---------------------------------------------------------------------------
// Age decay curves by sport + position
// ---------------------------------------------------------------------------

const AGE_DECAY: Record<string, Record<string, { peak: number; decayRate: number; cliff: number }>> = {
  NFL: {
    QB: { peak: 30, decayRate: 0.03, cliff: 38 },
    RB: { peak: 25, decayRate: 0.08, cliff: 30 },
    WR: { peak: 27, decayRate: 0.04, cliff: 33 },
    TE: { peak: 28, decayRate: 0.04, cliff: 33 },
  },
  NBA: {
    PG: { peak: 28, decayRate: 0.04, cliff: 34 },
    SG: { peak: 27, decayRate: 0.04, cliff: 33 },
    SF: { peak: 27, decayRate: 0.04, cliff: 33 },
    PF: { peak: 28, decayRate: 0.05, cliff: 34 },
    C: { peak: 28, decayRate: 0.05, cliff: 34 },
  },
  MLB: {
    SP: { peak: 28, decayRate: 0.03, cliff: 35 },
    RP: { peak: 29, decayRate: 0.04, cliff: 36 },
    OF: { peak: 28, decayRate: 0.03, cliff: 35 },
    SS: { peak: 27, decayRate: 0.04, cliff: 33 },
  },
  NHL: {
    C: { peak: 27, decayRate: 0.04, cliff: 34 },
    D: { peak: 28, decayRate: 0.03, cliff: 35 },
    G: { peak: 29, decayRate: 0.03, cliff: 36 },
  },
  SOCCER: {
    FW: { peak: 27, decayRate: 0.05, cliff: 33 },
    MF: { peak: 28, decayRate: 0.04, cliff: 34 },
    DF: { peak: 29, decayRate: 0.03, cliff: 35 },
    GK: { peak: 30, decayRate: 0.02, cliff: 37 },
  },
}

// ---------------------------------------------------------------------------
// Core risk computation
// ---------------------------------------------------------------------------

/**
 * Compute comprehensive risk score for a player.
 */
export function computeRiskScore(input: RiskInput): RiskResult {
  const warnings: string[] = []

  // 1. Injury risk (0–1)
  let injuryRisk = 0
  if (input.injuryStatus) {
    const statusMap: Record<string, number> = {
      healthy: 0, questionable: 0.30, doubtful: 0.60, out: 0.80, ir: 0.95, pup: 0.85,
    }
    injuryRisk = statusMap[input.injuryStatus.toLowerCase()] ?? 0
  }
  if (input.injuryHistoryScore != null) {
    injuryRisk = Math.max(injuryRisk, input.injuryHistoryScore / 100 * 0.7)
  }
  if (input.expectedReturnWeeks != null && input.expectedReturnWeeks > 0) {
    injuryRisk = Math.max(injuryRisk, Math.min(0.95, input.expectedReturnWeeks / 16))
    if (input.expectedReturnWeeks >= 8) warnings.push(`Expected return in ${input.expectedReturnWeeks} weeks`)
  }
  injuryRisk = clamp(injuryRisk, 0, 1)

  // 2. Age curve decay (0–1)
  let ageCurveRisk = 0
  if (input.age != null) {
    const sportDecay = AGE_DECAY[input.sport] ?? AGE_DECAY.NFL
    const posDecay = sportDecay[input.position] ?? { peak: 27, decayRate: 0.04, cliff: 33 }

    if (input.age <= posDecay.peak) {
      ageCurveRisk = 0 // Pre-peak: no age risk
    } else if (input.age >= posDecay.cliff) {
      ageCurveRisk = Math.min(0.95, 0.6 + (input.age - posDecay.cliff) * 0.10)
      warnings.push(`Age ${input.age} past cliff (${posDecay.cliff})`)
    } else {
      const yearsPastPeak = input.age - posDecay.peak
      ageCurveRisk = Math.min(0.6, yearsPastPeak * posDecay.decayRate * 3)
    }
  }
  ageCurveRisk = clamp(ageCurveRisk, 0, 1)

  // 3. Position volatility (0–1)
  const sportVol = POSITION_VOLATILITY[input.sport] ?? POSITION_VOLATILITY.NFL
  const posVolatility = sportVol[input.position] ?? 0.40

  // 4. Depth chart risk (0–1)
  let depthChartRisk = 0.10 // Default: assume starter
  if (input.depthChartPosition != null) {
    if (input.depthChartPosition === 1) depthChartRisk = 0.05
    else if (input.depthChartPosition === 2) depthChartRisk = 0.40
    else depthChartRisk = 0.70
  }
  if (input.snapPercentage != null) {
    if (input.snapPercentage < 30) { depthChartRisk = Math.max(depthChartRisk, 0.60); warnings.push(`Low snap% (${input.snapPercentage}%)`) }
    else if (input.snapPercentage < 50) depthChartRisk = Math.max(depthChartRisk, 0.35)
    else if (input.snapPercentage >= 80) depthChartRisk = Math.min(depthChartRisk, 0.10)
  }
  depthChartRisk = clamp(depthChartRisk, 0, 1)

  // 5. Coaching/system changes (0–1)
  let coachingRisk = 0
  if (input.coachingChange) { coachingRisk += 0.30; warnings.push('Coaching change') }
  if (input.systemChange) coachingRisk += 0.25
  if (input.newTeam) { coachingRisk += 0.20; warnings.push('New team') }
  coachingRisk = clamp(coachingRisk, 0, 1)

  // 6. News sentiment risk (0–1)
  let sentimentRisk = 0
  if (input.newsSentiment != null) {
    if (input.newsSentiment < -50) { sentimentRisk = 0.60; warnings.push('Negative news spike') }
    else if (input.newsSentiment < -20) sentimentRisk = 0.30
    else if (input.newsSentiment < 0) sentimentRisk = 0.10
    // Positive sentiment doesn't reduce risk (it's not risk)
  }
  sentimentRisk = clamp(sentimentRisk, 0, 1)

  // Weighted total
  const totalRisk = clamp(
    injuryRisk * RISK_WEIGHTS.injury +
    ageCurveRisk * RISK_WEIGHTS.ageCurve +
    posVolatility * RISK_WEIGHTS.positionVolatility +
    depthChartRisk * RISK_WEIGHTS.depthChart +
    coachingRisk * RISK_WEIGHTS.coachingSystem +
    sentimentRisk * RISK_WEIGHTS.newsSentiment,
    0, 1
  )

  // Risk label
  let riskLabel: RiskResult['riskLabel']
  if (totalRisk < 0.15) riskLabel = 'low'
  else if (totalRisk < 0.30) riskLabel = 'moderate'
  else if (totalRisk < 0.50) riskLabel = 'elevated'
  else if (totalRisk < 0.70) riskLabel = 'high'
  else riskLabel = 'extreme'

  return {
    totalRisk: Math.round(totalRisk * 1000) / 1000,
    factors: {
      injury: Math.round(injuryRisk * 1000) / 1000,
      ageCurve: Math.round(ageCurveRisk * 1000) / 1000,
      positionVolatility: Math.round(posVolatility * 1000) / 1000,
      depthChart: Math.round(depthChartRisk * 1000) / 1000,
      coachingSystem: Math.round(coachingRisk * 1000) / 1000,
      newsSentiment: Math.round(sentimentRisk * 1000) / 1000,
    },
    riskLabel,
    warnings,
  }
}

/**
 * Apply risk discount to a trade value.
 * FinalTradeValue = VALUE - (RISK × 0.25 × VALUE)
 */
export function applyRiskDiscount(value: number, riskScore: number): number {
  return Math.round(value - (riskScore * 0.25 * value))
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

