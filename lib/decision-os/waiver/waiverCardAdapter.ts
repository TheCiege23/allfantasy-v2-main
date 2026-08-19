/**
 * Decision OS — consumer-blind card adapter for `manager.waiver.claim` (Slice 2).
 *
 * Renders a card purely FROM the Decision Object (never the engine/AI). Usable by the waiver UI or a
 * Today Card later. No models/AI ever exposed — only the four answers + recommended claims.
 */
import type { Decision } from '@/lib/decision-os/core/decision'
import type { WaiverClaimRecommendation } from './decision'

export interface WaiverCard {
  title: string
  subtitle: string
  detail: string
  confidence: number
  legal: boolean
  topClaim: WaiverClaimRecommendation | null
}

export function toWaiverCard(decision: Decision<WaiverClaimRecommendation>): WaiverCard {
  const legal = decision.rule_verdicts.every((v) => v.verdict !== 'illegal')
  return {
    title: decision.four_answers.what_happened,
    subtitle: decision.four_answers.why_it_matters,
    detail: decision.four_answers.what_to_do,
    confidence: decision.confidence,
    legal,
    topClaim: decision.recommended_actions[0] ?? null,
  }
}
