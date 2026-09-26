import type { TradeConsolePlayerLine } from './types'

export type ProposalTradeRules = {
  tradesEnabled: boolean | null
  draftPickTrading: boolean | null
}

/** Eligibility is independent of value: prohibited assets do not become cheaper assets. */
export function proposalEligibilityReason(
  rules: ProposalTradeRules | null | undefined,
  lines: Pick<TradeConsolePlayerLine, 'pricedSource'>[],
): string | null {
  if (rules?.tradesEnabled === false) return 'Trades are disabled by this league’s rules.'
  if (rules?.draftPickTrading === false && lines.some(l => l.pricedSource === 'pick')) {
    return 'Draft pick trading is disabled in this league. Remove the picks before evaluating a permitted proposal.'
  }
  return null
}
