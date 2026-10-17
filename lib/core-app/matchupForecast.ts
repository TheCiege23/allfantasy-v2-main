/**
 * One win probability for a matchup — the rules both matchup screens apply.
 *
 * 🛑 THIS EXISTS BECAUSE THE TWO SCREENS DISAGREED ABOUT THE SAME GAME. On 2026-10-02 the
 * all-leagues board (`matchupPulse.ts`) gave "IDP Glory! Plus alil Offense" a 98% chance while its
 * own page (`matchup.ts`) printed "—". Both called the same engine (`computeWinProbability`); they
 * fed it different inputs under different rules:
 *
 *   - the page counted an EMPTY SLOT as a starter it could not price, so four empty slots on the
 *     opponent's side refused the whole forecast — an empty slot is a certain zero, not an unknown;
 *   - the board priced a starter from the vendor's generic total when the league's rules could not
 *     score him, which the page rightly refuses ("a PPR number is not this league's number");
 *   - the board counted a ruled-out or bye starter at full value, the page as a zero;
 *   - the page refused before kickoff whenever a schedule row was over an hour old, the board
 *     treated every starter as yet to play — the right call, since nothing is banked yet.
 *
 * So the RULES live here, once, and each screen only gathers inputs. A screen that wants a
 * different answer has to change this file, where the other screen will see it.
 *
 * Pure: no database, no clock.
 */
import { computeWinProbability, type MatchupPlayer } from '@/lib/projections/winProbability'
import type { ConfidenceTier } from '@/lib/projections/factorContract'
import type { StarterGameState } from './matchupGameState'

/** A starting slot the manager left empty. Every platform import writes it as `'0'`. */
export const EMPTY_SLOT = '0'

export type ForecastStarter = {
  /** The id the roster holds. `EMPTY_SLOT` is allowed and means a certain zero. */
  playerId: string
  /**
   * This week's projection rescored under THIS league's rules. Null when the rules cannot price him
   * — never the vendor's generic total in its place.
   */
  projected: number | null
  /** Ruled out or on bye: a certain zero, whatever his projection says. */
  unavailable?: boolean
  /** His own points so far, from per-player scoring. 0 when none were read. */
  actual: number
  /** Where his real-world game stands. `unknown` when the schedule could not place it. */
  state: StarterGameState
}

export type ForecastSide = {
  starters: ForecastStarter[]
  /** The scoreboard total — the authority on how much has been banked. */
  teamPoints: number
  /** Whether per-player points were read for this side at all. */
  hasPlayerPoints: boolean
}

export type ForecastRefusal =
  | 'best_ball'
  | 'no_rules'
  | 'no_starters'
  | 'states_unknown'
  | 'unattributed'
  | 'unprojected'

export type Forecast =
  | { available: true; pWin: number; projectedMargin: number; confidence: ConfidenceTier; detail: string }
  | { available: false; refusal: ForecastRefusal; reason: string }

export const BEST_BALL_REASON =
  'Best Ball win probability needs a full-roster outcome model; a probability from one projected optimal lineup would overstate certainty.'
export const STATES_UNKNOWN_REASON =
  'Some starter game states are unavailable, so remaining points and win probability cannot be verified.'
export const UNATTRIBUTED_REASON =
  "points are already on the board, but this league's per-player scores have not been imported, so we cannot tell how much of each starter's projection is still to come"

const isEmpty = (s: ForecastStarter) => s.playerId === EMPTY_SLOT || s.playerId === ''

/**
 * Has this matchup started? Anything banked on either scoreboard, any per-player point, or any
 * available starter whose game is live or over.
 *
 * ⚠ BEFORE IT HAS STARTED, GAME STATES DO NOT MATTER, so a stale schedule row cannot refuse the
 * forecast: with nothing banked and nobody final, every starter's whole projection is still to
 * come whatever the fixture list says.
 */
export function matchupStarted(you: ForecastSide, opponent: ForecastSide): boolean {
  return [you, opponent].some(
    (side) =>
      side.teamPoints !== 0 ||
      side.starters.some(
        (s) => !isEmpty(s) && (s.actual !== 0 || (!s.unavailable && (s.state === 'live' || s.state === 'final'))),
      ),
  )
}

