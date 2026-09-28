/**
 * T10 — server-only trade-intelligence context builder.
 *
 * Assembles a structured, permission-filtered context object from the deterministic
 * T2–T9 layers for a given league/user (+ optional player/partner). It does
 * NOT invent numbers, NOT mutate anything, and NOT call external APIs. Privacy:
 * managers see league-visible data + their own private interests; commissioner-only
 * review is gated; no emails/tokens/session data; no other team's private strategy.
 */
import { resolveTradeRole, explainPlayerMarketValue, summarizeTradeBlock } from './tradeIntelligenceTools'
import type { TradeRole } from './types'

export interface TradeIntelligenceContextInput {
  leagueId: string
  userId: string
  playerId?: string | null
  partnerRosterId?: string | null
}

export interface TradeIntelligenceContext {
  leagueId: string
  role: TradeRole
  myRosterId: string | null
  sport: string | null
  permissions: { canSeeCommissionerReview: boolean; canSeeOwnPrivateInterests: boolean }
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

  /*
   * No proposal branch (design step 7, 2026-09-27). It printed the proposal-time snapshot letter and ran
   * the retired redraft commissioner review, and no caller ever passed a proposal id to reach it. A
   * pending trade is graded by the one engine in `pendingTradeDecisionGrounding.ts`; a commissioner's
   * review is `GET /api/leagues/{id}/trades/{tradeId}/review`.
   */
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
    playerValue,
    tradeBlock,
    limitations,
  }
}
