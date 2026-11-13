/**
 * Central facade — deterministic decisions. Optional LLM copy can wrap these results later.
 */

import type { BotProfile, DraftDecisionContext, DraftPickDecision, LineupDecision, TradeEvaluationContext, TradeProposalDecision, TradeResponseDecision, WaiverDecision } from "./types"
import { decideDraftPick } from "./draft/aiOpponentDraft"
import { decideLineup, type LineupContext } from "./lineups/aiOpponentLineups"
import { decideTradeOffer, decideTradeResponse } from "./trades/aiOpponentTrades"
import { decideWaiverClaims, type WaiverContext } from "./waivers/aiOpponentWaivers"

export function decideDraftPickRequest(ctx: DraftDecisionContext): DraftPickDecision {
  return decideDraftPick(ctx)
}

export function decideWaiverClaimsRequest(ctx: WaiverContext): WaiverDecision {
  return decideWaiverClaims(ctx)
}

export function decideLineupRequest(ctx: LineupContext): LineupDecision {
  return decideLineup(ctx)
}

export function decideTradeResponseRequest(ctx: TradeEvaluationContext): TradeResponseDecision {
  return decideTradeResponse(ctx)
}

export function decideTradeOfferRequest(bot: BotProfile, leagueId: string, teamId: string, cooldownBlocks: boolean): TradeProposalDecision {
  return decideTradeOffer(bot, leagueId, teamId, cooldownBlocks)
}

