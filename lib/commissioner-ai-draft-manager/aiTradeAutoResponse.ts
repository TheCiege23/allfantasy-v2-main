/**
 * Auto-accept/reject/counter for trade proposals where the receiver is a commissioner AI team.
 *
 * 🛑 THE VERDICT IS THE LEAGUE GRADE (2026-11-26) — `draftPickTradeCanonicalReview`, the same one the
 * human receiver is shown. A swap the chart cannot grade (a startup or redraft draft) is left PENDING for
 * the commissioner: an AI manager never accepts or rejects on a judgement nobody made.
 */

import { prisma } from '@/lib/prisma'
import { appendDraftPickTrades } from '@/lib/live-draft-engine/DraftPickTradeService'
import { draftPickTradeGraderSource, reviewDraftPickSwap } from '@/lib/live-draft-engine/draftPickTradeCanonicalReview'
import { logAction } from '@/lib/orphan-ai-manager/OrphanAIManagerService'
import { DEFAULT_TRADE_RULES } from './types'
import {
  getAssignmentForRoster,
  parseCommissionerAiManagers,
} from './CommissionerAiDraftManagerService'

/** The commissioner's accept-confidence floor is read against these; an even (C) grade is the weakest accept. */
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
      draftModeLabel?: string | null
      playerPool?: string | null
      c2cConfig?: unknown
      startedAt?: Date | null
      createdAt?: Date | null
    }

    const blob = parseCommissionerAiManagers(sessionRow.commissionerAiManagers)
    const rules = { ...DEFAULT_TRADE_RULES, ...blob.tradeRules }
    const assign = getAssignmentForRoster(blob, proposal.receiverRosterId)
    if (!assign || assign.allowInbound === false || !rules.allowInbound) return

    // Receiver (the AI team) POV: it gives receive*, it gets give*. League value; no viewer.
    const { review } = await reviewDraftPickSwap(draftPickTradeGraderSource({ leagueId }), sessionRow, {
      give: { round: proposal.receiveRound, slot: proposal.receiveSlot },
      get: { round: proposal.giveRound, slot: proposal.giveSlot },
    }, proposal.proposerName ?? null)
    if (review.verdict === 'not_graded') return

    // An even grade is a fair swap: answered like an accept, at the weakest accept confidence.
    const accepting = review.verdict === 'accept' || review.verdict === 'even'
    const conf = syntheticConfidence(review.verdict)
    if (accepting && conf < rules.acceptConfidenceMin) {
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
