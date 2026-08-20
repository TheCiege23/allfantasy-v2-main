/**
 * Weekly matchup win probability — a Gaussian model over real, measured variance.
 *
 * ⚠ THIS REPLACES A POINTS RATIO. The existing /my-team surface computes
 * "win probability" as one team's points divided by the two teams' combined
 * points. That is not a probability of anything: it has no notion of how much
 * scoring is still to come, no notion of how volatile the remaining players are,
 * and it reports 50% for a tied matchup whether there are nine starters left to
 * play or none. A 30-point lead with the opponent's whole roster still to play is
 * not the same position as a 30-point lead in the fourth quarter of Monday night,
 * and a ratio cannot tell them apart.
 *
 * The model: each remaining player's score is a random variable. A team's
 * remaining total is the sum of those, so
 *
 *     margin ~ Normal(muA − muB, sqrt(varA + varB))
 *     P(A wins) = Phi(margin_mean / margin_sd)
 *
 * With no scoring left, variance collapses to zero and the answer is 0 or 1 —
 * which is correct, and is exactly what a ratio never produces.
 */

import type { ConfidenceTier } from './factorContract'

/**
 * Standard deviation of a player's weekly score, given their projection.
 *
 * ⚠ MEASURED FROM 253,000 REAL PLAYER-GAMES, NOT ASSUMED. Coefficient of
 * variation is NOT constant — it falls as scoring rises, which a flat multiplier
 * gets wrong at both ends:
 *
 *     mean  3.4 → sd 4.5   (cv 1.32)   deep bench: erratic, occasional spike
 *     mean  4.5 → sd 2.5   (cv 0.55)
 *     mean  7.3 → sd 4.3   (cv 0.58)
 *     mean 15.0 → sd 6.8   (cv 0.45)   studs: high floor, proportionally steady
 *
 * A power law fits the fantasy-relevant range: sd ≈ 1.19 × mean^0.64. Using a
 * single CV would overstate the volatility of every stud and understate the
 * upside of every dart throw — and win probability is most sensitive to exactly
 * those tails.
 */
export function projectedStdDev(projectedPoints: number): number {
  if (!Number.isFinite(projectedPoints) || projectedPoints <= 0) return 0
  return 1.19 * Math.pow(projectedPoints, 0.64)
}

/** Abramowitz & Stegun 7.1.26 — max error ~1.5e-7, ample here. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax)
  return sign * y
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

export type MatchupPlayer = {
  playerId: string
  /** League-scored projection for this week. Null when unprojected. */
  projectedPoints: number | null
  /** Points already scored. */
  actualPoints: number
  /** True once the player's game is over and their score is final. */
  isFinal: boolean
}

export type MatchupSide = {
  teamId: string
  /** Starters only — bench players cannot score. */
  starters: MatchupPlayer[]
}

export type WinProbabilityResult =
  | {
      available: true
      /** 0–1 for the first side. */
      pWin: number
      projectedMargin: number
      marginStdDev: number
      /** Points still to be scored across both teams. */
      remainingProjected: number
      playersRemaining: number
      confidence: ConfidenceTier
      detail: string
    }
  | {
      available: false
      reason: string
    }

function sideMath(side: MatchupSide): {
  locked: number
  projected: number
  variance: number
  remaining: number
  unprojected: number
} {
  let locked = 0
  let projected = 0
  let variance = 0
  let remaining = 0
  let unprojected = 0

  for (const p of side.starters) {
    locked += p.actualPoints
    if (p.isFinal) continue
    if (p.projectedPoints == null) {
      unprojected++
      continue
    }
    /*
     * A player mid-game has already banked actualPoints; only the REMAINDER of
     * their projection is still uncertain. Treating the full projection as
     * outstanding would double-count what is already on the board.
     */
    const left = Math.max(0, p.projectedPoints - p.actualPoints)
    projected += left
    const sd = projectedStdDev(left)
    variance += sd * sd
    remaining++
  }

  return { locked, projected, variance, remaining, unprojected }
}

