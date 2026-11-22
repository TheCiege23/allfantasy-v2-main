/**
 * lib/engine/enhanced-fairness.ts
 * Enhanced fairness engine — logarithmic comparison + impact delta.
 *
 * Improvements over linear fairness:
 * - Logarithmic comparison reduces noise from large value differences
 * - Impact delta: how much each side improves their starting lineup
 * - Manager context: record, points for/against
 * - Tiered output with 4 levels instead of 3
 *
 * OUTPUT:
 * - Fairness score (0–100)
 * - Tiered result:
 *     90+ = Balanced
 *     80–89 = Slight Edge
 *     65–79 = Moderate Edge
 *     <65 = Lopsided
 *
 * Performance target: <2ms.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FairnessInput {
  /** Total value of assets Team A receives */
  valueA: number
  /** Total value of assets Team B receives */
  valueB: number
  /** Net starter improvement for Team A (points) */
  impactDeltaA?: number
  /** Net starter improvement for Team B (points) */
  impactDeltaB?: number
  /** Manager win percentages (0–1) */
  managerWinPctA?: number
  managerWinPctB?: number
  /** Points scored per game averages */
  ppgA?: number
  ppgB?: number
  /** Points allowed per game */
  papgA?: number
  papgB?: number
}

interface FairnessResult {
  score: number // 0–100
  tier: 'balanced' | 'slight_edge' | 'moderate_edge' | 'lopsided'
  favoredSide: 'A' | 'B' | 'even'
  delta: number // raw value difference (A - B)
  deltaPct: number // percentage difference
  impactDelta: number // lineup impact difference
  logScore: number // logarithmic fairness (raw)
  explanations: string[]
}

// ---------------------------------------------------------------------------
// Core fairness computation
// ---------------------------------------------------------------------------

/**
 * Compute enhanced fairness score using logarithmic comparison.
 */
export function computeEnhancedFairness(input: FairnessInput): FairnessResult {
  const { valueA, valueB } = input
  const explanations: string[] = []

  // Handle edge cases
  if (valueA === 0 && valueB === 0) {
    return {
      score: 100, tier: 'balanced', favoredSide: 'even', delta: 0,
      deltaPct: 0, impactDelta: 0, logScore: 100, explanations: ['Both sides empty'],
    }
  }

  // ─── LOGARITHMIC COMPARISON ───
  // log(a+1) / log(b+1) compresses large differences, amplifies small ones
  const logA = Math.log1p(Math.max(0, valueA))
  const logB = Math.log1p(Math.max(0, valueB))
  const logMax = Math.max(logA, logB)
  const logMin = Math.min(logA, logB)

  // Logarithmic fairness ratio (0–1, where 1 = perfectly equal)
  const logRatio = logMax > 0 ? logMin / logMax : 1
  const logScore = Math.round(logRatio * 100)

  // ─── LINEAR DELTA (for context) ───
  const delta = valueA - valueB
  const baseline = Math.max(valueA, valueB, 1)
  const deltaPct = Math.round((Math.abs(delta) / baseline) * 100)

  // ─── IMPACT DELTA ───
  const impactA = input.impactDeltaA ?? 0
  const impactB = input.impactDeltaB ?? 0
  const impactDelta = impactA - impactB

  // Impact adjusts fairness: if the "losing" side gains more lineup improvement, the trade is fairer
  let impactAdj = 0
  if (delta > 0 && impactB > impactA) {
    // A gets more value but B improves more — fairer than it looks
    impactAdj = Math.min(8, Math.abs(impactDelta) / 50)
  } else if (delta < 0 && impactA > impactB) {
    // B gets more value but A improves more — fairer than it looks
    impactAdj = Math.min(8, Math.abs(impactDelta) / 50)
  } else if (Math.abs(impactDelta) > 100) {
    // One side improves dramatically more — less fair
    impactAdj = -Math.min(5, Math.abs(impactDelta) / 100)
  }

  // ─── MANAGER CONTEXT ADJUSTMENT ───
  let managerAdj = 0
  if (input.managerWinPctA != null && input.managerWinPctB != null) {
    const winPctDiff = Math.abs(input.managerWinPctA - input.managerWinPctB)
    // Large win% gap means trade between contender and rebuilder — expected to be uneven
    if (winPctDiff > 0.25) {
      managerAdj = 3 // More forgiving for contender/rebuilder trades
      explanations.push('Contender-rebuilder trade: value gap expected')
    }
  }

  // ─── SCORING CONTEXT ───
  let scoringAdj = 0
  if (input.ppgA != null && input.ppgB != null && input.papgA != null && input.papgB != null) {
    // Team that scores less and allows more is in a worse position
    const netA = input.ppgA - input.papgA
    const netB = input.ppgB - input.papgB
    if (Math.abs(netA - netB) > 30) {
      scoringAdj = 2 // More forgiving when teams have vastly different strength
    }
  }

  // ─── COMPOSITE FAIRNESS SCORE ───
  const rawScore = logScore + impactAdj + managerAdj + scoringAdj
  const score = Math.round(clamp(rawScore, 0, 100))

  // ─── DETERMINE FAVORED SIDE ───
  const tolerance = Math.max(baseline * 0.03, 10) // 3% tolerance or 10 absolute
  let favoredSide: 'A' | 'B' | 'even'
  if (Math.abs(delta) <= tolerance) {
    favoredSide = 'even'
  } else {
    favoredSide = delta > 0 ? 'A' : 'B'
  }

  // ─── TIER ───
  let tier: FairnessResult['tier']
  if (score >= 90) { tier = 'balanced'; explanations.push('Trade is well-balanced') }
  else if (score >= 80) { tier = 'slight_edge'; explanations.push(`Slight edge to Team ${favoredSide}`) }
  else if (score >= 65) { tier = 'moderate_edge'; explanations.push(`Moderate edge to Team ${favoredSide}`) }
  else { tier = 'lopsided'; explanations.push(`Lopsided in favor of Team ${favoredSide}`) }

  // Add value context
  if (deltaPct > 0) {
    explanations.push(`Value gap: ${deltaPct}% (${Math.abs(Math.round(delta))} raw)`)
  }
  if (Math.abs(impactDelta) > 20) {
    const better = impactA > impactB ? 'A' : 'B'
    explanations.push(`Team ${better} improves lineup by ${Math.abs(Math.round(impactDelta))} more points`)
  }

  return {
    score,
    tier,
    favoredSide,
    delta: Math.round(delta),
    deltaPct,
    impactDelta: Math.round(impactDelta),
    logScore,
    explanations,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
