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
 *   class_gap                 managers two or more Class divisions apart, and the trade      low
 *                             leans 10%+ toward the stronger one (ADR F2.10a, 2026-10-01)
 *
 * 🛑 A CHECK WITH NO DATA IS `not_computed`, WITH THE REASON — NEVER A GUESS AND NEVER "CLEAR".
 * "We could not tell whether this manager is inactive" and "this manager is active" are different
 * statements, and only one of them is evidence. A not-computed check does not move the
 * recommendation; the commissioner is told which checks could not be run.
 *
 * 🛑 THE APP NEVER VETOES. `recommendation` is advice to a commissioner (Guap, 2026-09-27): any raised
 * HIGH flag → `consider_veto`, any MEDIUM → `review_with_managers`, otherwise `approve`.
 *
 * Named `TradeReview`, not `CommissionerReview`, which was the older redraft snapshot review's type
 * (`lib/trade-review/types.ts`, deleted with that review on 2026-09-27).
 */

export type ReviewFlagCode =
  | 'heavily_lopsided'
  | 'tanking_signal'
  /** The same measurement as `tanking_signal`, in a league where selling for the future is normal. */
  | 'rebuild_signal'
  | 'repeat_partners'
  | 'inactive_manager'
  | 'eliminated_team_dumping'
  | 'deadline_rush'
  /**
   * The two managers are further apart in level than the ±2 band a league join allows, and the value
   * leans toward the more experienced one — the mismatch the manager-class system exists to prevent.
   * LOW on purpose: a level gap is context for a commissioner, never grounds for a veto by itself, and
   * a commissioner may have let the newer manager in deliberately.
   */
  | 'class_gap'

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
  /** Every check, in a fixed order, including the clear and the not-computed ones. */
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
 * Divisions apart that public matchmaking still pairs — the division band
 * (`lib/class-rating/divisionGate.ts` DIVISION_BAND, ADR F2.10a). Restated, not imported, so this file
 * stays free of anything outside the trade engine; `__tests__/decision-os/trade-review.test.ts` pins the
 * two to the same number.
 */
export const CLASS_GAP_DIVISIONS = 1
/**
 * "Strongly negative lineup impact": starting points fall by at least this share of what they were.
 * ⚠ UNCALIBRATED. The design names the signal, not the number; 10% of a starting lineup is a starter's
 * worth in most formats. Tune it on reviewed trades.
 */
export const TANK_LINEUP_DROP_SHARE = 0.1
/** "Mostly bench value": more than half the league value received would not start. */
export const TANK_BENCH_VALUE_SHARE = 0.5
/**
 * League types that carry players into next season, where selling lineup strength for future value is
 * a REBUILD, not tanking (Guap, 2026-09-27). There the same measurement raises `rebuild_signal` at
 * MEDIUM — "talk to the managers" — instead of `tanking_signal` at HIGH ("consider a veto"). The type is
 * the one the one grade priced the trade on, so the review and the grade agree about the format.
 */
export const REBUILD_LEAGUE_TYPES: readonly string[] = ['dynasty', 'keeper', 'devy', 'c2c']

export function rebuildIsNormal(leagueType: string | null | undefined): boolean {
  const t = String(leagueType ?? '').toLowerCase()
  return REBUILD_LEAGUE_TYPES.includes(t) || t.includes('dynasty')
}
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
  /**
   * The league type the one grade priced the trade on (`grade.leagueType`), with its label. Decides
   * whether a lineup sold for bench value is tanking or a rebuild. Absent: treated as redraft.
   */
  leagueType?: { type: string; label: string } | null
  /**
   * Each side's Class DIVISION (1–5, ADR F2.10a) from an ESTABLISHED rating; null for a side whose
   * manager is not an AllFantasy user or is still provisional. Never XP level — it measures volume,
   * not skill, and the owner ruled it out for matchmaking (2026-10-01). Absent: could not run.
   */
  managerDivisions?: Known<readonly [number | null, number | null]>
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
  // One measurement, two readings: tanking in a one-season league, a rebuild where rosters carry over.
  const rebuild = rebuildIsNormal(f.leagueType?.type)
  const base = rebuild
    ? { code: 'rebuild_signal' as const, severity: 'medium' as const }
    : { code: 'tanking_signal' as const, severity: 'high' as const }
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
  if (found.length) {
    const lead = rebuild
      ? `In a ${f.leagueType!.label.toLowerCase()} league this reads as a rebuild, which is normal — worth a word with both managers, not a veto. `
      : ''
    return { ...base, status: 'raised', explanation: lead + found.join(' ') }
  }
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

/**
 * The mismatch weight classes exist to prevent (ADR F2.10a): a stronger manager gaining from one two or
 * more Class divisions below. LOW on purpose — context for a commissioner, never grounds for a veto by
 * itself, and a commissioner may have invited the other manager deliberately.
 */
function classGap(f: TradeReviewFacts): ReviewCheck {
  const base = { code: 'class_gap' as const, severity: 'low' as const }
  if (!f.managerDivisions) return { ...base, status: 'not_computed', explanation: 'Manager Classes were not read for this review.' }
  if (!f.managerDivisions.ok) return { ...base, status: 'not_computed', explanation: f.managerDivisions.reason }
  const [da, db] = f.managerDivisions.value
  if (da == null || db == null) {
    return {
      ...base,
      status: 'not_computed',
      explanation: 'Only an AllFantasy manager with an established Class has a division, and one side of this trade does not.',
    }
  }
  const apart = Math.abs(da - db)
  if (apart <= CLASS_GAP_DIVISIONS) {
    return { ...base, status: 'clear', explanation: `The managers are Division ${da} and Division ${db} — close enough that a public league would match them.` }
  }
  const stronger = da > db ? 0 : 1
  const pair = `Division ${Math.max(da, db)} and Division ${Math.min(da, db)}, ${apart} divisions apart`
  if (!f.gapPct.ok) {
    return { ...base, status: 'not_computed', explanation: `The managers are ${pair}, but the trade is not graded, so which way it leans is unknown.` }
  }
  // Signed from side A: + means A receives more.
  const towardStronger = stronger === 0 ? f.gapPct.value : -f.gapPct.value
  if (towardStronger >= LEAN_EVEN_BAND_PCT) {
    return {
      ...base,
      status: 'raised',
      explanation: `${f.sides[stronger]!.name} (the stronger manager by Class) receives ${pct(towardStronger)} more value from a manager ${apart} divisions below — ${pair}. Worth a look if the other manager may not know what they gave up.`,
    }
  }
  return { ...base, status: 'clear', explanation: `The managers are ${pair}, but the trade does not lean toward the stronger one.` }
}

export function recommendationFor(checks: readonly ReviewCheck[]): TradeReviewRecommendation {
  const raised = checks.filter((c) => c.status === 'raised')
  if (raised.some((c) => c.severity === 'high')) return 'consider_veto'
  if (raised.some((c) => c.severity === 'medium')) return 'review_with_managers'
  return 'approve'
}

export function buildTradeReview(facts: TradeReviewFacts): TradeReview {
  const checks = [
    lopsided(facts),
    tanking(facts),
    repeatPartners(facts),
    inactive(facts),
    eliminatedDumping(facts),
    deadlineRush(facts),
    classGap(facts),
  ]
  return {
    flags: checks.filter((c) => c.status === 'raised').map(({ code, severity, explanation }) => ({ code, severity, explanation })),
    checks,
    recommendation: recommendationFor(checks),
    model: TRADE_REVIEW_MODEL,
  }
}
