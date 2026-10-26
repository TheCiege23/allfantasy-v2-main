/**
 * POST: Deterministic AI manager trade actions for orphan rosters.
 * Supports:
 * - intent=respond: evaluate accept/reject/counter (optional applyDecision for proposalId)
 * - intent=send: create deterministic outbound proposal draft (optional createProposal)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { getOrphanRosterIdsForLeague } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import {
  evaluateDeterministicTradeDecision,
  logAction,
} from '@/lib/orphan-ai-manager/OrphanAIManagerService'
import { getDraftSessionByLeague, buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { appendDraftPickTrades } from '@/lib/live-draft-engine/DraftPickTradeService'
import { computeUpcomingOwnedPicks } from '@/lib/live-draft-engine/draftPickTradeInventory'
import { isDraftPickTradingAllowedForLeague } from '@/lib/tournament-mode/safety'
import { prisma } from '@/lib/prisma'
import { tradeDeadlineRefusal } from '@/lib/trade-deadline/tradeDeadlineWindow'

export const dynamic = 'force-dynamic'

function toInt(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const uiSettings = await getDraftUISettingsForLeague(leagueId)
  if (!uiSettings.orphanTeamAiManagerEnabled) {
    return NextResponse.json({ error: 'Orphan team AI manager is not enabled.' }, { status: 400 })
  }
  if (!uiSettings.pickTradeEnabled) {
    return NextResponse.json({ error: 'Draft pick trading is disabled in draft settings.' }, { status: 400 })
  }
  const draftPickTradingAllowed = await isDraftPickTradingAllowedForLeague(leagueId)
  if (!draftPickTradingAllowed) {
    return NextResponse.json({ error: 'Draft pick trading is disabled for this league.' }, { status: 403 })
  }

  const draftSession = await getDraftSessionByLeague(leagueId)
  if (!draftSession || draftSession.status !== 'in_progress') {
    return NextResponse.json({ error: 'No draft in progress.' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const intent = String(body.intent ?? body.actionType ?? 'respond').toLowerCase()
  const rosterId = body.rosterId ?? body.roster_id
  if (!rosterId) return NextResponse.json({ error: 'rosterId required' }, { status: 400 })

  const orphanRosterIds = await getOrphanRosterIdsForLeague(leagueId)
  if (!orphanRosterIds.includes(rosterId)) {
    return NextResponse.json({ error: 'Roster is not an orphan; AI manager only acts for orphan rosters.' }, { status: 400 })
  }

  if (intent === 'send') {
    const targetRosterId = String(body.targetRosterId ?? body.partnerRosterId ?? body.target_roster_id ?? '').trim()
    if (!targetRosterId) {
      return NextResponse.json({ error: 'targetRosterId required for send intent' }, { status: 400 })
    }
    if (targetRosterId === rosterId) {
      return NextResponse.json({ error: 'targetRosterId cannot match rosterId' }, { status: 400 })
    }

    const slotOrder = ((draftSession as any).slotOrder ?? []) as Array<{ slot: number; rosterId: string; displayName: string }>
    const tradedPicks = (Array.isArray((draftSession as any).tradedPicks) ? (draftSession as any).tradedPicks : []) as Array<{
      round: number
      originalRosterId: string
      newRosterId: string
      previousOwnerName: string
      newOwnerName: string
    }>
    const teamCount = Number((draftSession as any).teamCount ?? 12)
    const rounds = Number((draftSession as any).rounds ?? 15)
    const pickedOverall = new Set<number>(((draftSession as any).picks ?? []).map((p: { overall: number }) => p.overall))
    const totalPicks = Math.max(1, teamCount * rounds)

    const orphanUpcoming = computeUpcomingOwnedPicks({
      totalPicks,
      pickedOverall,
      teamCount,
      draftType: ((draftSession as any).draftType ?? 'snake') as 'snake' | 'linear' | 'auction',
      thirdRoundReversal: Boolean((draftSession as any).thirdRoundReversal),
      slotOrder,
      tradedPicks,
      ownerRosterId: rosterId,
    })
    const targetUpcoming = computeUpcomingOwnedPicks({
      totalPicks,
      pickedOverall,
      teamCount,
      draftType: ((draftSession as any).draftType ?? 'snake') as 'snake' | 'linear' | 'auction',
      thirdRoundReversal: Boolean((draftSession as any).thirdRoundReversal),
      slotOrder,
      tradedPicks,
      ownerRosterId: targetRosterId,
    })
    if (orphanUpcoming.length === 0 || targetUpcoming.length === 0) {
      return NextResponse.json({ error: 'Unable to build proposal from remaining pick inventory.' }, { status: 400 })
    }

    const givePick = orphanUpcoming[0]
    const receivePick =
      targetUpcoming.find((pick) => Math.abs(pick.overall - givePick.overall) <= teamCount)
      ?? targetUpcoming[0]

    const proposerName = slotOrder.find((s) => s.rosterId === rosterId)?.displayName ?? 'AI Orphan Manager'
    const receiverName = slotOrder.find((s) => s.rosterId === targetRosterId)?.displayName ?? 'Manager'
    const summary = `AI manager suggests ${proposerName} send ${givePick.round}.${String(givePick.slot).padStart(2, '0')} for ${receiverName}'s ${receivePick.round}.${String(receivePick.slot).padStart(2, '0')}.`
    const createProposal = Boolean(body.createProposal ?? body.applyDecision ?? false)

    let createdProposalId: string | null = null
    if (createProposal) {
      const deadlineRefusal = await tradeDeadlineRefusal(leagueId)
      if (deadlineRefusal) return NextResponse.json({ error: deadlineRefusal, code: 'TRADE_DEADLINE_PASSED' }, { status: 409 })
      const created = await (prisma as any).draftPickTradeProposal.create({
        data: {
          sessionId: draftSession.id,
          proposerRosterId: rosterId,
          receiverRosterId: targetRosterId,
          giveRound: givePick.round,
          giveSlot: givePick.slot,
          giveOriginalRosterId: rosterId,
          receiveRound: receivePick.round,
          receiveSlot: receivePick.slot,
          receiveOriginalRosterId: targetRosterId,
          proposerName,
          receiverName,
          status: 'pending',
        },
        select: { id: true },
      })
      createdProposalId = created.id
    }

    await logAction({
      leagueId,
      rosterId,
      action: 'trade_send',
      payload: {
        intent,
        targetRosterId,
        proposal: {
          giveRound: givePick.round,
          giveSlot: givePick.slot,
          receiveRound: receivePick.round,
          receiveSlot: receivePick.slot,
          proposerName,
          receiverName,
        },
        createdProposalId,
      },
      reason: summary,
      triggeredBy: userId,
    })

    return NextResponse.json({
      ok: true,
      intent,
      decision: 'send',
      reason: summary,
      proposal: {
        giveRound: givePick.round,
        giveSlot: givePick.slot,
        receiveRound: receivePick.round,
        receiveSlot: receivePick.slot,
        proposerName,
        receiverName,
      },
      createdProposalId,
      logged: true,
    })
  }

  const proposalId = String(body.proposalId ?? body.proposal_id ?? '').trim()
  let giveRound = toInt(body.giveRound)
  let giveSlot = toInt(body.giveSlot)
  let receiveRound = toInt(body.receiveRound)
  let receiveSlot = toInt(body.receiveSlot)
  let proposalStatus: string | null = null

  if (proposalId) {
    const proposal = await (prisma as any).draftPickTradeProposal.findFirst({
      where: { id: proposalId, sessionId: draftSession.id },
      select: {
        id: true,
        status: true,
        proposerRosterId: true,
        receiverRosterId: true,
        giveRound: true,
        giveSlot: true,
        receiveRound: true,
        receiveSlot: true,
      },
    })
    if (!proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    if (proposal.receiverRosterId !== rosterId && proposal.proposerRosterId !== rosterId) {
      return NextResponse.json({ error: 'Proposal does not involve this orphan roster' }, { status: 400 })
    }
    proposalStatus = proposal.status
    giveRound = proposal.giveRound
    giveSlot = proposal.giveSlot
    receiveRound = proposal.receiveRound
    receiveSlot = proposal.receiveSlot
  }

  if (
    giveRound == null ||
    giveSlot == null ||
    receiveRound == null ||
    receiveSlot == null ||
    giveRound < 1 ||
    giveSlot < 1 ||
    receiveRound < 1 ||
    receiveSlot < 1
  ) {
    return NextResponse.json(
      { error: 'Trade context required: proposalId or giveRound/giveSlot/receiveRound/receiveSlot.' },
      { status: 400 }
    )
  }

  const result = evaluateDeterministicTradeDecision({
    giveRound,
    giveSlot,
    receiveRound,
    receiveSlot,
    teamCount: Number((draftSession as any).teamCount ?? 12),
  })

  const applyDecision = Boolean(body.applyDecision ?? body.apply_decision ?? false)
  let applied = false

  if (applyDecision && proposalId && proposalStatus === 'pending') {
    // An AI manager accepting for an orphan roster is still an acceptance, and the deadline binds it.
    const deadlineRefusal = result.decision === 'accept' ? await tradeDeadlineRefusal(leagueId) : null
    if (deadlineRefusal) return NextResponse.json({ error: deadlineRefusal, code: 'TRADE_DEADLINE_PASSED' }, { status: 409 })
    if (result.decision === 'accept') {
      const slotOrder = ((draftSession as any).slotOrder ?? []) as Array<{ slot: number; rosterId: string; displayName: string }>
      const giveEntry = slotOrder.find((entry) => entry.slot === giveSlot)
      const receiveEntry = slotOrder.find((entry) => entry.slot === receiveSlot)
      const previousGive = giveEntry?.displayName ?? 'Team'
      const previousReceive = receiveEntry?.displayName ?? 'Team'

      const proposal = await (prisma as any).draftPickTradeProposal.findUnique({
        where: { id: proposalId },
      })
      if (proposal) {
        const appendResult = await appendDraftPickTrades(leagueId, [
          {
            round: proposal.giveRound,
            originalRosterId: proposal.giveOriginalRosterId,
            previousOwnerName: previousGive,
            newRosterId: proposal.receiverRosterId,
            newOwnerName: previousReceive,
          },
          {
            round: proposal.receiveRound,
            originalRosterId: proposal.receiveOriginalRosterId,
            previousOwnerName: previousReceive,
            newRosterId: proposal.proposerRosterId,
            newOwnerName: previousGive,
          },
        ] as any)
        if (appendResult.success) {
          await (prisma as any).draftPickTradeProposal.update({
            where: { id: proposalId },
            data: {
              status: 'accepted',
              respondedAt: new Date(),
              responsePayload: {
                by: 'ai_manager',
                decision: result.decision,
                reason: result.reason,
              },
              updatedAt: new Date(),
            },
          })
          applied = true
        }
      }
    } else if (result.decision === 'reject') {
      await (prisma as any).draftPickTradeProposal.update({
        where: { id: proposalId },
        data: {
          status: 'rejected',
          respondedAt: new Date(),
          responsePayload: {
            by: 'ai_manager',
            decision: result.decision,
            reason: result.reason,
          },
          updatedAt: new Date(),
        },
      })
      applied = true
    } else if (result.decision === 'counter') {
      await (prisma as any).draftPickTradeProposal.update({
        where: { id: proposalId },
        data: {
          status: 'countered',
          respondedAt: new Date(),
          responsePayload: {
            by: 'ai_manager',
            decision: result.decision,
            reason: result.reason,
            suggestedCounterPackage: result.review.suggestedCounterPackage,
            counterReasons: result.review.counterReasons,
          },
          updatedAt: new Date(),
        },
      })
      applied = true
    }
  }

  await logAction({
    leagueId,
    rosterId,
    action: result.action,
    payload: {
      intent,
      proposalId: proposalId || undefined,
      proposalStatus: proposalStatus ?? undefined,
      tradeContext: {
        giveRound,
        giveSlot,
        receiveRound,
        receiveSlot,
      },
      decision: result.decision,
      applyDecision,
      applied,
      review: {
        summary: result.review.summary,
        reasons: result.review.reasons,
        declineReasons: result.review.declineReasons,
        counterReasons: result.review.counterReasons,
        suggestedCounterPackage: result.review.suggestedCounterPackage,
      },
    },
    reason: result.reason,
    triggeredBy: userId,
  })

  const updatedSession = applied ? await buildSessionSnapshot(leagueId) : null
  return NextResponse.json({
    ok: true,
    intent,
    decision: result.decision,
    action: result.action,
    reason: result.reason,
    summary: result.review.summary,
    reasons: result.review.reasons,
    declineReasons: result.review.declineReasons,
    counterReasons: result.review.counterReasons,
    suggestedCounterPackage: result.review.suggestedCounterPackage,
    applyDecision,
    applied,
    session: updatedSession,
    logged: true,
  })
}
