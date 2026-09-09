/**
 * Competitive-window resolver.
 *
 * ⚠ THE EXISTING `WindowDetectionEngine` FALLS THROUGH TO 'Competitive', so a
 * team with no evidence is indistinguishable from a genuinely middling one.
 * This resolver refuses instead: `status` is null and `gaps` names what is
 * missing. Unknown is not average.
 *
 * ⚠ SCHEDULE LUCK IS THE POINT. A head-to-head record cannot tell a 7-3
 * contender from a 3-7 roster that outscored the league and lost — see
 * `lib/core-app/allPlay.ts`, which measures exactly that gap. Classifying on
 * the raw record is how three unlucky losses turn into a rebuild flip.
 *
 * Every coefficient here is STRUCTURAL AND UNCALIBRATED. They are exposed as a
 * versioned set rather than buried as literals so a later calibration pass can
 * replace them with a rollback target, per the value contract's requirement
 * that a learned weight carry a version.
 */

export type WindowStatus = 'contender' | 'rising' | 'competitive' | 'declining' | 'rebuilding'

/**
 * Whether the supplied playoff probability already reflects the current injury
 * situation. Applying the injury share on top of a forecast that already priced
 * it counts the same absence twice.
 */
export type InjuryTreatment = 'included-in-playoff-probability' | 'excluded'

/**
 * Whether the supplied roster strength already contains future draft capital.
 *
 * ⚠ IT DOES, ON THE PATH THIS RESOLVER ACTUALLY READS.
 * `DynastyProjectionEngine.projectTeam` calls
 * `estimateLongTermStrength(rosterValue, pickValue, ctx)`, so
 * `DynastyProjectionSnapshot.projectedStrength3Years` has already blended
 * picks in. Adding a separate pick term on top of that snapshot counts the
 * same draft capital twice. A caller supplying a pick-free strength figure
 * from somewhere else declares 'separate' and provides both.
 */
export type PickTreatment = 'included-in-roster-strength' | 'separate'

export interface WindowCoefficients {
  version: string
  calibration: 'uncalibrated-structural' | 'calibrated'
  /** Present-strength blend. Must sum to 1. */
  nowRecord: number
  nowPlayoffProbability: number
  /** Future-strength blend. Must sum to 1. */
  futureRosterStrength: number
  futurePickCapital: number
  /** Band edges on the 0..1 score scale. */
  contenderThreshold: number
  rebuildThreshold: number
  risingDelta: number
  decliningDelta: number
  /** A score move smaller than this is drift, not a material change. */
  materialScoreDelta: number
}

export const DEFAULT_WINDOW_COEFFICIENTS: WindowCoefficients = {
  version: 'window-structural-1',
  calibration: 'uncalibrated-structural',
  nowRecord: 0.5,
  nowPlayoffProbability: 0.5,
  futureRosterStrength: 0.75,
  futurePickCapital: 0.25,
  contenderThreshold: 0.62,
  rebuildThreshold: 0.38,
  risingDelta: 0.15,
  decliningDelta: 0.15,
  materialScoreDelta: 0.05,
}

/**
 * All rates and strengths are 0..1 on scales the CALLER documents. This module
 * refuses out-of-range input rather than rescaling it, because inventing a
 * conversion between an engine's arbitrary strength scale and this one would be
 * exactly the unbacked coefficient the value contract forbids.
 */
export interface TeamWindowFacts {
  teamId: string
  leagueId: string
  season: number
  week: number
  wins: number
  losses: number
  ties: number
  /**
   * Wins above what the scoring earned, from the all-play comparison. Positive
   * means the schedule has been kind. Equivalent to
   * `wins - allPlayWinRate * gamesPlayed`.
   */
  luckWins: number | null
  /** 0..1, forward-looking. */
  playoffProbability: number | null
  /** 0..1, three seasons out. */
  rosterStrength3Year: number | null
  /** 0..1 accumulated future draft capital. Must be null unless `pickTreatment` is 'separate'. */
  futurePickCapital: number | null
  pickTreatment: PickTreatment
  /**
   * 0..1 share of the roster that is currently unavailable.
   *
   * ⚠ NOT VALUE-WEIGHTED, AND DELIBERATELY NOT NAMED AS IF IT WERE. The only
   * player-id-keyed injury source in a joinable namespace is the `SportsPlayer`
   * cache behind Decision OS F2.3, which carries an availability CATEGORY and
   * no player value. Weighting by starter value would require a join this
   * source cannot support, so the share is a count and says so. The supplying
   * adapter declares its exact basis alongside the number.
   */
  unavailableShare: number | null
  injuryTreatment: InjuryTreatment
}

export interface WindowResolution {
  status: WindowStatus | null
  /** 0..1 present competitiveness, luck-adjusted. Null when unresolved. */
  nowScore: number | null
  /** 0..1 forward competitiveness. Null when unresolved. */
  futureScore: number | null
  luckAdjustedWinRate: number | null
  coefficients: WindowCoefficients
  gaps: string[]
}

function unitOrNull(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1 ? n : null
}

/**
 * The record the team's scoring earned, with the schedule removed. Three losses
 * in weeks the team outscored most of the league leave this untouched — which
 * is what stops a bad-luck stretch from reading as decline.
 */
export function luckAdjustedWinRate(facts: Pick<TeamWindowFacts, 'wins' | 'losses' | 'ties' | 'luckWins'>): number | null {
  const { wins, losses, ties, luckWins } = facts
  if (![wins, losses, ties].every(n => Number.isInteger(n) && n >= 0)) return null
  const played = wins + losses + ties
  if (played <= 0) return null
  if (luckWins === null || !Number.isFinite(luckWins)) return null
  const earned = wins + 0.5 * ties - luckWins
  if (!Number.isFinite(earned)) return null
  return Math.min(1, Math.max(0, earned / played))
}

