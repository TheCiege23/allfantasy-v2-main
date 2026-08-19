/**
 * The objective engine — one question, asked of every decision.
 *
 *     Does this action increase the expected value of my season outcome?
 *
 * Not "did I win the trade". Not "did I gain value points". Those are proxies,
 * and treating a proxy as the goal is how trade calculators go wrong: they grade
 * a 2-8 team and a 7-3 team identically on the same trade, when the correct
 * grades are opposite.
 *
 *     Grade(action) = objective(state_after) − objective(state_before)
 *
 * ⚠ THIS IS AN INTERFACE ON PURPOSE, AND THE DISCIPLINE IT ENFORCES IS THE POINT.
 * v1 is a heuristic composite; v2 is a Monte Carlo season simulation. Every
 * consumer reads an ObjectiveValue DELTA and never a raw player value, so
 * replacing v1 with v2 touches this file and nothing else. The moment a decision
 * evaluator reaches past this interface to a player's market value, that swap
 * becomes a rewrite.
 */

import type { ConfidenceTier } from './factorContract'

export type ObjectiveValue = {
  /**
   * ⚠ v1 IS A RATING, NOT A PROBABILITY, HOWEVER IT IS LABELLED DOWNSTREAM.
   * Rendering a heuristic composite as "73% championship odds" claims a
   * calibration that no simulation has produced. Until v2 actually simulates,
   * consumers must present this as a rating and `engineVersion` is how they can
   * tell which they are holding.
   */
  pChampionship: number
  pPlayoffs: number
  expectedDraftSlot: number | null
  futureAssetValue: number
  confidence: ConfidenceTier
  /** Always stamped, so a stored grade can be traced to the engine that made it. */
  engineVersion: string
}

/** Where a team sits on the contend↔rebuild spectrum. */
export type ContentionBand =
  | 'CONTENDER'
  | 'FRINGE'
  | 'NEUTRAL'
  | 'SOFT_REBUILD'
  | 'FULL_REBUILD'

export type TeamStateInput = {
  teamId: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  /** League-wide mean points for, used to z-score. */
  leagueAveragePointsFor: number
  leagueStdDevPointsFor: number
  weeksRemaining: number
  playoffTeams: number
  teamCount: number
  /** Current standing rank, 1 = first. */
  rank: number | null
}

export interface ObjectiveEngine {
  readonly version: string
  evaluate(team: TeamStateInput): ObjectiveValue
}

