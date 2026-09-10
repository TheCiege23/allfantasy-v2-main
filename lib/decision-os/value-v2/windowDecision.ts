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
  /**
   * The scope the caller asked about, echoed back so an operator can find the
   * caller from a refusal.
   *
   * ⚠ THE FOUR SCOPE FIELDS ARE NULLABLE, AND ONLY A REFUSAL EVER SETS THEM NULL.
   * `invalidScopeReason` accepts `null`, `undefined` and non-objects and names
   * them `scope_missing` — so a refusal genuinely can have no league, team,
   * season or week to report. Typing them as `string`/`number` made this a lie
   * the compiler could not see: every malformed-identity refusal already wrote
   * `undefined` into a field declared `string`. Null is the honest value, and it
   * is the only one that does not invent a league id.
   *
   * On any non-refused decision all four are populated — validation has already
   * proved the scope well-formed before evidence is read.
   */
  identity: {
    leagueId: string | null
    season: number | null
    week: number | null
    teamId: string | null
    teamName: string | null
    managerName: string | null
  }
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

/** The caller supplied a scope that cannot describe a real scoring period. */
export const INVALID_SCOPE_GAP = 'window_scope_invalid'

/** Matches `twobs_ordinal_chk` in the observation schema. */
export const MAX_PERIOD_ORDINAL = 25

/**
 * Rejects a scope before ANY lookback is built.
 *
 * ⚠ THE ARITHMETIC PATH HAD NO UPPER OR FINITENESS GUARD, AND TWO DISTINCT FAILURES CAME
 * OUT OF IT. A week of 0, -1 or NaN pushed nothing, leaving `assembled[assembled.length - 1]`
 * undefined and throwing a TypeError on `.facts`. A week of Infinity was worse: `w += 1`
 * never advances past Infinity, so the loop never terminated at all — a hang rather than an
 * error. Validating here, before either branch, closes both.
 *
 * ⚠ THE PARAMETER IS `unknown`, NOT `WindowFactsScope`, AND THAT IS THE POINT. It was
 * declared as the latter while the body's first line tested `!scope` — a check TypeScript
 * believes can never fire, so the compiler offered no help when `refusedDecision` then
 * dereferenced the very value this had just called missing. Starting from `unknown` is what
 * makes the null branch a case the compiler can see rather than dead code it assumes away.
 */
function invalidScopeReason(scope: unknown): string | null {
  if (!scope || typeof scope !== 'object') return 'scope_missing'
  const s = scope as Partial<WindowFactsScope>
  if (typeof s.leagueId !== 'string' || !s.leagueId) return 'league_id_missing'
  if (typeof s.teamId !== 'string' || !s.teamId) return 'team_id_missing'
  if (!Number.isSafeInteger(s.season)) return 'season_not_an_integer'
  // Number.isSafeInteger is false for NaN, Infinity, fractions and anything past 2^53-1.
  if (!Number.isSafeInteger(s.week)) return 'week_not_an_integer'
  if ((s.week as number) < 1) return 'week_below_first_period'
  if ((s.week as number) > MAX_PERIOD_ORDINAL) return 'week_above_period_bound'
  return null
}

/** The requested period is not in the league's schedule at all. */
export const PERIOD_NOT_SCHEDULED_GAP = 'period_not_in_schedule'

/**
 * Echoes back whatever of the scope is actually usable, and nulls the rest.
 *
 * 🛑 THE GUARD NAMED AN INPUT THE REFUSAL THEN CRASHED ON. `invalidScopeReason`
 * returns `scope_missing` for `null`, `undefined` and non-objects — and
 * `refusedDecision` read `scope.leagueId` straight afterwards, so the one input
 * the contract explicitly claimed to support threw a TypeError instead of
 * refusing. The refusal for `scope_missing` was unreachable BY CONSTRUCTION: it
 * could only be produced by a value that made producing it throw.
 *
 * ⚠ A TYPE ANNOTATION IS NOT A RUNTIME GUARANTEE AT A TRUST BOUNDARY. The
 * declared parameter was `WindowFactsScope`, which is exactly why the
 * dereference looked safe on review. This resolver is reached from request
 * handlers with parsed JSON, so `unknown` is the truthful parameter type and the
 * narrowing is done here, once.
 *
 * Fields are echoed only when they carry the RIGHT PRIMITIVE TYPE, never
 * coerced. `week: 0` and `season: NaN` are wrong values but real ones, and an
 * operator diagnosing a bad caller needs to see what was actually sent —
 * replacing them with null would hide the evidence the echo exists to carry.
 * Anything absent or of the wrong type becomes null rather than `undefined`
 * masquerading as a `string`, which is what this previously produced.
 */
function scopeEcho(scope: unknown): WindowDecision['identity'] {
  const s = (scope && typeof scope === 'object' ? scope : {}) as Partial<WindowFactsScope>
  return {
    leagueId: typeof s.leagueId === 'string' ? s.leagueId : null,
    season: typeof s.season === 'number' ? s.season : null,
    week: typeof s.week === 'number' ? s.week : null,
    teamId: typeof s.teamId === 'string' ? s.teamId : null,
    teamName: null,
    managerName: null,
  }
}

/** A refusal that carries no evidence — used when the period is not in the schedule at all. */
function refusedDecision(
  scope: unknown,
  coefficients: WindowCoefficients,
  now: Date,
  gaps: readonly string[],
): WindowDecision {
  return {
    version: '2.0', state: 'refused', status: null, observed: null, teamFit: NEUTRAL_TEAM_FIT,
    nowScore: null, futureScore: null, luckAdjustedWinRate: null, sourceConfidence: null,
    hysteresis: { persistenceWeeks: WINDOW_PERSISTENCE_WEEKS, pendingStatus: null, pendingObservations: 0, weeksObserved: [] },
    timestamps: { assembledAt: now.toISOString(), forecastGeneratedAt: null, dynastyGeneratedAt: null, forecastWeek: null },
    identity: scopeEcho(scope),
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

  // Validate BEFORE any lookback is constructed and before the port is touched.
  const scopeProblem = invalidScopeReason(scope)
  if (scopeProblem) return refusedDecision(scope, coefficients, now, [INVALID_SCOPE_GAP, scopeProblem])

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
