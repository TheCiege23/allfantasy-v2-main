import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { marketEvidenceOf } from '@/lib/chimmy/marketEvidence'

/**
 * WHY THE VALUES MOVED, FROM REAL TRADES — one short list under a trade's letter (owner's call, 2026-11-22).
 *
 * The same measured reasons Chimmy cites (`lib/chimmy/marketEvidence.ts`): the AllFantasy trade market, the learned
 * pick / contend-rebuild / need tables, lineup factors — each verbatim from the grade, so the card can never say
 * something the grade did not. Renders nothing when no value in the grade was measured from completed trades.
 */
export const TRADE_CARD_EVIDENCE_MAX = 3

export function TradeMarketEvidence({
  grade,
  copy = (s) => s,
  max = TRADE_CARD_EVIDENCE_MAX,
}: {
  grade: TradeGradeView | null | undefined
  copy?: (text: string) => string
  max?: number
}) {
  if (!grade?.graded) return null
  const evidence = marketEvidenceOf(grade).slice(0, max)
  if (evidence.length === 0) return null
  return (
    <div className="af-tc-market-evidence" data-testid="trade-market-evidence">
      <div className="af-label">{copy('From real trades on AllFantasy')}</div>
      <ul aria-label={copy('Why values moved, measured from completed trades')}>
        {evidence.map((line) => (
          <li key={line}>{copy(line)}</li>
        ))}
      </ul>
    </div>
  )
}
