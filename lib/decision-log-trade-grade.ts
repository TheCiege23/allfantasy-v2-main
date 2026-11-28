/**
 * The TRADE GRADE beside a logged trade decision's OUTCOME grade (2026-11-26).
 *
 * A decision log row gets an `outcomeGrade` from `lib/decision-log.ts` `gradeOutcome`: the change in
 * the manager's roster value N weeks after the decision. That letter is about how things TURNED OUT,
 * not about the deal — and it was the only letter a trade decision carried, so "A" could mean either.
 * A trade decision now also shows the one trade grade of the deal itself, each labelled:
 * "Trade grade B · Outcome after 4 weeks: A".
 *
 * 🛑 THE TRADE GRADE IS THE ONE THE CANONICAL GRADER GAVE WHEN THE DECISION WAS LOGGED — NEVER A
 * RE-GRADE AND NEVER A GUESS. The legacy trade analyzer (`/api/legacy/trade/analyze`) grades through
 * `evaluateTrade()` and logs the decision in the same request; the receipt's letter and id are stamped
 * on the row under `ONE_TRADE_GRADE_KEY`, with `source: 'one_trade_engine'`. A row without that stamp
 * shows no trade grade:
 *   - rows logged before the stamp existed. ⚠ Those rows DO carry an `aiRecommendation.grade`, but
 *     before 2026-11-08 (c971315df7) that field held the AI model's own letter, after it the receipt's,
 *     and nothing on the row says which. Showing it would print a second engine's letter as the trade
 *     grade for an unknowable share of rows, so it is not read.
 *   - `trade_proposal` rows: one row per generator run over several packages — no single deal.
 *   - a deal the analyzer could not grade (no league, not your league): the stamp carries the withheld
 *     reason, and the row says "not graded" rather than inventing a letter.
 * Nothing in a decision log names a LeagueTrade or provider transaction, so there is no completed trade
 * whose frozen original grade could be read instead.
 *
 * ⚠ THE STAMP IS SERVER-WRITTEN ONLY. `POST /api/legacy/decision-log` accepts a client's
 * `aiRecommendation` verbatim, so it strips this key (`withoutServerOnlyDecisionKeys`) — a client
 * cannot plant a letter that would then be shown as the trade grade.
 */

export const ONE_TRADE_GRADE_KEY = 'oneTradeGrade' as const

export type DecisionTradeGradeStamp = {
  source: 'one_trade_engine'
  letter: string | null
  withheldReason: string | null
  evaluationReceiptId: string | null
  evaluatedAt: string | null
}

type ReceiptGradeLike = {
  receiptId: string | null
  evaluatedAt?: string | null
  grade: { graded: true; letter: string } | { graded: false; reason: string }
}

/** The stamp a writer puts on a trade decision, from the receipt it just got from `evaluateTrade()`. */
export function oneTradeGradeStamp(receipt: ReceiptGradeLike): DecisionTradeGradeStamp {
  const g = receipt.grade
  return {
    source: 'one_trade_engine',
    letter: g.graded ? g.letter : null,
    withheldReason: g.graded ? null : g.reason,
    evaluationReceiptId: receipt.receiptId ?? null,
    evaluatedAt: receipt.evaluatedAt ?? null,
  }
}

/** The decision types a stamp is read on: one deal per row. */
const ONE_DEAL_TYPES = new Set(['trade'])

/** The stamped trade grade of a logged decision, or null when the row does not identify a graded deal. */
export function decisionTradeGrade(log: { decisionType: string; aiRecommendation: unknown }): DecisionTradeGradeStamp | null {
  if (!ONE_DEAL_TYPES.has(log.decisionType)) return null
  const rec = log.aiRecommendation
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null
  const raw = (rec as Record<string, unknown>)[ONE_TRADE_GRADE_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const s = raw as Record<string, unknown>
  if (s.source !== 'one_trade_engine') return null
  const letter = typeof s.letter === 'string' && s.letter.trim() ? s.letter.trim() : null
  const withheldReason = typeof s.withheldReason === 'string' && s.withheldReason.trim() ? s.withheldReason.trim() : null
  if (!letter && !withheldReason) return null
  return {
    source: 'one_trade_engine',
    letter,
    withheldReason: letter ? null : withheldReason,
    evaluationReceiptId: typeof s.evaluationReceiptId === 'string' ? s.evaluationReceiptId : null,
    evaluatedAt: typeof s.evaluatedAt === 'string' ? s.evaluatedAt : null,
  }
}

/** The outcome half, always labelled as an outcome. */
export function outcomeGradeLabel(outcome: { outcomeGrade?: string | null; evaluationWeeks?: number | null } | null | undefined): string {
  const grade = outcome?.outcomeGrade && outcome.outcomeGrade !== 'N/A' ? outcome.outcomeGrade : null
  if (!grade) return 'Outcome: awaiting'
  const weeks = outcome?.evaluationWeeks
  return weeks && weeks > 0 ? `Outcome after ${weeks} week${weeks === 1 ? '' : 's'}: ${grade}` : `Outcome: ${grade}`
}

/** "Trade grade B · Outcome after 4 weeks: A" — or just the outcome when the deal is not identified. */
export function decisionGradeLine(
  tradeGrade: DecisionTradeGradeStamp | null,
  outcome: { outcomeGrade?: string | null; evaluationWeeks?: number | null } | null | undefined,
): string {
  const out = outcomeGradeLabel(outcome)
  if (!tradeGrade) return out
  const trade = tradeGrade.letter ? `Trade grade ${tradeGrade.letter}` : 'Trade grade: not graded'
  return `${trade} · ${out}`
}

/** How many trade decisions identify their deal's grade — the share this feature can show. */
export function tradeGradeCoverage(
  logs: ReadonlyArray<{ decisionType: string; aiRecommendation: unknown }>,
): { tradeDecisions: number; linked: number; graded: number } {
  let tradeDecisions = 0
  let linked = 0
  let graded = 0
  for (const log of logs) {
    if (!log.decisionType.startsWith('trade')) continue
    tradeDecisions++
    const g = decisionTradeGrade(log)
    if (g) linked++
    if (g?.letter) graded++
  }
  return { tradeDecisions, linked, graded }
}

/** A client-supplied `aiRecommendation` without the keys only the server may write. */
export function withoutServerOnlyDecisionKeys(rec: Record<string, unknown>): Record<string, unknown> {
  if (!(ONE_TRADE_GRADE_KEY in rec)) return rec
  const { [ONE_TRADE_GRADE_KEY]: _dropped, ...rest } = rec
  return rest
}