function unprojectedReason(n: number): string {
  return `${n} starter${n === 1 ? '' : 's'} could not be priced under this league's scoring — no projection on file, or stats its rules do not cover — and counting them as zero would tilt the result toward the other side`
}

/** One side in the engine's terms. Assumes the refusals below have already been checked. */
function modelSide(side: ForecastSide, started: boolean): MatchupPlayer[] {
  const starters: MatchupPlayer[] = []
  let attributed = 0
  for (const s of side.starters) {
    attributed += s.actual
    if (isEmpty(s)) continue
    if (s.unavailable) {
      starters.push({ playerId: s.playerId, projectedPoints: 0, actualPoints: s.actual, isFinal: true })
      continue
    }
    starters.push({
      playerId: s.playerId,
      projectedPoints: s.projected,
      actualPoints: s.actual,
      isFinal: started && s.state === 'final',
    })
  }
  /*
   * ⚠ THE SCOREBOARD STAYS THE AUTHORITY ON WHAT IS BANKED. Points no starter row accounts for (a
   * stat correction, an unmapped id) are kept as one finished, zero-projection entry — banked
   * exactly once, never lost.
   */
  const unattributed = side.teamPoints - attributed
  if (unattributed > 0.005) {
    starters.push({ playerId: '__banked_unattributed__', projectedPoints: 0, actualPoints: unattributed, isFinal: true })
  }
  return starters
}

export function forecastMatchup(
  you: ForecastSide,
  opponent: ForecastSide,
  opts: { bestBall?: boolean; noRulesReason?: string | null } = {},
): Forecast {
  if (opts.bestBall) return { available: false, refusal: 'best_ball', reason: BEST_BALL_REASON }
  // "No rules" and "no projection" are different failures — blaming the feed for a missing
  // import sends someone hunting the wrong problem.
  if (opts.noRulesReason) return { available: false, refusal: 'no_rules', reason: opts.noRulesReason }

  const filled = (side: ForecastSide) => side.starters.filter((s) => !isEmpty(s))
  if (filled(you).length === 0 || filled(opponent).length === 0) {
    return { available: false, refusal: 'no_starters', reason: 'no starters on file for one side of this matchup' }
  }

  const started = matchupStarted(you, opponent)
  if (started && [you, opponent].some((side) => filled(side).some((s) => !s.unavailable && s.state === 'unknown'))) {
    return { available: false, refusal: 'states_unknown', reason: STATES_UNKNOWN_REASON }
  }

  /*
   * Per side, not per matchup: the per-player ingester writes one roster and skips another that has
   * not scored, so one side can have rows while the other has only a total.
   */
  if ([you, opponent].some((side) => side.teamPoints !== 0 && !side.hasPlayerPoints)) {
    return { available: false, refusal: 'unattributed', reason: UNATTRIBUTED_REASON }
  }

  /*
   * ⚠ AN UNPRICED STARTER STILL TO PLAY MAKES THE MATCHUP UNANSWERABLE, NOT MERELY LESS PRECISE. He
   * would add zero expected points and zero variance — "certain to score nothing" — which tilts the
   * result toward whichever side is fully covered. An empty slot and a ruled-out starter are not
   * unpriced: both really are certain zeros.
   */
  const unpriced = [you, opponent].reduce(
    (n, side) =>
      n + filled(side).filter((s) => !s.unavailable && s.projected == null && !(started && s.state === 'final')).length,
    0,
  )
  if (unpriced > 0) return { available: false, refusal: 'unprojected', reason: unprojectedReason(unpriced) }

  const result = computeWinProbability(
    { teamId: 'you', starters: modelSide(you, started) },
    { teamId: 'opponent', starters: modelSide(opponent, started) },
  )
  if (!result.available) return { available: false, refusal: 'unprojected', reason: result.reason }
  return {
    available: true,
    pWin: result.pWin,
    projectedMargin: result.projectedMargin,
    confidence: result.confidence,
    detail: result.detail,
  }
}