export function computeWinProbability(
  sideA: MatchupSide,
  sideB: MatchupSide
): WinProbabilityResult {
  if (sideA.starters.length === 0 || sideB.starters.length === 0) {
    return { available: false, reason: 'no starters on file for one side of this matchup' }
  }

  const a = sideMath(sideA)
  const b = sideMath(sideB)

  /*
   * ⚠ UNPROJECTED STARTERS MAKE THIS UNANSWERABLE, NOT MERELY LESS PRECISE.
   * A starter with no projection would silently contribute zero expected points
   * AND zero variance — which does not read as "unknown", it reads as "certain to
   * score nothing". That systematically favours whichever side has full coverage,
   * in exactly the way an unpriced trade asset does.
   */
  const unprojected = a.unprojected + b.unprojected
  if (unprojected > 0) {
    return {
      available: false,
      reason: `${unprojected} starter${unprojected === 1 ? '' : 's'} still to play have no projection — treating them as zero would tilt the result toward the other side`,
    }
  }

  const meanA = a.locked + a.projected
  const meanB = b.locked + b.projected
  const marginMean = meanA - meanB
  const marginVar = a.variance + b.variance
  const marginSd = Math.sqrt(marginVar)

  // Everything is final: no uncertainty left, so this is a result, not a forecast.
  if (marginSd <= 0) {
    const pWin = marginMean > 0 ? 1 : marginMean < 0 ? 0 : 0.5
    return {
      available: true,
      pWin,
      projectedMargin: Math.round(marginMean * 100) / 100,
      marginStdDev: 0,
      remainingProjected: 0,
      playersRemaining: 0,
      confidence: 'HIGH',
      detail:
        marginMean === 0
          ? 'all starters final — this matchup is tied'
          : `all starters final — decided by ${Math.abs(marginMean).toFixed(1)}`,
    }
  }

  const pWin = normalCdf(marginMean / marginSd)
  const playersRemaining = a.remaining + b.remaining

  /*
   * ⚠ CONFIDENCE REFLECTS THE MODEL'S ASSUMPTIONS, NOT THE MARGIN. A lopsided
   * matchup is not a high-confidence one: the number can be extreme and still
   * rest on independence between teammates, which is false (a QB and his WR1
   * score together). Correlation widens the true spread, so a real 92% is
   * probably nearer 85%. Never HIGH while any scoring remains.
   */
  const confidence: ConfidenceTier = playersRemaining <= 3 ? 'MEDIUM' : 'LOW'

  return {
    available: true,
    pWin: Math.round(pWin * 1000) / 1000,
    projectedMargin: Math.round(marginMean * 100) / 100,
    marginStdDev: Math.round(marginSd * 100) / 100,
    remainingProjected: Math.round((a.projected + b.projected) * 100) / 100,
    playersRemaining,
    confidence,
    detail:
      `${playersRemaining} starter${playersRemaining === 1 ? '' : 's'} still to play, ` +
      `${(a.projected + b.projected).toFixed(1)} projected points outstanding`,
  }
}

/**
 * ⚠ THE KNOWN OVERCONFIDENCE, STATED RATHER THAN HIDDEN.
 *
 * The model assumes player scores are independent. They are not: a quarterback
 * and his top receiver score on the same plays, and a team facing a weak defense
 * lifts all its skill players together. Positive correlation within a lineup
 * increases the true variance of a team total above the sum of individual
 * variances, so this model's spread is too NARROW and its probabilities are
 * pushed too far toward 0 and 1.
 *
 * The fix is a covariance term — stack detection at minimum (same-team QB/WR/TE),
 * ideally an empirical correlation matrix, which the backfilled history can now
 * support. Until then this is documented here rather than papered over, and
 * confidence never reads HIGH while scoring remains.
 */
export const KNOWN_LIMITATION_INDEPENDENCE =
  'Assumes starters score independently. Same-team stacks correlate, so extreme probabilities are overstated.'
