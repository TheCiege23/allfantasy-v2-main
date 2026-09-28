/**
 * The Chimmy deep dive on the Trade Value tool — what the AI may say about a trade, and nothing else.
 * PURE, so the modal and the route share one shape.
 *
 * 🛑 NO VERDICT, NO SCORE, NO CONFIDENCE. The letter is the one AllFantasy grade (`result.grade` /
 * `chimmyPayload.grade`), shown by the modal from the analysis itself. Chimmy used to return a
 * `verdict` and a 0-100 `confidence` of its own beside it; the prompt no longer asks for them, and
 * this drops them anyway if a model sends them — a prompt is a request, not a guarantee.
 */
export type ChimmyTradeDeepDive = {
  explanation: string
  bestCase: string | null
  worstCase: string | null
  rebalanceIdeas: string[]
  alternateTargets: string[]
  warnings: string[]
  leagueNote: string | null
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const list = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.map(text).filter((s): s is string => Boolean(s)).slice(0, max) : []

/** The model's JSON, reduced to the explanation fields. Null when there is no explanation to show. */
export function chimmyTradeDeepDiveFrom(raw: unknown): ChimmyTradeDeepDive | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const explanation = text(r.explanation)
  if (!explanation) return null
  return {
    explanation,
    bestCase: text(r.bestCase),
    worstCase: text(r.worstCase),
    rebalanceIdeas: list(r.rebalanceIdeas, 4),
    alternateTargets: list(r.alternateTargets, 3),
    warnings: list(r.warnings, 4),
    leagueNote: text(r.leagueNote),
  }
}
