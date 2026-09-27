/**
 * COMMISSIONER REVIEW MODE (design build-order step 6). PURE: facts in, a review out.
 *
 * Six checks, each computed here in code — the AI only explains them (`./explainTrade.ts`):
 *
 *   heavily_lopsided          gap over 40%                                                   high
 *   tanking_signal            strongly negative lineup impact while receiving mostly bench    high
 *   repeat_partners           the same two teams, 3+ trades this season, all leaning one way  medium
 *   inactive_manager          one side inactive 14+ days                                      medium
 *   eliminated_team_dumping   an eliminated team sends starters to a contender                medium
 *   deadline_rush             within 48 hours of the deadline and a gap over 25%              low
 *
 * 🛑 A CHECK WITH NO DATA IS `not_computed`, WITH THE REASON — NEVER A GUESS AND NEVER "CLEAR".
 * "We could not tell whether this manager is inactive" and "this manager is active" are different
 * statements, and only one of them is evidence. A not-computed check does not move the
 * recommendation; the commissioner is told which checks could not be run.
 *
 * 🛑 THE APP NEVER VETOES. `recommendation` is advice to a commissioner (Guap, 2026-09-27): any raised
 * HIGH flag → `consider_veto`, any MEDIUM → `review_with_managers`, otherwise `approve`.
 *
 * Named `TradeReview`, not `CommissionerReview`: `lib/trade-review/types.ts` already exports that name
 * for the older redraft snapshot review.
 */

export type ReviewFlagCode =
  | 'heavily_lopsided'
  | 'tanking_signal'
  | 'repeat_partners'
  | 'inactive_manager'
  | 'eliminated_team_dumping'
  | 'deadline_rush'

export type ReviewSeverity = 'low' | 'medium' | 'high'
export type ReviewCheckStatus = 'raised' | 'clear' | 'not_computed'
export type TradeReviewRecommendation = 'approve' | 'review_with_managers' | 'consider_veto'

export type ReviewCheck = {
  code: ReviewFlagCode
  severity: ReviewSeverity
  status: ReviewCheckStatus
  /** Plain language, with the numbers it rests on. Shown to the commissioner as written. */
  explanation: string
}

export type TradeReview = {
  /** The raised checks — the design's `flags`. */
  flags: Array<{ code: ReviewFlagCode; severity: ReviewSeverity; explanation: string }>
  /** All six, in a fixed order, including the clear and the not-computed ones. */
  checks: ReviewCheck[]
  recommendation: TradeReviewRecommendation
  model: typeof TRADE_REVIEW_MODEL
}

export const TRADE_REVIEW_MODEL = 'trade-review-v1'

// ─── Thresholds (design) ─────────────────────────────────────────────────────

export const LOPSIDED_GAP_PCT = 40
export const DEADLINE_RUSH_GAP_PCT = 25
export const DEADLINE_RUSH_WINDOW_MS = 48 * 60 * 60 * 1000
export const REPEAT_PARTNER_TRADES = 3
export const INACTIVE_DAYS = 14
/** The even band of the one grade (a C): a trade inside it leans nobody's way. */
export const LEAN_EVEN_BAND_PCT = 10
/**
 * "Strongly negative lineup impact": starting points fall by at least this share of what they were.
 * ⚠ UNCALIBRATED. The design names the signal, not the number; 10% of a starting lineup is a starter's
 * worth in most formats. Tune it on reviewed trades.
 */
export const TANK_LINEUP_DROP_SHARE = 0.1
/** "Mostly bench value": more than half the league value received would not start. */
export const TANK_BENCH_VALUE_SHARE = 0.5
/** Season forecast playoff odds, in percent. Under this, a team is treated as eliminated. */
export const ELIMINATED_PLAYOFF_PCT = 1
/** At or over this, a team is a contender. */
export const CONTENDER_PLAYOFF_PCT = 50

// ─── Facts ───────────────────────────────────────────────────────────────────

/** A fact that exists, or the reason it does not. */
export type Known<T> = { ok: true; value: T } | { ok: false; reason: string }

export type ReviewSideLineup = {
  /** Projected starting points this week, before the trade. */
  startingBefore: number
  /** Change in projected starting points this week. */
  startingDelta: number
  /** League value of everything this side receives, and the part of it that would NOT start. */
  receivedValue: number | null
  receivedBenchValue: number | null
  /** Players this side SENDS that start for it today. */
  sentStarterNames: string[]
}