export function resolveCompetitiveWindow(
  facts: TeamWindowFacts,
  coefficients: WindowCoefficients = DEFAULT_WINDOW_COEFFICIENTS,
): WindowResolution {
  const gaps: string[] = []
  const c = coefficients
  const blendsValid =
    Math.abs(c.nowRecord + c.nowPlayoffProbability - 1) < 1e-9 &&
    Math.abs(c.futureRosterStrength + c.futurePickCapital - 1) < 1e-9 &&
    c.rebuildThreshold < c.contenderThreshold
  if (!blendsValid) {
    return { status: null, nowScore: null, futureScore: null, luckAdjustedWinRate: null, coefficients: c, gaps: ['window_coefficients_invalid'] }
  }

  const record = luckAdjustedWinRate(facts)
  if (record === null) gaps.push('record_or_schedule_luck_missing')

  const playoff = unitOrNull(facts.playoffProbability)
  if (playoff === null) gaps.push('playoff_probability_missing')

  const strength = unitOrNull(facts.rosterStrength3Year)
  if (strength === null) gaps.push('roster_strength_3y_missing')

  const separatePicks = facts.pickTreatment === 'separate'
  const picks = separatePicks ? unitOrNull(facts.futurePickCapital) : null
  if (separatePicks && picks === null) gaps.push('future_pick_capital_missing')
  // Supplying picks alongside a strength figure that already contains them is a
  // caller error, not a value to quietly ignore.
  if (!separatePicks && facts.futurePickCapital !== null) gaps.push('future_pick_capital_double_counted')

  const injured = unitOrNull(facts.unavailableShare)
  if (injured === null) gaps.push('injury_share_missing')

  if (gaps.length) {
    return { status: null, nowScore: null, futureScore: null, luckAdjustedWinRate: record, coefficients: c, gaps }
  }

  // A historical record already contains the injuries that have happened, so
  // only the forward term is ever discounted — and only when the forecast has
  // not already priced them.
  const forwardHealth = facts.injuryTreatment === 'excluded' ? 1 - injured! : 1
  const nowScore = c.nowRecord * record! + c.nowPlayoffProbability * playoff! * forwardHealth
  const futureScore = separatePicks
    ? c.futureRosterStrength * strength! + c.futurePickCapital * picks!
    : strength!

  const status: WindowStatus =
    nowScore >= c.contenderThreshold && futureScore >= c.contenderThreshold ? 'contender'
    : nowScore < c.rebuildThreshold && futureScore < c.rebuildThreshold ? 'rebuilding'
    : futureScore - nowScore >= c.risingDelta ? 'rising'
    : nowScore - futureScore >= c.decliningDelta ? 'declining'
    : 'competitive'

  return { status, nowScore, futureScore, luckAdjustedWinRate: record, coefficients: c, gaps: [] }
}

/**
 * Hysteresis.
 *
 * A window is a DERIVED fact, not a declared goal, so it settles on persistence
 * rather than on the user confirmation `strategy.ts` requires. The two must not
 * be merged: confirming a strategy is a user's decision, and a window changing
 * is an observation about the roster.
 */
export interface WindowState {
  active: WindowStatus
  /**
   * The present-strength score the active window was settled at, or null when
   * it was seeded rather than observed. The deadband is measured from here.
   */
  activeScore: number | null
  revision: number
  pending: { status: WindowStatus; firstWeek: number; lastWeek: number; observations: number; lastScore: number } | null
}

export const WINDOW_PERSISTENCE_WEEKS = 3

/**
 * Records at most one observation per week, forward only. Replaying earlier
 * weeks cannot manufacture the persistence a real transition has to earn.
 *
 * Two gates, and they answer different failures. The DEADBAND stops a team
 * sitting on a band edge from proposing a new window every other week without
 * having actually moved. The PERSISTENCE count in `settleWindow` stops a single
 * unusual week from counting as a move at all.
 */
export function observeWindow(
  state: WindowState,
  observation: { resolution: WindowResolution; week: number },
  coefficients: WindowCoefficients = DEFAULT_WINDOW_COEFFICIENTS,
): WindowState {
  const { resolution, week } = observation
  if (!Number.isInteger(week) || week < 1) return state
  const p = state.pending
  if (p && week <= p.lastWeek) return state
  // An unresolved week is not evidence of stability; it is simply not evidence.
  if (resolution.status === null || resolution.nowScore === null) return state
  if (resolution.status === state.active) return { ...state, pending: null }

  const moved = state.activeScore === null ||
    Math.abs(resolution.nowScore - state.activeScore) >= coefficients.materialScoreDelta
  if (!moved) return { ...state, pending: null }

  const contiguous = p !== null && p.status === resolution.status && week === p.lastWeek + 1
  return {
    ...state,
    pending: contiguous
      ? { ...p!, lastWeek: week, observations: p!.observations + 1, lastScore: resolution.nowScore }
      : { status: resolution.status, firstWeek: week, lastWeek: week, observations: 1, lastScore: resolution.nowScore },
  }
}

/**
 * Promotes a pending window only after it has held for three consecutive
 * observed weeks. Returns the state unchanged when it has not.
 */
export function settleWindow(state: WindowState): WindowState {
  const p = state.pending
  if (!p || p.observations < WINDOW_PERSISTENCE_WEEKS || p.lastWeek - p.firstWeek < WINDOW_PERSISTENCE_WEEKS - 1) return state
  return { active: p.status, activeScore: p.lastScore, revision: state.revision + 1, pending: null }
}
