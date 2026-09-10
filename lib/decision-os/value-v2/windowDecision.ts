import {
  DEFAULT_WINDOW_COEFFICIENTS, observeWindow, resolveCompetitiveWindow, settleWindow,
  WINDOW_PERSISTENCE_WEEKS,
  type WindowCoefficients, type WindowResolution, type WindowState, type WindowStatus,
} from './window'
import { assembleWindowFacts, type WindowEvidence, type WindowFactsPort, type WindowFactsScope } from './windowFacts'
import { scheduledLookback } from './periodCalendar'

/**
 * The competitive window as a Decision OS consumer sees it.
 *
 * Three states, kept distinct because collapsing them is the defect this
 * replaces. `lib/franchise-window/WindowDetectionEngine.ts` returns
 * 'Competitive' from its final branch, so a team with no evidence and a
 * genuinely middling team are the same output.
 *
 *   evidenced — this week's evidence resolved, and it agrees with the settled window
 *   held      — this week's evidence resolved and DISAGREES, but has not persisted
 *               long enough to move the window. The held status is what applies.
 *   refused   — required evidence is missing or stale. No window, no adjustment.
 */
export type WindowDecisionState = 'evidenced' | 'held' | 'refused'

export interface WindowTeamFit {
  /** Multiplier on win-now team fit. 1 is neutral. Never applied to market value. */
  winNowWeight: number
  /** Multiplier on long-term/timeline team fit. 1 is neutral. */
  longTermWeight: number
  basis: WindowStatus | 'unresolved'
}

export const NEUTRAL_TEAM_FIT: WindowTeamFit = { winNowWeight: 1, longTermWeight: 1, basis: 'unresolved' }

/**
 * ⚠ TEAM FIT ONLY. These weights change how an asset suits THIS roster; they
 * never touch `marketValue`, which must stay identical for two managers in the
 * same cohort at the same timestamp.
 *
 * Only the two unambiguous windows move anything. 'competitive' is a genuine
 * middle and gets no directional push. 'declining' is deliberately neutral too:
 * a closing window argues for buying now AND for retooling, and picking one
 * would be a preference asserted as a finding.
 */
export function teamFitFor(status: WindowStatus | null): WindowTeamFit {
  switch (status) {
    case 'contender': return { winNowWeight: 1.15, longTermWeight: 0.9, basis: 'contender' }
    case 'rebuilding': return { winNowWeight: 0.85, longTermWeight: 1.15, basis: 'rebuilding' }
    case 'rising': return { winNowWeight: 0.95, longTermWeight: 1.05, basis: 'rising' }
    case 'competitive': return { winNowWeight: 1, longTermWeight: 1, basis: 'competitive' }
    case 'declining': return { winNowWeight: 1, longTermWeight: 1, basis: 'declining' }
    default: return NEUTRAL_TEAM_FIT
  }
}

export interface WindowDecision {
  version: '2.0'
  state: WindowDecisionState
  /** The window that applies. Null only when `state` is 'refused'. */
  status: WindowStatus | null
  /** This week's resolved classification, before hysteresis. Null when unresolved. */
  observed: WindowStatus | null
  teamFit: WindowTeamFit
  nowScore: number | null
  futureScore: number | null
  luckAdjustedWinRate: number | null
  /** 0..1 from the producing dynasty engine. Provenance; never a decision branch. */
  sourceConfidence: number | null
  hysteresis: {
    persistenceWeeks: number
    pendingStatus: WindowStatus | null
    pendingObservations: number
    weeksObserved: number[]
  }
  timestamps: {
    assembledAt: string
    forecastGeneratedAt: string | null
    dynastyGeneratedAt: string | null
    /** Week the forecast actually came from, which may lag the requested week. */
    forecastWeek: number | null
  }
  identity: { leagueId: string; season: number; week: number; teamId: string; teamName: string | null; managerName: string | null }
  coefficients: WindowCoefficients
  gaps: string[]
  evidence: WindowEvidence
}

