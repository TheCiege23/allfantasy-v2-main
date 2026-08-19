/**
 * Decision OS — consumer-blind card adapter for `commissioner.league.health` (Slice 4).
 *
 * Renders a card purely FROM the Decision Object (never the engine/AI). Usable by the Commissioner
 * Hub later. No models/AI ever exposed — only the four answers + deterministic assessment. Actions
 * are read-only navigation suggestions; the card never executes anything.
 */
import type { Decision } from '@/lib/decision-os/core/decision'
import type { CommissionerHealthAssessment, CommissionerActionSuggestion } from './decision'

export interface CommissionerHealthCard {
  title: string
  subtitle: string
  detail: string
  healthScore: number | null
  overallStatus: string | null
  topRisks: { label: string; score: number }[]
  /** Navigation suggestions only — never executed. */
  recommendedActions: CommissionerActionSuggestion[]
  /** Decision OS is always read-only here. */
  readOnly: true
  legal: boolean
  leagueId: string | null
}

export function toCommissionerHealthCard(decision: Decision<CommissionerHealthAssessment>): CommissionerHealthCard {
  const a = decision.recommended_actions[0] ?? null
  const legal = decision.rule_verdicts.every((v) => v.verdict !== 'illegal')
  const topRisks = a
    ? [
        { label: 'Churn', score: a.churnRiskScore },
        { label: 'Abandonment', score: a.abandonmentRiskScore },
        { label: 'Dispute', score: a.disputeRiskScore },
      ]
        .filter((r) => r.score > 0)
        .sort((x, y) => y.score - x.score)
        .slice(0, 3)
    : []
  return {
    title: decision.four_answers.what_happened,
    subtitle: decision.four_answers.why_it_matters,
    detail: decision.four_answers.what_to_do,
    healthScore: a?.healthScore ?? null,
    overallStatus: a?.overallStatus ?? null,
    topRisks,
    recommendedActions: a?.suggestedActions ?? [],
    readOnly: true,
    legal,
    leagueId: a?.leagueId ?? null,
  }
}
