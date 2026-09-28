import { chimmyDecisionKind, type ChimmyDecisionKind } from './decisionAnswerContract'

/**
 * One message, several decisions: "Should I start Chase or Jefferson, and should I trade Kelce for
 * Bowers?"
 *
 * 🛑 THE WHOLE MESSAGE MUST NEVER REACH AN ENGINE. The trade parser splits a sentence on its first
 * " for ", so it read that question as Chase + Jefferson + Kelce given for Bowers: a three-for-one
 * trade nobody proposed, graded and charged, with the start/sit half silently dropped. Measured
 * 2026-09-28 against `splitSides` / `extractPlayerNameCandidates`.
 *
 * So a compound question is split into clauses, the FIRST decision clause is answered from its
 * own text alone, and the rest are named back to the user as unanswered. One charge buys one
 * answer, and the answer says which question it answered.
 *
 * Pure. Splits on sentence punctuation, and on "and" / "also" / "plus" only where a NEW question
 * starts ("…, and should I…", "… also who…"). That way "trade Kelce and Bowers for Chase" and
 * "start Chase and bench Kelce" stay one clause each.
 */

const QUESTION_START = String.raw`(?:should|would|can|could|do|does|is|are|who|whom|which|what|how|grade|rate|evaluate|also)\b`

/*
 * ⚠ A PERIOD BREAKS ONLY BEFORE A NEW QUESTION. "Amon-Ra St. Brown" and "Tyrone Tracy Jr. and a
 * 1st" carry periods inside a name, and breaking on ". <Capital>" cut them in half.
 */
const CLAUSE_BREAK = new RegExp(
  String.raw`(?<=[?!;])\s+|(?<=\.)\s+(?=${QUESTION_START})|,?\s+(?:and|also|plus)\s+(?=${QUESTION_START})|,\s+(?=${QUESTION_START})`,
  'i',
)

export type CompoundDecision = {
  /** The first decision clause: the only text any engine sees. */
  primary: string
  /** Every later decision clause, left unanswered and named back to the user. */
  others: Array<{ clause: string; kind: ChimmyDecisionKind }>
}

export function splitDecisionClauses(question: string): string[] {
  return question.split(CLAUSE_BREAK).map((c) => c.trim()).filter(Boolean)
}

/** Null unless the message holds two or more decision questions. */
export function compoundDecision(question: string): CompoundDecision | null {
  const decisions = splitDecisionClauses(question)
    .map((clause) => ({ clause, kind: chimmyDecisionKind(clause) }))
    .filter((c): c is { clause: string; kind: ChimmyDecisionKind } => c.kind !== null)
  if (decisions.length < 2) return null
  const [first, ...others] = decisions
  return { primary: first.clause, others }
}

/** The line that tells the user what was not answered, so one charge is never read as two answers. */
export function unansweredClausesNote(others: CompoundDecision['others']): string {
  const quoted = others.map((o) => `"${o.clause.replace(/^(?:and|also|plus)\s+/i, '')}"`).join(' and ')
  return `You also asked ${quoted}. That was not answered here: ask it on its own so it gets its own league check.`
}