export interface WindowDecisionOptions {
  /**
   * The league's scheduled periods, ascending, from `resolveScheduledPeriods`.
   *
   * Supplied: the lookback walks real scheduled predecessors, and a `scope.week` outside the
   * schedule REFUSES rather than inventing a window.
   * Absent: the arithmetic fallback runs and `SCHEDULE_UNAVAILABLE_GAP` is reported.
   */
  scheduledPeriods?: readonly number[]
  coefficients?: WindowCoefficients
  /** Seeded window for a team with no settled history. */
  seed?: WindowState
  now?: Date
}

/**
 * Reconstructs the observation sequence for hysteresis from dated weekly
 * artifacts, rather than from a new table.
 *
 * `WeeklyMatchup` carries a week, so an all-play record as of week W-2 is real
 * history. `SeasonForecastSnapshot` is keyed `(leagueId, season, week)`, so the
 * playoff probability believed at that week is a real dated artifact too.
 *
 * ⚠ TWO INPUTS DO NOT VARY BY WEEK AND THAT IS A DISCLOSED LIMITATION.
 * `DynastyProjectionSnapshot` is keyed per season, and the injury load is
 * current-only, so both historical observations carry today's figures. The
 * effect is bounded — the future half is constant across the window either way,
 * and the injury term scales only the playoff half — but a reconstructed
 * observation is NOT the same artifact a stored weekly classification would be,
 * and the gap says so.
 */
export const HISTORICAL_RECONSTRUCTION_GAP = 'hysteresis_history_reconstructed_not_stored'

/**
 * Emitted when no schedule was supplied and the lookback fell back to arithmetic.
 *
 * ⚠ THE FALLBACK ASSUMES EVERY INTEGER BELOW THE CURRENT WEEK IS A PERIOD OF THIS SEASON.
 * That is usually true mid-season and wrong at a season boundary or for a league whose
 * schedule ends early. Naming it keeps the assumption visible instead of silent.
 */
export const SCHEDULE_UNAVAILABLE_GAP = 'schedule_unavailable_lookback_assumed_contiguous'

/** The requested period is not in the league's schedule at all. */
export const PERIOD_NOT_SCHEDULED_GAP = 'period_not_in_schedule'

/** A refusal that carries no evidence — used when the period is not in the schedule at all. */
function refusedDecision(
  scope: WindowFactsScope,
  coefficients: WindowCoefficients,
  now: Date,
  gaps: readonly string[],
): WindowDecision {
  return {
    version: '2.0', state: 'refused', status: null, observed: null, teamFit: NEUTRAL_TEAM_FIT,
    nowScore: null, futureScore: null, luckAdjustedWinRate: null, sourceConfidence: null,
    hysteresis: { persistenceWeeks: WINDOW_PERSISTENCE_WEEKS, pendingStatus: null, pendingObservations: 0, weeksObserved: [] },
    timestamps: { assembledAt: now.toISOString(), forecastGeneratedAt: null, dynastyGeneratedAt: null, forecastWeek: null },
    identity: {
      leagueId: scope.leagueId, season: scope.season, week: scope.week, teamId: scope.teamId,
      teamName: null, managerName: null,
    },
    coefficients,
    gaps: [...new Set(gaps)],
    evidence: {
      identity: null, allPlay: null, forecast: null, dynasty: null, injuries: null,
      assembledAt: now.toISOString(),
    },
  }
}

