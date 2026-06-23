/**
 * T10 — server-only trade-intelligence context builder.
 *
 * Assembles a structured, permission-filtered context object from the deterministic
 * T2–T9 layers for a given league/user (+ optional proposal/player/partner). It does
 * NOT invent numbers, NOT mutate anything, and NOT call external APIs. Privacy:
 * managers see league-visible data + their own private interests; commissioner-only
 * review is gated; no emails/tokens/session data; no other team's private strategy.
 */
import { resolveTradeRole, explainTrade, commissionerTradeReview, explainPlayerMarketValue, summarizeTradeBlock } from './tradeIntelligenceTools'
import type { TradeRole } from './types'

export interface TradeIntelligenceContextInput {
  leagueId: string
  userId: string
  proposalId?: string | null
  playerId?: string | null
  partnerRosterId?: string | null
}

export interface TradeIntelligenceContext {
  leagueId: string
  role: TradeRole
  myRosterId: string | null
  sport: string | null
  permissions: { canSeeCommissionerReview: boolean; canSeeOwnPrivateInterests: boolean }
  proposal: Awaited<ReturnType<typeof explainTrade>> | null
  commissionerReview: Awaited<ReturnType<typeof commissionerTradeReview>> | null
  playerValue: Awaited<ReturnType<typeof explainPlayerMarketValue>> | null
  tradeBlock: Awaited<ReturnType<typeof summarizeTradeBlock>> | null
  limitations: string[]
}

export async function buildTradeIntelligenceContext(
  input: TradeIntelligenceContextInput,
): Promise<TradeIntelligenceContext> {
  const { leagueId, userId } = input
  const { role, rosterId, sport } = await resolveTradeRole(leagueId, userId)
  const limitations: string[] = []

  const proposal = input.proposalId ? await explainTrade(input.proposalId) : null
  const commissionerReview =
    input.proposalId && role === 'commissioner' ? await commissionerTradeReview(input.proposalId, role) : null
  if (input.proposalId && role !== 'commissioner') {
    limitations.push('Commissioner-only trade review is not included for a non-commissioner.')
  }
  const playerValue = input.playerId ? await explainPlayerMarketValue(input.playerId, sport) : null
  const tradeBlock = await summarizeTradeBlock(leagueId, rosterId)

  return {
    leagueId,
    role,
    myRosterId: rosterId,
    sport,
    permissions: {
      canSeeCommissionerReview: role === 'commissioner',
      canSeeOwnPrivateInterests: role === 'commissioner' || role === 'manager',
    },
    proposal,
    commissionerReview,
    playerValue,
    tradeBlock,
    limitations,
  }
}
