/**
 * Policy for NPC/AI-manager draft pick trades — execution remains in existing trade routes;
 * this helper gates whether NPC agents may participate at all.
 */

export type CanNpcSendOrAcceptDraftTradeInput = {
  /** Commissioner opt-in on `commissionerAiManagers.tradeRules.npcDraftTradingEnabled`. */
  npcDraftTradingEnabled?: boolean
}

/**
 * NPC draft trades are **off by default** (`npcDraftTradingEnabled` must be explicitly `true`
 * on commissioner blob trade rules).
 */
export function canNpcSendOrAcceptDraftTrade(input: CanNpcSendOrAcceptDraftTradeInput): boolean {
  if (input.npcDraftTradingEnabled !== true) return false
  return true
}
