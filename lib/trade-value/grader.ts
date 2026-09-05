/**
 * T2 Trade Grader V1 — deterministic. No AI text generation.
 *
 * Grade is a transparent function of fairness (value evenness):
 *   fairnessScore = 100 − clamp(|valueDifference| / max(totalA, totalB, 1) × 100, 0, 100)
 * Letter grade buckets fairnessScore (A+ … F). Explanation bullets are templated from the computed
 * numbers + optional team profiles (no generated prose).
 */

import type { CommissionerReview, SideTotals, TeamProfile, TradeGrade } from './types'

const GRADE_BUCKETS: Array<[number, string]> = [
  [97, 'A+'],
  [92, 'A'],
  [88, 'A-'],
  [83, 'B+'],
  [78, 'B'],
  [73, 'B-'],
  [68, 'C+'],
  [63, 'C'],
  [58, 'C-'],
  [50, 'D'],
]

function letterFor(fairness: number): string {
  for (const [min, letter] of GRADE_BUCKETS) {
    if (fairness >= min) return letter
  }
  return 'F'
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Confidence = share of player assets THE ENGINE COULD ACTUALLY PRICE (data completeness).
 *
 * 🛑 THIS COUNTED PROJECTIONS ONLY, AND THE ENGINE DOES NOT PRICE ON PROJECTIONS ONLY.
 * `normalizedPlayerValue` takes an IDP value FIRST (it outranks a projection outright), then a
 * projection, then market value as a documented fallback basis. A trade priced entirely off
 * FantasyCalc market values therefore produced a real total, a real fairness score and a real
 * letter grade while reporting `confidence: 0` — the engine saying it had nothing to go on about
 * a number it had just confidently produced.
 *
 * That is not cosmetic. `consoleShadowCompare` withdraws the agreement claim at `confidence <= 0`
 * ("ZERO CONFIDENCE IS NOT AGREEMENT"), which is right given the number it is handed and wrong
 * given what the number meant — so every market-priced trade was verdictless BY CONSTRUCTION and
 * could never reach the Phase 3 flip gate no matter how much traffic arrived. Measured against
 * production: all four `manager.trade.evaluate` observations (2026-09-04/05) carried
 * `confidenceScore: 0` beside grades of A+, A+, C+ and B- and fairness of 100, 72 and 76 —
 * fairness that is only computable when a side actually resolved to value.
 *
 * ⚠ THE BASIS IS READ, NOT RE-DERIVED. `valuationBasis` comes from `valueBasisFor`, which is the
 * same function the engine branches on, so this cannot drift out of step with what actually priced
 * the asset. `'none'` is a REFUSAL — no usable input reached the engine — and is the only string
 * that does not count.
 *
 * ⚠ NO WEIGHTS. A market-priced asset counts the same as a projected one, because any weighting
 * would be an invented number and this repo has been bitten by invented floors before. Confidence
 * answers "could we price it", not "how good was the input"; `valuationBasis` is preserved per
 * asset for anyone who needs the second question.
 */
export function computeConfidence(sides: SideTotals[]): number {
  let players = 0
  let priced = 0
  for (const side of sides) {
    for (const a of side.assets) {
      if (a.kind !== 'player') continue
      players += 1
      const basis = a.valuationBasis
      if (basis === 'idp' || basis === 'projection' || basis === 'market') {
        priced += 1
      } else if (basis === undefined && a.sources.projectionValue != null) {
        /*
         * Snapshots written before `valuationBasis` existed do not carry it, and absent must not
         * be read as any particular basis. Falling back to the old projection test keeps those
         * scoring exactly as they did rather than silently re-rating history.
         */
        priced += 1
      }
    }
  }
  // Picks/FAAB only. Left at 60 deliberately: it is a pre-existing assertion about a trade with no
  // player assets at all, it is unchanged by this fix, and moving it would shift every consumer's
  // numbers for a different reason than the one being fixed here.
  if (players === 0) return 60
  return Math.round((priced / players) * 100)
}

export function gradeTrade(
  sideA: SideTotals,
  sideB: SideTotals,
  profiles?: { a?: TeamProfile; b?: TeamProfile },
): { grade: TradeGrade; commissionerReview: CommissionerReview } {
  const valueDifference = sideA.total - sideB.total
  const confidenceScore = computeConfidence([sideA, sideB])

  // HONESTY PASS: when nothing on either side resolved to a real value, the
  // old math produced |diff| = 0 over a denominator floor of 1 → fairness 100
  // → "A+ / within normal market range", and commissionerReview.
  // reviewRecommended = false. That is the engine asserting a trade is fair
  // when it knows nothing about it. Refuse to grade instead.
  const hasAnyValue = sideA.total > 0 || sideB.total > 0
  if (!hasAnyValue) {
    return {
      grade: {
        grade: null,
        valueDifference: 0,
        fairnessScore: null,
        confidenceScore,
        insufficientData: true,
        bullets: [
          'Not enough value data to grade this trade — no asset on either side resolved to a known value.',
          'Add player projections or market values for these assets, then re-run.',
        ],
      },
      commissionerReview: {
        fairnessScore: null,
        lopsided: false,
        // Ungradeable ≠ approved. A human should look rather than the system
        // implying the trade cleared review.
        reviewRecommended: true,
        similarValueRange: null,
      },
    }
  }

  const denom = Math.max(sideA.total, sideB.total, 1)
  const fairnessScore = Math.round(100 - clamp((Math.abs(valueDifference) / denom) * 100, 0, 100))
  const grade = letterFor(fairnessScore)

  const bullets: string[] = []
  const gap = Math.abs(valueDifference)
  if (fairnessScore >= 88) {
    bullets.push('Trade is within normal market range')
  } else if (fairnessScore >= 65) {
    const gainer = valueDifference > 0 ? 'Team A' : 'Team B'
    bullets.push(`${gainer} gains modestly more total value (${gap} pts)`)
  } else {
    const gainer = valueDifference > 0 ? 'Team A' : 'Team B'
    bullets.push(`Trade is significantly uneven toward ${gainer} (${gap} pts)`)
  }

  // Profile-driven depth bullets (deterministic; "B receives X" = assets flowing to B = sideA's sends).
  const toB = sideA.assets.filter((x) => x.kind === 'player' && x.position)
  const toA = sideB.assets.filter((x) => x.kind === 'player' && x.position)
  if (profiles?.b?.weakPositions?.length) {
    for (const pos of profiles.b.weakPositions) {
      if (toB.some((x) => (x.position || '').toUpperCase() === pos)) {
        bullets.push(`Team B improves ${pos} depth`)
        break
      }
    }
  }
  if (profiles?.a?.weakPositions?.length) {
    for (const pos of profiles.a.weakPositions) {
      if (toA.some((x) => (x.position || '').toUpperCase() === pos)) {
        bullets.push(`Team A improves ${pos} depth`)
        break
      }
    }
  }
  if (confidenceScore < 60) {
    // Wording follows the measure: confidence now counts assets the engine could price by ANY
    // basis, so "lacked projection data" would name a narrower cause than the one being reported.
    bullets.push('Some assets could not be priced from any source — confidence reduced')
  }

  const commissionerReview: CommissionerReview = {
    fairnessScore,
    lopsided: fairnessScore < 60,
    reviewRecommended: fairnessScore < 55,
    similarValueRange: { low: Math.round(denom * 0.85), high: Math.round(denom * 1.15) },
  }

  return {
    grade: { grade, valueDifference, fairnessScore, confidenceScore, insufficientData: false, bullets },
    commissionerReview,
  }
}
