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
  /** Which facts shape this set may score. Mismatched horizons refuse rather than rescale. */
  horizon: 'redraft' | 'dynasty'
  /** How far strength of remaining schedule may move the forward half. 0 disables it. */
  scheduleStrengthWeight: number
  contenderThreshold: number
  rebuildThreshold: number
  risingDelta: number
  decliningDelta: number
  /** A score move smaller than this is drift, not a material change. */
  materialScoreDelta: number
}

/**
 * 🛑 TWO SETS, VERSIONED SEPARATELY, AND THE VERSION STRINGS MUST NOT CONVERGE. A coefficient
 * version is what a stored observation's persistence count is keyed on, so reusing one string
 * across two horizons would let a redraft observation and a dynasty observation count toward the
 * same streak while measuring different quantities.
 */
export const DEFAULT_WINDOW_COEFFICIENTS: WindowCoefficients = {
  version: 'window-structural-dynasty-1',
  horizon: 'dynasty',
  calibration: 'uncalibrated-structural',
  nowRecord: 0.5,
  nowPlayoffProbability: 0.5,
  futureRosterStrength: 0.75,
  futurePickCapital: 0.25,
  scheduleStrengthWeight: 0,
  contenderThreshold: 0.62,
  rebuildThreshold: 0.38,
  risingDelta: 0.15,
  decliningDelta: 0.15,
  materialScoreDelta: 0.05,
}

/**
 * Redraft. One season, so the forward half is the rest of THIS season.
 *
 * ⚠ `futurePickCapital` IS ZERO AND `futureRosterStrength` IS ONE because a redraft league has no
 * future picks to hold — not because picks are being ignored. The blend validity check requires
 * the pair to sum to 1, and stating it explicitly is what keeps that check meaningful here.
 *
 * ⚠ `scheduleStrengthWeight` IS DELIBERATELY SMALL. Strength of remaining schedule is real
 * evidence but the weakest of the four, and it is the only one that is optional — a coefficient
 * large enough to flip a verdict on evidence that may be absent would make two teams with
 * identical rosters resolve differently based on whether anyone computed their slate.
 */
export const REDRAFT_WINDOW_COEFFICIENTS: WindowCoefficients = {
  version: 'window-structural-redraft-1',
  horizon: 'redraft',
  calibration: 'uncalibrated-structural',
  nowRecord: 0.5,
  nowPlayoffProbability: 0.5,
  futureRosterStrength: 1,
  futurePickCapital: 0,
  scheduleStrengthWeight: 0.1,
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
/**
 * 🛑 THE FACTS ARE DISCRIMINATED BY FORMAT, AND THAT IS A CORRECTNESS BOUNDARY, NOT TIDINESS.
 * One shared shape carrying both horizons meant a redraft league REQUIRED a three-year dynasty
 * projection to resolve at all, and — worse — that a five-year number could move a verdict about
 * a season that ends in December. A redraft team has no 2029. Splitting the type is what makes
 * "redraft cannot see dynasty inputs" a thing the compiler enforces rather than a rule to
 * remember: `rosterStrength3Year` does not EXIST on `RedraftWindowFacts`.
 */
interface SharedWindowFacts {
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

/**
 * A single-season league. Every input describes THIS season and nothing beyond it.
 *
 * ⚠ THERE IS DELIBERATELY NO `rosterStrength3Year`, NO FIVE-YEAR FIGURE AND NO PICK CAPITAL. A
 * redraft league does not have those seasons, and the absent fields are what stop one being
 * reintroduced by a well-meaning spread.
 */
export interface RedraftWindowFacts extends SharedWindowFacts {
  format: 'redraft'
  /** 0..1 share of the league's REMAINING projected scoring held by this roster. */
  restOfSeasonStrength: number | null
  /** `1 / teamsCovered` — the share an exactly average roster would hold. */
  leagueAverageShare: number
  /** 0..1, 0.5 = average remaining slate. Null when not derivable; optional evidence. */
  remainingScheduleStrength: number | null
}

/** A multi-season league, where a three-year horizon is a fact about the team rather than noise. */
export interface DynastyWindowFacts extends SharedWindowFacts {
  format: 'dynasty'
  /** 0..1, three seasons out. */
  rosterStrength3Year: number | null
  /** 0..1 accumulated future draft capital. Must be null unless `pickTreatment` is 'separate'. */
  futurePickCapital: number | null
  pickTreatment: PickTreatment
}

export type TeamWindowFacts = RedraftWindowFacts | DynastyWindowFacts

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

  /*
   * ⚠ THE COEFFICIENT SET MUST MATCH THE HORIZON IT IS SCORING. A dynasty set applied to redraft
   * facts would weight a rest-of-season share as if it were three-year strength, which is not the
   * same quantity even though both are 0..1. Refusing is the only honest option: rescaling between
   * two arbitrary scales is the unbacked coefficient this module already forbids.
   */
  if (c.horizon !== facts.format) {
    return {
      status: null, nowScore: null, futureScore: null, luckAdjustedWinRate: null,
      coefficients: c, gaps: ['window_coefficients_wrong_horizon'],
    }
  }

  const record = luckAdjustedWinRate(facts)
  if (record === null) gaps.push('record_or_schedule_luck_missing')

  const playoff = unitOrNull(facts.playoffProbability)
  if (playoff === null) gaps.push('playoff_probability_missing')

  /*
   * The forward half, per horizon.
   *
   * DYNASTY: three-year strength, optionally with pick capital carried separately.
   * REDRAFT: this roster's share of the league's REMAINING projected scoring, rebased so that an
   * exactly average roster scores 0.5. A raw share is ~1/12 in a 12-team league and would put
   * every team below every rebuild threshold — the rebase is a change of origin, not a
   * recalibration, and `leagueAverageShare` comes from the assembler rather than an assumed size.
   */
  let futureBase: number | null = null
  let separatePicks = false
  let picks: number | null = null

  if (facts.format === 'dynasty') {
    futureBase = unitOrNull(facts.rosterStrength3Year)
    if (futureBase === null) gaps.push('roster_strength_3y_missing')

    separatePicks = facts.pickTreatment === 'separate'
    picks = separatePicks ? unitOrNull(facts.futurePickCapital) : null
    if (separatePicks && picks === null) gaps.push('future_pick_capital_missing')
    // Supplying picks alongside a strength figure that already contains them is a
    // caller error, not a value to quietly ignore.
    if (!separatePicks && facts.futurePickCapital !== null) gaps.push('future_pick_capital_double_counted')
  } else {
    const share = unitOrNull(facts.restOfSeasonStrength)
    if (share === null) gaps.push('rest_of_season_strength_missing')
    else if (!Number.isFinite(facts.leagueAverageShare) || facts.leagueAverageShare <= 0) {
      gaps.push('league_average_share_invalid')
    } else {
      futureBase = Math.min(1, Math.max(0, 0.5 * (share / facts.leagueAverageShare)))
    }
  }

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

  /*
   * Strength of remaining schedule, when the league can supply it. 0.5 is neutral by definition,
   * so an absent value leaves `futureScore` exactly as it was — optional evidence must be
   * omittable without moving the answer.
   */
  const sos = facts.format === 'redraft' ? unitOrNull(facts.remainingScheduleStrength) : null
  const sosAdjusted = sos === null
    ? futureBase!
    : Math.min(1, Math.max(0, futureBase! * (1 + c.scheduleStrengthWeight * (sos - 0.5) * 2)))

  const futureScore = separatePicks
    ? c.futureRosterStrength * futureBase! + c.futurePickCapital * picks!
    : sosAdjusted

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
