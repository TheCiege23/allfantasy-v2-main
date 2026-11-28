/**
 * The draft-position FACT of a pick swap: how many picks you move, and which way (overall from board order).
 *
 * 🛑 FACTS ONLY (2026-11-26). This used to also return a fairness band ("favorable" / "costly"), a fairness
 * label ("strong value" … "overpay") and a move-quality tone ("good" / "risky"), all read off the overall
 * gap — three private judgements that could contradict the league grade. The verdict is the grade's now
 * (`draftPickTradeCanonicalReview.ts`); this says only where the picks sit.
 */

type TradeMoveDirection = 'up' | 'down' | 'neutral'

export type DraftPickTradeStructuredAnalysis = {
  /** Received overall minus given overall: negative moves you UP the board. */
  overallDelta: number | null
  moveDirection: TradeMoveDirection
}

export function buildDraftPickTradeStructuredAnalysis(input: {
  giveOverall: number | null
  receiveOverall: number | null
}): DraftPickTradeStructuredAnalysis {
  const g = input.giveOverall
  const r = input.receiveOverall
  if (g == null || r == null || !Number.isFinite(g) || !Number.isFinite(r)) {
    return { overallDelta: null, moveDirection: 'neutral' }
  }
  const delta = r - g
  return { overallDelta: delta, moveDirection: delta < 0 ? 'up' : delta > 0 ? 'down' : 'neutral' }
}