export type TradeReviewFacts = {
  /** Side A is the receipt's graded (`give`) side; B the other. */
  sides: readonly [{ name: string }, { name: string }]
  /** The one grade's gap, signed from side A: + means A receives more. Null when withheld. */
  gapPct: Known<number>
  /** Per side, this week's lineup effect. */
  lineup: Known<readonly [ReviewSideLineup | null, ReviewSideLineup | null]>
  /**
   * Trades between these two teams this season, INCLUDING this one, each as its gap signed from side
   * A (null where that trade could not be graded).
   */
  history: Known<number[] | Array<number | null>>
  /** Days since each side's roster last changed (the commissioner hub's own inactivity basis); null when unknown. */
  inactiveDays: Known<readonly [number | null, number | null]>
  /** Season forecast playoff odds per side, in percent. */
  playoffPct: Known<readonly [number, number]>
  /** The deadline instant (ISO), or null when the league has no trade deadline. */
  deadlineAt: Known<string | null>
  now: string
}

// ─── The checks ──────────────────────────────────────────────────────────────

const pct = (n: number) => `${Math.round(Math.abs(n))}%`

function lopsided(f: TradeReviewFacts): ReviewCheck {
  const base = { code: 'heavily_lopsided' as const, severity: 'high' as const }
  if (!f.gapPct.ok) return { ...base, status: 'not_computed', explanation: `The trade is not graded: ${f.gapPct.reason}` }
  const g = f.gapPct.value
  const favoured = g > 0 ? f.sides[0].name : f.sides[1].name
  if (Math.abs(g) > LOPSIDED_GAP_PCT) {
    return { ...base, status: 'raised', explanation: `${favoured} receives ${pct(g)} more league value — past the ${LOPSIDED_GAP_PCT}% line for a heavily lopsided trade.` }
  }
  return { ...base, status: 'clear', explanation: `The value gap is ${pct(g)}, under the ${LOPSIDED_GAP_PCT}% line.` }
}

function tanking(f: TradeReviewFacts): ReviewCheck {
  const base = { code: 'tanking_signal' as const, severity: 'high' as const }
  if (!f.lineup.ok) return { ...base, status: 'not_computed', explanation: f.lineup.reason }
  const found: string[] = []
  let unknown = 0
  f.lineup.value.forEach((side, i) => {
    if (!side || side.receivedValue == null || side.receivedBenchValue == null || side.startingBefore <= 0) {
      unknown++
      return
    }
    const drop = -side.startingDelta
    const strongDrop = drop >= TANK_LINEUP_DROP_SHARE * side.startingBefore
    const benchShare = side.receivedValue > 0 ? side.receivedBenchValue / side.receivedValue : 0
    if (strongDrop && benchShare > TANK_BENCH_VALUE_SHARE) {
      found.push(
        `${f.sides[i]!.name}'s projected starting lineup falls ${drop.toFixed(1)} points this week (${pct((drop / side.startingBefore) * 100)} of it), ` +
          `and ${pct(benchShare * 100)} of the value it receives would not start.`,
      )
    }
  })
  if (found.length) return { ...base, status: 'raised', explanation: found.join(' ') }
  if (unknown) return { ...base, status: 'not_computed', explanation: 'The lineup effect could not be priced for every team in this trade.' }
  return { ...base, status: 'clear', explanation: 'Neither team gives up lineup strength for mostly bench value.' }
}

function repeatPartners(f: TradeReviewFacts): ReviewCheck {
  const base = { code: 'repeat_partners' as const, severity: 'medium' as const }
  if (!f.history.ok) return { ...base, status: 'not_computed', explanation: f.history.reason }
  const trades = f.history.value
  const n = trades.length
  if (n < REPEAT_PARTNER_TRADES) {
    return { ...base, status: 'clear', explanation: `${n === 1 ? 'This is their only trade' : `These two teams have made ${n} trades`} this season.` }
  }
  const graded = trades.flatMap((g) => (g == null ? [] : [g]))
  if (graded.length < n) {
    return { ...base, status: 'not_computed', explanation: `These two teams have made ${n} trades this season, but ${n - graded.length} of them could not be graded, so which way they lean is unknown.` }
  }
  const favoursA = graded.every((g) => g >= LEAN_EVEN_BAND_PCT)
  const favoursB = graded.every((g) => g <= -LEAN_EVEN_BAND_PCT)
  if (favoursA || favoursB) {
    const who = favoursA ? f.sides[0].name : f.sides[1].name
    return { ...base, status: 'raised', explanation: `These two teams have made ${n} trades this season, and every one favours ${who}.` }
  }
  return { ...base, status: 'clear', explanation: `These two teams have made ${n} trades this season, but they do not all lean one way.` }
}

