/**
 * Decision OS — consumer-blind card adapter for `manager.trade.evaluate` (Slice 3).
 *
 * Renders a card purely FROM the Decision Object (never the engine/AI). Usable by the trade UI or a
 * Today Card later. No models/AI ever exposed — only the four answers + the deterministic evaluation.
 */
import type { Decision } from '@/lib/decision-os/core/decision'
import type { TradeEvaluation } from './decision'

export interface TradeCard {
  title: string
  subtitle: string
  detail: string
  grade: string | null
  fairnessScore: number | null
  legal: boolean
  proposalId: string | null
}

export function toTradeCard(decision: Decision<TradeEvaluation>): TradeCard {
  const legal = decision.rule_verdicts.every((v) => v.verdict !== 'illegal')
  const top = decision.recommended_actions[0] ?? null
  return {
    title: decision.four_answers.what_happened,
    subtitle: decision.four_answers.why_it_matters,
    detail: decision.four_answers.what_to_do,
    grade: top?.grade ?? null,
    fairnessScore: top?.fairnessScore ?? null,
    legal,
    proposalId: top?.proposalId ?? null,
  }
}