function z(value: number, mean: number, stdDev: number): number {
  if (!Number.isFinite(stdDev) || stdDev <= 0) return 0
  return (value - mean) / stdDev
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/**
 * v1 — heuristic composite.
 *
 * ⚠ EVERY COEFFICIENT BELOW IS A PLACEHOLDER AND THE CONFIDENCE IS CAPPED AT
 * MEDIUM BECAUSE OF IT. These weights have not been fitted against historical
 * league outcomes; they encode a defensible shape, not a measured relationship.
 * Shipping unfitted coefficients while reporting HIGH confidence would repeat
 * precisely the failure this codebase keeps undoing, so the cap is enforced in
 * code rather than left to a caller's discretion.
 */
export class HeuristicObjectiveEngine implements ObjectiveEngine {
  readonly version = 'heuristic-v1'

  evaluate(team: TeamStateInput): ObjectiveValue {
    const games = team.wins + team.losses + team.ties
    const winPct = games > 0 ? (team.wins + team.ties * 0.5) / games : 0.5

    /*
     * ⚠ POINTS FOR IS WEIGHTED ABOVE WIN-LOSS ON PURPOSE. Fantasy records are
     * noisy — a 4-6 team with top-three scoring is a good team with a bad
     * schedule. Weighting the record heavily makes the system recommend a
     * fire-sale for a team that is actually contending, which is the most
     * damaging advice it could give.
     */
    const pfZ = z(team.pointsFor, team.leagueAveragePointsFor, team.leagueStdDevPointsFor)
    const seedStrength = pfZ * 0.6 + (winPct - 0.5) * 4 * 0.4

    // Playoff share shifts the intercept: a 6-of-12 league is far more forgiving
    // than 4-of-12, and a fixed intercept would misjudge both.
    const playoffShare = team.teamCount > 0 ? team.playoffTeams / team.teamCount : 0.5
    const intercept = Math.log(playoffShare / Math.max(1 - playoffShare, 0.01))

    // Late in the season the standings harden; early on they barely bind.
    const seasonProgress = team.weeksRemaining > 0 ? Math.min(1, 1 - team.weeksRemaining / 17) : 1
    const certainty = 1 + seasonProgress * 1.5

    const pPlayoffs = Math.max(0.01, Math.min(0.99, logistic(intercept + seedStrength * certainty)))

    /*
     * Championship odds are NOT playoff odds scaled — a title requires winning
     * several single-elimination weeks, so the drop-off is steep and roughly
     * geometric in the bracket depth.
     */
    const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(team.playoffTeams, 2))))
    const perRound = 0.5 + Math.max(-0.2, Math.min(0.2, pfZ * 0.08))
    const pChampionship = pPlayoffs * Math.pow(perRound, rounds)

    const expectedDraftSlot =
      team.rank != null ? team.teamCount - team.rank + 1 : null

    return {
      pChampionship: Math.round(pChampionship * 1000) / 1000,
      pPlayoffs: Math.round(pPlayoffs * 1000) / 1000,
      expectedDraftSlot,
      futureAssetValue: 0,
      // Capped at MEDIUM until the coefficients are fitted. See the class note.
      confidence: games >= 4 ? 'MEDIUM' : 'LOW',
      engineVersion: this.version,
    }
  }
}

/**
 * Contention score on [-1, +1]: -1 full rebuild, +1 all-in.
 *
 * ⚠ THE FRINGE BAND IS WHERE THIS EARNS ITS KEEP. Contenders and rebuilders
 * mostly know what they are; the 5-5 team with a middling roster is where
 * managers make their worst decisions in both directions. Detecting that state
 * and saying "you are genuinely on the fence" is worth more than any grade given
 * to a 9-1 team.
 */
export function contentionScore(obj: ObjectiveValue): number {
  // Centred so a coin-flip playoff team lands near zero.
  return Math.tanh((obj.pPlayoffs - 0.5) * 3)
}

export function contentionBand(score: number): ContentionBand {
  if (score > 0.5) return 'CONTENDER'
  if (score > 0.15) return 'FRINGE'
  if (score >= -0.15) return 'NEUTRAL'
  if (score >= -0.5) return 'SOFT_REBUILD'
  return 'FULL_REBUILD'
}

/**
 * How hard this team should discount future value.
 *
 * ⚠ THIS ONE FUNCTION IS WHY THERE IS NO `if (contending)` BRANCH ANYWHERE IN THE
 * TRADE EVALUATOR. A contender discounts the future harder — their window is now;
 * a rebuilder discounts it softer. Applied consistently, correct directional
 * behaviour falls out of the arithmetic instead of being hand-coded per case,
 * which is exactly where multiplier-stacking approaches get the margins wrong.
 */
export function discountFactor(
  yearsOut: number,
  score: number,
  opts: { baseRate: number; k?: number } = { baseRate: 0.85 }
): number {
  if (yearsOut <= 0) return 1
  // Redraft and other zero-horizon formats: nothing carries over at all.
  if (opts.baseRate <= 0) return 0
  const k = opts.k ?? 0.35
  /*
   * ⚠ SIGN CAUGHT BY TEST — IT WAS INVERTED. Written as `1 - score * k`, a
   * contender got the LARGER discount factor, i.e. valued future years MORE than
   * a rebuilder did. That is backwards, and it would have quietly pushed
   * contenders to hoard picks and rebuilders to buy win-now pieces: the opposite
   * of correct advice, produced by a single sign.
   *
   * A higher contention score must SHRINK the factor (future worth less now).
   */
  const adjustment = 1 + score * k
  return Math.pow(opts.baseRate, yearsOut * adjustment)
}
