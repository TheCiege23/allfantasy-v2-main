/**
 * Chimmy may state a trade's letter only if the one trade engine gave it (design step 7, 2026-09-27).
 *
 * The tool loop answers most messages, and nothing checked what it said: the push path's number
 * checker never sees a tool-loop answer, and it does not look at letters. Prompt text ("quote these
 * letters exactly; state no other grade") is a request, not a guarantee. This is the guarantee.
 *
 * Pure — no imports. The route collects the letters the engine gave during the answer
 * (`ChimmyToolContext.tradeGrades`), checks the answer against them, retries once with a correction,
 * and otherwise answers with the engine's own summary.
 *
 * ⚠ ONLY LETTERS STATED AS GRADES COUNT. "Plan B", "an A-level talent", "a C.J. Stroud trade" are not
 * grades, and flagging them would refuse good answers. A letter counts when the words around it make
 * it one: "grades B", "graded a C+", "a B- grade", "B for you", "their side gets a D".
 */

export type ChimmyTradeGrade = {
  /** Every letter the engine gave this trade: the asker's side and the other side's. */
  letters: string[]
  /** One plain sentence stating those letters — the answer, if the model cannot state them itself. */
  summary: string
}

const LETTER = '([A-F][+-]?)(?![A-Za-z0-9+\\-])'
const EMPH = '\\*{0,2}'

/** Letters the text states as trade grades, in order, deduplicated. */
export function statedTradeLetters(text: string): string[] {
  const patterns = [
    // "grades B", "graded a C+", "grade: B-", "grade of A", "grading it a D"
    new RegExp(`\\b[Gg]rad(?:e[sd]?|ing)(?:\\s+(?:it|this|that|out|in|at|as|of|is|was))*\\s*[:—-]?\\s*(?:an?\\s+)?${EMPH}${LETTER}`, 'g'),
    // "a B- grade", "an A grade" — and "An A grade." opening a sentence
    new RegExp(`\\b[Aa]n?\\s+${EMPH}${LETTER}${EMPH}\\s+grade\\b`, 'g'),
    // "B for you", "a D for them", "C+ for your side", "an F for Rival" is too open — sides only
    new RegExp(`\\b${EMPH}${LETTER}${EMPH}\\s+for\\s+(?:you|them|your\\s+side|their\\s+side|the\\s+other\\s+side)\\b`, 'g'),
    // "your side gets a B", "their side grades C"
    new RegExp(`\\b(?:[Yy]our|[Tt]heir|[Tt]he\\s+other)\\s+side\\s+(?:gets|grades|is)\\s+(?:an?\\s+)?${EMPH}${LETTER}`, 'g'),
  ]
  const out: string[] = []
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const letter = m[1]!
      if (!out.includes(letter)) out.push(letter)
    }
  }
  return out
}

export type TradeLetterCheck =
  | { ok: true }
  | { ok: false; stated: string[]; allowed: string[]; reason: 'ungrounded_letter' | 'no_engine_grade' }

/** Every trade letter the answer states must be one the engine gave during this answer. */
export function checkTradeLetters(answer: string, grades: readonly ChimmyTradeGrade[]): TradeLetterCheck {
  const stated = statedTradeLetters(answer)
  if (stated.length === 0) return { ok: true }
  const allowed = [...new Set(grades.flatMap((g) => g.letters))]
  if (allowed.length === 0) return { ok: false, stated, allowed, reason: 'no_engine_grade' }
  const bad = stated.filter((l) => !allowed.includes(l))
  return bad.length === 0 ? { ok: true } : { ok: false, stated: bad, allowed, reason: 'ungrounded_letter' }
}

/** The correction a retry carries. */
export function tradeLetterCorrection(check: Extract<TradeLetterCheck, { ok: false }>, grades: readonly ChimmyTradeGrade[]): string {
  const given = grades.map((g) => g.summary).join(' ')
  return check.reason === 'no_engine_grade'
    ? `Your answer stated a trade grade (${check.stated.join(', ')}) without AllFantasy's trade engine grading the trade. Call evaluate_trade for the trade, or answer without any letter grade.`
    : `Your answer stated a trade grade (${check.stated.join(', ')}) that AllFantasy's trade engine did not give. The engine's grades are: ${given} Use only those letters.`
}

/** The answer when the model will not state the engine's letters: the engine's own words. */
export function tradeGradeFallback(grades: readonly ChimmyTradeGrade[]): string {
  if (grades.length === 0) {
    return "I can only grade a trade by running it through AllFantasy's trade engine in one of your leagues. Tell me what you'd give and what you'd get, and which league, and I'll grade it."
  }
  return grades.map((g) => g.summary).join('\n')
}

export type TradeLetterOutcome = 'clean' | 'retried' | 'fallback'

/**
 * Hold an answer to the engine's letters: pass it, or retry ONCE with a correction, or answer with the
 * engine's own summary. `retry` re-asks the model with the correction and returns its answer (null
 * when it could not); letters the retry's tools grade are read from `grades` again afterwards.
 */
export async function enforceTradeLetters(args: {
  answer: string
  grades: readonly ChimmyTradeGrade[]
  retry: (correction: string) => Promise<string | null>
}): Promise<{ text: string; outcome: TradeLetterOutcome; stated: string[] }> {
  const first = checkTradeLetters(args.answer, args.grades)
  if (first.ok) return { text: args.answer, outcome: 'clean', stated: [] }
  const second = await args.retry(tradeLetterCorrection(first, args.grades)).catch(() => null)
  if (second && checkTradeLetters(second, args.grades).ok) return { text: second, outcome: 'retried', stated: first.stated }
  return { text: tradeGradeFallback(args.grades), outcome: 'fallback', stated: first.stated }
}
