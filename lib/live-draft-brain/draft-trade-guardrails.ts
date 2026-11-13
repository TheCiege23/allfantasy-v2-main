import type { CommissionerAiTeamAssignment } from './ai-manager'

export interface DraftTradeGuardrailContext {
  commissionerDisableAiTrades?: boolean
  allowAiOutboundProposals?: boolean
  allowAiAccept?: boolean
  minCooldownMsBetweenProposals?: number
  maxProposalsPerHour?: number
}

export function isAiToAiTrade(teamA: string, teamB: string, aiByTeamId: Map<string, CommissionerAiTeamAssignment>): boolean {
  const a = aiByTeamId.get(teamA)?.active
  const b = aiByTeamId.get(teamB)?.active
  return Boolean(a && b)
}

export function canAiProposeTrade(
  fromTeamId: string,
  toTeamId: string,
  aiByTeamId: Map<string, CommissionerAiTeamAssignment>,
  ctx: DraftTradeGuardrailContext
): { allowed: boolean; reason?: string } {
  if (ctx.commissionerDisableAiTrades) return { allowed: false, reason: 'Commissioner disabled AI draft trades.' }
  if (ctx.allowAiOutboundProposals === false) return { allowed: false, reason: 'Outbound AI proposals disabled.' }
  if (isAiToAiTrade(fromTeamId, toTeamId, aiByTeamId)) {
    return { allowed: false, reason: 'AI teams may not trade with each other during the draft.' }
  }
  const fromAi = aiByTeamId.get(fromTeamId)?.active
  const toAi = aiByTeamId.get(toTeamId)?.active
  if (fromAi && toAi) return { allowed: false, reason: 'AI-to-AI trades blocked.' }
  if (!fromAi && !toAi) return { allowed: true }
  return { allowed: true }
}