function inactive(f: TradeReviewFacts): ReviewCheck {
  const base = { code: 'inactive_manager' as const, severity: 'medium' as const }
  if (!f.inactiveDays.ok) return { ...base, status: 'not_computed', explanation: f.inactiveDays.reason }
  const idle = f.inactiveDays.value.flatMap((d, i) => (d != null && d >= INACTIVE_DAYS ? [`${f.sides[i]!.name}'s roster has not changed in ${Math.floor(d)} days`] : []))
  if (idle.length) return { ...base, status: 'raised', explanation: `${idle.join('; ')} — ${INACTIVE_DAYS}+ days is inactive.` }
  if (f.inactiveDays.value.some((d) => d == null)) {
    return { ...base, status: 'not_computed', explanation: 'Recent activity is not on record for every team in this trade.' }
  }
  return { ...base, status: 'clear', explanation: `Both rosters have changed in the last ${INACTIVE_DAYS} days.` }
}

function eliminatedDumping(f: TradeReviewFacts): ReviewCheck {
  const base = { code: 'eliminated_team_dumping' as const, severity: 'medium' as const }
  if (!f.playoffPct.ok) return { ...base, status: 'not_computed', explanation: f.playoffPct.reason }
  const [pa, pb] = f.playoffPct.value
  const pairs: Array<[number, number]> = [[0, 1], [1, 0]]
  for (const [e, c] of pairs) {
    const pe = e === 0 ? pa : pb
    const pc = c === 0 ? pa : pb
    if (pe >= ELIMINATED_PLAYOFF_PCT || pc < CONTENDER_PLAYOFF_PCT) continue
    if (!f.lineup.ok || !f.lineup.value[e]) {
      return { ...base, status: 'not_computed', explanation: `${f.sides[e]!.name} is out of the playoff race (${pe.toFixed(1)}% odds) and ${f.sides[c]!.name} is a contender, but who starts for ${f.sides[e]!.name} could not be read.` }
    }
    const starters = f.lineup.value[e]!.sentStarterNames
    if (starters.length) {
      return {
        ...base,
        status: 'raised',
        explanation: `${f.sides[e]!.name} is out of the playoff race (${pe.toFixed(1)}% odds) and sends starters (${starters.join(', ')}) to ${f.sides[c]!.name}, a contender at ${pc.toFixed(0)}%.`,
      }
    }
  }
  return { ...base, status: 'clear', explanation: 'No eliminated team sends starters to a contender.' }
}

function deadlineRush(f: TradeReviewFacts): ReviewCheck {
  const base = { code: 'deadline_rush' as const, severity: 'low' as const }
  if (!f.deadlineAt.ok) return { ...base, status: 'not_computed', explanation: f.deadlineAt.reason }
  if (f.deadlineAt.value == null) return { ...base, status: 'clear', explanation: 'This league has no trade deadline.' }
  const deadline = Date.parse(f.deadlineAt.value)
  const now = Date.parse(f.now)
  const inWindow = now <= deadline && deadline - now <= DEADLINE_RUSH_WINDOW_MS
  if (!inWindow) return { ...base, status: 'clear', explanation: 'The trade is not within 48 hours of the deadline.' }
  if (!f.gapPct.ok) return { ...base, status: 'not_computed', explanation: 'The trade is within 48 hours of the deadline, but it is not graded, so the gap is unknown.' }
  if (Math.abs(f.gapPct.value) > DEADLINE_RUSH_GAP_PCT) {
    const hours = Math.max(0, Math.round((deadline - now) / 3_600_000))
    return { ...base, status: 'raised', explanation: `Proposed ${hours} hours before the trade deadline with a ${pct(f.gapPct.value)} value gap.` }
  }
  return { ...base, status: 'clear', explanation: `Within 48 hours of the deadline, but the gap (${pct(f.gapPct.value)}) is under ${DEADLINE_RUSH_GAP_PCT}%.` }
}

export function recommendationFor(checks: readonly ReviewCheck[]): TradeReviewRecommendation {
  const raised = checks.filter((c) => c.status === 'raised')
  if (raised.some((c) => c.severity === 'high')) return 'consider_veto'
  if (raised.some((c) => c.severity === 'medium')) return 'review_with_managers'
  return 'approve'
}

export function buildTradeReview(facts: TradeReviewFacts): TradeReview {
  const checks = [lopsided(facts), tanking(facts), repeatPartners(facts), inactive(facts), eliminatedDumping(facts), deadlineRush(facts)]
  return {
    flags: checks.filter((c) => c.status === 'raised').map(({ code, severity, explanation }) => ({ code, severity, explanation })),
    checks,
    recommendation: recommendationFor(checks),
    model: TRADE_REVIEW_MODEL,
  }
}
