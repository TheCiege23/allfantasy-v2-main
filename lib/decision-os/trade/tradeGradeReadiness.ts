import type {
  TradeEvidence,
  TradeEvidenceKey,
  TradeGradingPolicy,
} from '@/lib/trade-intel/tradeGradingPolicy'

export type TradeGradeReadiness = {
  contextualGradeAllowed: boolean
  marketComparisonAllowed: boolean
  missingRequired: TradeEvidenceKey[]
  missingSupporting: TradeEvidenceKey[]
  reason: string | null
}

/** Verdict readiness belongs to the canonical trade Decision OS. */
export function assessTradeGradeReadiness(
  policy: TradeGradingPolicy,
  evidence: TradeEvidence,
): TradeGradeReadiness {
  if (policy.eligibility !== 'enabled') {
    return {
      contextualGradeAllowed: false,
      marketComparisonAllowed: false,
      missingRequired: [],
      missingSupporting: [],
      reason:
        policy.eligibility === 'disabled'
          ? `Trades are disabled for this ${policy.format.replace('_', ' ')} league.`
          : `Trade eligibility was not captured for this ${policy.format.replace('_', ' ')} league.`,
    }
  }

  const missingRequired = policy.requiredEvidence.filter((key) => evidence[key] !== 'available')
  const missingSupporting = policy.supportingEvidence.filter(
    (key) => evidence[key] !== 'available' && evidence[key] !== 'not_applicable',
  )
  const marketComparisonAllowed =
    evidence.league_rules === 'available' &&
    evidence.trade_rules === 'available' &&
    evidence.as_of_asset_values === 'available'

  return {
    contextualGradeAllowed: missingRequired.length === 0,
    marketComparisonAllowed,
    missingRequired,
    missingSupporting,
    reason: missingRequired.length
      ? `Contextual grade withheld: missing ${missingRequired.join(', ').replaceAll('_', ' ')}.`
      : null,
  }
}
