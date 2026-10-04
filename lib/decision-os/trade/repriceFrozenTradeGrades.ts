/**
 * THE ONE-TIME RE-PRICE OF EXISTING FROZEN ORIGINALS (Decision 2, Guap 2026-10-03) — the plan, with
 * every read and the grading itself injected so it can be run against a faked database.
 *
 * Every v1 original (`completed_trade_grade_v1`) was frozen on the values of the day a surface first
 * read the trade. For each (AF league row, trade) pair that has no v2 row yet:
 *
 *   - the trade can be priced on its own date → a v2 `trade_date` row, graded by the same grader
 *     every new freeze uses (`completedTradeGrade.gradeAtTradeTime`), oriented exactly as the v1 row;
 *   - it cannot (no capture within a day before the trade, or an asset with no record on that date)
 *     → a v2 `first_graded` row carrying the v1 LETTER unchanged, `pricedAsOf` = the v1 `frozenAt`.
 *
 * WHY WRITE THE first_graded ROW RATHER THAN LET READERS DERIVE IT FROM v1. The label it earns —
 * "no market record from the trade date" — is a claim, and only something that checked the stored
 * captures may make it. A v1-only row has not been checked (the 88 v1 rows frozen on their own trade
 * day are coverable), so a reader derives nothing from v1 but the old "when first graded" wording.
 * Writing the determination down once is cheaper and truer than re-deriving coverability on every read.
 *
 * - IDEMPOTENT: a pair that already has a v2 row is skipped, so a re-run writes nothing twice.
 * - v1 ROWS ARE NEVER UPDATED OR DELETED. The plan only ever appends v2 rows.
 * - A pair whose deal cannot be found, or whose stored assets do not match the v1 row either way, is
 *   SKIPPED (no row) — it keeps the v1 letter and the v1 wording. It is never guessed.
 */
import type { TradeGradeView } from './tradeGrade'
import type { FrozenCompletedGradeV1, FrozenCompletedGradeV2 } from './frozenCompletedGrade'

type Graded = Extract<TradeGradeView, { graded: true }>

export type V1Pair = { afLeagueId: string; tradeId: string; row: FrozenCompletedGradeV1 }

/** What the grading step decided for one pair. A `trade_date` grade is oriented as `pair.row`. */
export type RepriceOutcome =
  | { kind: 'trade_date'; grade: Graded; pricedAsOf: string; tradeAt: string }
  | { kind: 'first_graded'; tradeAt: string | null; why: string }
  | { kind: 'skip'; why: string }

export type RepriceChange = {
  afLeagueId: string
  tradeId: string
  from: string
  to: string
  pricedAsOf: string
  /** When the v1 letter was frozen — a change on a pair frozen the same day says the books differed, not the market. */
  v1FrozenAt: string
  emailed: boolean
}

export type RepricePlan = {
  rows: Array<{ afLeagueId: string; v2: FrozenCompletedGradeV2 }>
  report: {
    pairs: number
    alreadyV2: number
    tradeDate: number
    sameLetter: number
    changedLetter: number
    changedAndEmailed: number
    firstGraded: number
    firstGradedWhy: Record<string, number>
    skipped: number
    skippedWhy: Record<string, number>
    changes: RepriceChange[]
    /** Every repriced pair, old letter → new letter. */
    perPair: Array<{ afLeagueId: string; tradeId: string; outcome: RepriceOutcome['kind']; from: string; to: string | null; why: string | null }>
  }
}

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1
}

export async function planFrozenGradeReprice(args: {
  pairs: ReadonlyArray<V1Pair>
  /** `${afLeagueId}:${tradeId}` pairs that already have a v2 row. */
  hasV2: ReadonlySet<string>
  /** Sleeper transaction ids a completion email was sent for (`trade-notify:sent:v1:` ledger). */
  emailed: ReadonlySet<string>
  reprice: (pair: V1Pair) => Promise<RepriceOutcome>
  now: Date
}): Promise<RepricePlan> {
  const report: RepricePlan['report'] = {
    pairs: args.pairs.length, alreadyV2: 0, tradeDate: 0, sameLetter: 0, changedLetter: 0, changedAndEmailed: 0,
    firstGraded: 0, firstGradedWhy: {}, skipped: 0, skippedWhy: {}, changes: [], perPair: [],
  }
  const rows: RepricePlan['rows'] = []
  const frozenAt = args.now.toISOString()
  const seen = new Set<string>()

  for (const pair of args.pairs) {
    const key = `${pair.afLeagueId}:${pair.tradeId}`
    if (seen.has(key)) continue // the caller hands the earliest v1 row per pair; never write two
    seen.add(key)
    if (args.hasV2.has(key)) {
      report.alreadyV2 += 1
      continue
    }
    const from = pair.row.grade.letter
    const outcome = await args.reprice(pair).catch((e: unknown): RepriceOutcome => ({
      kind: 'skip', why: `grading failed: ${e instanceof Error ? e.message.slice(0, 80) : 'unknown'}`,
    }))
    if (outcome.kind === 'skip') {
      report.skipped += 1
      bump(report.skippedWhy, outcome.why)
      report.perPair.push({ afLeagueId: pair.afLeagueId, tradeId: pair.tradeId, outcome: 'skip', from, to: null, why: outcome.why })
      continue
    }
    const base = { v: 2 as const, tradeId: pair.tradeId, give: pair.row.give, get: pair.row.get, frozenAt }
    if (outcome.kind === 'first_graded') {
      report.firstGraded += 1
      bump(report.firstGradedWhy, outcome.why)
      rows.push({
        afLeagueId: pair.afLeagueId,
        // The v1 LETTER, unchanged — only the determination that no record covers the date is new.
        v2: { ...base, grade: pair.row.grade, basis: 'first_graded', pricedAsOf: pair.row.frozenAt, tradeAt: outcome.tradeAt },
      })
      report.perPair.push({ afLeagueId: pair.afLeagueId, tradeId: pair.tradeId, outcome: 'first_graded', from, to: from, why: outcome.why })
      continue
    }
    const { current: _c, frozenAt: _f, frozenBasis: _b, pricedAsOf: _p, tradeAt: _t, ...grade } = outcome.grade
    rows.push({
      afLeagueId: pair.afLeagueId,
      v2: { ...base, grade: grade as Graded, basis: 'trade_date', pricedAsOf: outcome.pricedAsOf, tradeAt: outcome.tradeAt },
    })
    report.tradeDate += 1
    const to = outcome.grade.letter
    report.perPair.push({ afLeagueId: pair.afLeagueId, tradeId: pair.tradeId, outcome: 'trade_date', from, to, why: null })
    if (to === from) report.sameLetter += 1
    else {
      report.changedLetter += 1
      const emailed = args.emailed.has(pair.tradeId)
      if (emailed) report.changedAndEmailed += 1
      report.changes.push({ afLeagueId: pair.afLeagueId, tradeId: pair.tradeId, from, to, pricedAsOf: outcome.pricedAsOf, v1FrozenAt: pair.row.frozenAt, emailed })
    }
  }
  return { rows, report }
}
