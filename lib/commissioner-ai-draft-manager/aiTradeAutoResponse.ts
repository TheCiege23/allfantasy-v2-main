/**
 * Auto-accept/reject/counter for trade proposals where the receiver is a commissioner AI team.
 */

import { prisma } from '@/lib/prisma'
import { appendDraftPickTrades } from '@/lib/live-draft-engine/DraftPickTradeService'
import { buildDraftTradeAiReview } from '@/lib/live-draft-engine/DraftTradeAiReviewService'
import { logAction } from '@/lib/orphan-ai-manager/OrphanAIManagerService'
import { DEFAULT_TRADE_RULES } from './types'
import {
  getAssignmentForRoster,
  parseCommissionerAiManagers,
} from './CommissionerAiDraftManagerService'

function syntheticConfidence(verdict: string): number {
  if (verdict === 'accept') return 0.74
  if (verdict === 'reject') return 0.62
  return 0.48
}

/**
 * Fire-and-forget after a human proposes to an AI roster (receiver).
 */
export async function maybeAutoRespondToTradeProposal(leagueId: string, proposalId: string): Promise<void> {
  try {
    const proposal = await (prisma as any).draftPickTradeProposal.findFirst({
      where: { id: proposalId },
      include: { session: true },
    })
    if (!proposal || proposal.status !== 'pending' || !proposal.session || proposal.session.leagueId !== leagueId) return

    const sessionRow = proposal.session as {
      leagueId: string
      teamCount: number
      draftType?: string
      thirdRoundReversal?: boolean
      slotOrder: unknown
      commissionerAiManagers?: unknown
    }

    const blob = parseCommissionerAiManagers(sessionRow.commissionerAiManagers)
    const rules = { ...DEFAULT_TRADE_RULES, ...blob.tradeRules }
    const assign = getAssignmentForRoster(blob, proposal.receiverRosterId)
    if (!assign || assign.allowInbound === false || !rules.allowInbound) return

    const teamCount = sessionRow.teamCount
    const dt = (sessionRow.draftType ?? 'snake') as 'snake' | 'linear' | 'auction'
    const review = buildDraftTradeAiReview({
      giveRound: proposal.receiveRound,
      giveSlot: proposal.receiveSlot,
      receiveRound: proposal.giveRound,
      receiveSlot: proposal.giveSlot,
      teamCount,
      draftType: dt,
      thirdRoundReversal: Boolean(sessionRow.thirdRoundReversal),
    })

    const conf = syntheticConfidence(review.verdict)
    if (review.verdict === 'accept' && conf < rules.acceptConfidenceMin) {
      await (prisma as any).draftPickTradeProposal.update({
        where: { id: proposalId },
        data: {
          status: 'rejected',
          respondedAt: new Date(),
          responsePayload: { ai: true, reason: 'Below confidence threshold for accept.', review },
        },
      })
      await logAction({
        leagueId,
        rosterId: proposal.receiverRosterId,
        action: 'trade_reject',
        payload: { proposalId, review },
        reason: 'Chimmy receiver: below accept confidence threshold',
        triggeredBy: null,
      })
      return
    }

    if (review.verdict === 'reject') {
      await (prisma as any).draftPickTradeProposal.update({
        where: { id: proposalId },
        data: {
          status: 'rejected',
          respondedAt: new Date(),
          responsePayload: { ai: true, review },
        },
      })
      await logAction({
        leagueId,
        rosterId: proposal.receiverRosterId,
        action: 'trade_reject',
        payload: { proposalId, review },
        reason: review.summary,
        triggeredBy: null,
      })
      return
    }

    if (review.verdict === 'counter') {
      await (prisma as any).draftPickTradeProposal.update({
        where: { id: proposalId },
        data: {
          status: 'countered',
          respondedAt: new Date(),
          responsePayload: { ai: true, review, suggestedCounter: review.suggestedCounterPackage },
        },
      })
      await logAction({
        leagueId,
        rosterId: proposal.receiverRosterId,
        action: 'trade_counter',
        payload: { proposalId, review },
        reason: review.summary,
        triggeredBy: null,
      })
      return
    }

    const slotOrder = (sessionRow.slotOrder as { slot: number; rosterId: string; displayName: string }[]) ?? []
    const giveEntry = slotOrder.find((e: any) => e.slot === proposal.giveSlot)
    const receiveEntry = slotOrder.find((e: any) => e.slot === proposal.receiveSlot)
    const previousGive = giveEntry?.displayName ?? proposal.proposerName ?? 'Team'
    const previousReceive = receiveEntry?.displayName ?? proposal.receiverName ?? 'Team'
    const newTrades = [
      {
        round: proposal.giveRound,
        originalRosterId: proposal.giveOriginalRosterId,
        previousOwnerName: previousGive,
        newRosterId: proposal.receiverRosterId,
        newOwnerName: previousReceive || proposal.receiverName || 'Team',
      },
      {
        round: proposal.receiveRound,
        originalRosterId: proposal.receiveOriginalRosterId,
        previousOwnerName: previousReceive,
        newRosterId: proposal.proposerRosterId,
        newOwnerName: previousGive || proposal.proposerName || 'Team',
      },
    ]
    const appendResult = await appendDraftPickTrades(leagueId, newTrades as any)
    if (!appendResult.success) {
      await (prisma as any).draftPickTradeProposal.update({
        where: { id: proposalId },
        data: {
          status: 'rejected',
          respondedAt: new Date(),
          responsePayload: { ai: true, error: appendResult.error },
        },
      })
      return
    }

    await (prisma as any).draftPickTradeProposal.update({
      where: { id: proposalId },
      data: {
        status: 'accepted',
        respondedAt: new Date(),
        responsePayload: { ai: true, accepted: true, review },
      },
    })
    await logAction({
      leagueId,
      rosterId: proposal.receiverRosterId,
      action: 'trade_accept',
      payload: { proposalId, review },
      reason: review.summary,
      triggeredBy: null,
    })
  } catch (e) {
    console.error('[maybeAutoRespondToTradeProposal]', e)
  }
}