export async function resolveWindowDecision(
  scope: WindowFactsScope,
  port: WindowFactsPort,
  options: WindowDecisionOptions = {},
): Promise<WindowDecision> {
  const coefficients = options.coefficients ?? DEFAULT_WINDOW_COEFFICIENTS
  const now = options.now ?? new Date()

  const scheduleGaps: string[] = []
  let weeks: number[]
  if (options.scheduledPeriods?.length) {
    const lookback = scheduledLookback(options.scheduledPeriods, scope.week, WINDOW_PERSISTENCE_WEEKS)
    if (lookback.kind === 'refused') {
      // A period outside the schedule has no window. Refuse rather than invent one.
      return refusedDecision(scope, coefficients, now, [PERIOD_NOT_SCHEDULED_GAP, lookback.reason])
    }
    weeks = [...lookback.periods]
  } else {
    weeks = []
    for (let w = scope.week - (WINDOW_PERSISTENCE_WEEKS - 1); w <= scope.week; w += 1) if (w >= 1) weeks.push(w)
    scheduleGaps.push(SCHEDULE_UNAVAILABLE_GAP)
  }

  const assembled = await Promise.all(
    weeks.map(week => assembleWindowFacts({ ...scope, week }, port, now)),
  )
  const current = assembled[assembled.length - 1]
  const currentResolution: WindowResolution = current.facts
    ? resolveCompetitiveWindow(current.facts, coefficients)
    : { status: null, nowScore: null, futureScore: null, luckAdjustedWinRate: null, coefficients, gaps: current.gaps }

  const identity = {
    leagueId: scope.leagueId, season: scope.season, week: scope.week, teamId: scope.teamId,
    teamName: current.evidence.identity?.teamName ?? null,
    managerName: current.evidence.identity?.managerName ?? null,
  }
  const timestamps = {
    assembledAt: current.evidence.assembledAt,
    forecastGeneratedAt: current.evidence.forecast?.generatedAt ?? null,
    dynastyGeneratedAt: current.evidence.dynasty?.generatedAt ?? null,
    forecastWeek: current.evidence.forecast?.week ?? null,
  }
  const sourceConfidence = typeof current.evidence.dynasty?.confidencePct === 'number'
    ? current.evidence.dynasty.confidencePct / 100 : null

  // No settled window and no resolvable evidence: refuse. Never 'competitive'.
  if (!current.facts || currentResolution.status === null) {
    return {
      version: '2.0', state: 'refused', status: null, observed: null, teamFit: NEUTRAL_TEAM_FIT,
      nowScore: null, futureScore: null, luckAdjustedWinRate: currentResolution.luckAdjustedWinRate,
      sourceConfidence,
      hysteresis: { persistenceWeeks: WINDOW_PERSISTENCE_WEEKS, pendingStatus: null, pendingObservations: 0, weeksObserved: [] },
      timestamps, identity, coefficients,
      gaps: [...new Set([...current.gaps, ...currentResolution.gaps, ...scheduleGaps])],
      evidence: current.evidence,
    }
  }

  // The settled window starts either from a supplied prior state or from the
  // earliest week that resolved — never from an assumed default.
  const resolutions = assembled.map(a =>
    a.facts ? resolveCompetitiveWindow(a.facts, coefficients) : null)
  const firstResolved = resolutions.find(r => r !== null && r.status !== null) ?? currentResolution

  let state: WindowState = options.seed ?? {
    active: firstResolved.status!, activeScore: firstResolved.nowScore, revision: 0, pending: null,
  }

  const weeksObserved: number[] = []
  for (let i = 0; i < weeks.length; i += 1) {
    const resolution = resolutions[i]
    if (!resolution || resolution.status === null) continue
    const before = state
    state = observeWindow(state, { resolution, week: weeks[i] }, coefficients)
    if (state.pending && state.pending.lastWeek === weeks[i] && state !== before) weeksObserved.push(weeks[i])
    state = settleWindow(state)
  }

  const applied = state.active
  const observed = currentResolution.status
  const decisionState: WindowDecisionState = applied === observed ? 'evidenced' : 'held'

  return {
    version: '2.0', state: decisionState, status: applied, observed,
    teamFit: teamFitFor(applied),
    nowScore: currentResolution.nowScore, futureScore: currentResolution.futureScore,
    luckAdjustedWinRate: currentResolution.luckAdjustedWinRate,
    sourceConfidence,
    hysteresis: {
      persistenceWeeks: WINDOW_PERSISTENCE_WEEKS,
      pendingStatus: state.pending?.status ?? null,
      pendingObservations: state.pending?.observations ?? 0,
      weeksObserved,
    },
    timestamps, identity, coefficients,
    gaps: [...new Set([...currentResolution.gaps, ...scheduleGaps, HISTORICAL_RECONSTRUCTION_GAP])],
    evidence: current.evidence,
  }
}
