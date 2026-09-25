/**
 * GET: List draft pick trade proposals (member: pending where they are receiver OR proposer; commissioner: session-wide).
 * POST: Create a draft pick trade proposal.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { getDraftSessionByLeague } from '@/lib/live-draft-engine/DraftSessionService'
import { resolveOverallForRoundSlot } from '@/lib/live-draft-engine/draftPickTradeInventory'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { prisma } from '@/lib/prisma'
import { isDraftPickTradingAllowedForLeague } from '@/lib/tournament-mode/safety'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { buildDraftTradeAiReview } from '@/lib/live-draft-engine/DraftTradeAiReviewService'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import {
  canAiProposeTrade,
  checkAiProposalRoundCap,
  isRosterAiControlled,
  maybeAutoRespondToTradeProposal,
  parseCommissionerAiManagers,
  withUpdatedProposalThrottle,
  saveCommissionerAiManagers,
} from '@/lib/commissioner-ai-draft-manager'
import { sendPrivateTradeAIDM } from '@/lib/trade-ai-dm/TradeAIDMService'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const draftSession = await getDraftSessionByLeague(leagueId)
  if (!draftSession) return NextResponse.json({ proposals: [] })

  const myRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  const commissioner = await isCommissioner(leagueId, userId)

  let where: Record<string, unknown>
  if (commissioner) {
    where = { sessionId: draftSession.id }
  } else if (myRosterId) {
    where = {
      sessionId: draftSession.id,
      AND: [
        { status: 'pending' },
        {
          OR: [{ receiverRosterId: myRosterId }, { proposerRosterId: myRosterId }],
        },
      ],
    }
  } else {
    return NextResponse.json({ proposals: [] })
  }

  const list = await (prisma as any).draftPickTradeProposal.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return NextResponse.json({
    proposals: list.map((p: any) => ({
      id: p.id,
      sessionId: p.sessionId,
      proposerRosterId: p.proposerRosterId,
      receiverRosterId: p.receiverRosterId,
      giveRound: p.giveRound,
      giveSlot: p.giveSlot,
      giveOriginalRosterId: p.giveOriginalRosterId,
      receiveRound: p.receiveRound,
      receiveSlot: p.receiveSlot,
      receiveOriginalRosterId: p.receiveOriginalRosterId,
      proposerName: p.proposerName,
      receiverName: p.receiverName,
      status: p.status,
      respondedAt: p.respondedAt?.toISOString?.() ?? null,
      responsePayload: p.responsePayload,
      createdAt: p.createdAt.toISOString(),
    })),
  })
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
  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const myRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  if (!myRosterId) return NextResponse.json({ error: 'You do not have a roster in this league' }, { status: 403 })

  const draftPickTradingAllowed = await isDraftPickTradingAllowedForLeague(leagueId)
  if (!draftPickTradingAllowed) {
    return NextResponse.json({ error: 'Draft pick trading is disabled in Tournament Mode leagues.' }, { status: 403 })
  }
  const uiSettings = await getDraftUISettingsForLeague(leagueId)
  if (!uiSettings.pickTradeEnabled) {
    return NextResponse.json({ error: 'Draft pick trading is disabled in draft settings.' }, { status: 403 })
  }

  const draftSession = await getDraftSessionByLeague(leagueId)
  if (!draftSession || draftSession.status !== 'in_progress') {
    return NextResponse.json({ error: 'No draft in progress' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const giveRound = Math.max(1, Number(body.giveRound) || 1)
  const giveSlot = Math.max(1, Number(body.giveSlot) || 1)
  const receiveRound = Math.max(1, Number(body.receiveRound) || 1)
  const receiveSlot = Math.max(1, Number(body.receiveSlot) || 1)
  const receiverRosterId = String(body.receiverRosterId ?? body.receiver_roster_id ?? '').trim()
  const receiverName = body.receiverName ?? body.receiver_name ?? ''

  if (!receiverRosterId) return NextResponse.json({ error: 'receiverRosterId required' }, { status: 400 })
  if (receiverRosterId === myRosterId) {
    return NextResponse.json({ error: 'Cannot send a trade to your own roster.' }, { status: 400 })
  }
  if (giveRound > draftSession.rounds || receiveRound > draftSession.rounds) {
    return NextResponse.json({ error: 'Round out of range for this draft.' }, { status: 400 })
  }

  const slotOrder = (draftSession.slotOrder as { slot: number; rosterId: string; displayName: string }[]) ?? []
  const tradedPicks = Array.isArray((draftSession as any).tradedPicks)
    ? ((draftSession as any).tradedPicks as Array<{
        round: number
        originalRosterId: string
        previousOwnerName: string
        newRosterId: string
        newOwnerName: string
      }>)
    : []
  const giveBaseSlotEntry = slotOrder.find((e: any) => e.slot === giveSlot)
  const receiveBaseSlotEntry = slotOrder.find((e: any) => e.slot === receiveSlot)
  if (!giveBaseSlotEntry || !receiveBaseSlotEntry) {
    return NextResponse.json({ error: 'Invalid slot for this draft order.' }, { status: 400 })
  }
  const giveResolvedOwner = resolvePickOwner(giveRound, giveSlot, slotOrder, tradedPicks)
  const receiveResolvedOwner = resolvePickOwner(receiveRound, receiveSlot, slotOrder, tradedPicks)
  if (!giveResolvedOwner || giveResolvedOwner.rosterId !== myRosterId) {
    return NextResponse.json(
      {
        error: `You can only offer picks your roster currently owns. Current owner is ${
          giveResolvedOwner?.displayName ?? 'another manager'
        }.`,
      },
      { status: 400 }
    )
  }
  if (!receiveResolvedOwner || receiveResolvedOwner.rosterId !== receiverRosterId) {
    return NextResponse.json(
      {
        error: `Receive pick is not currently owned by ${receiverName || 'that manager'}.`,
      },
      { status: 400 }
    )
  }
  const giveOverall = resolveOverallForRoundSlot({
    round: giveRound,
    slot: giveSlot,
    teamCount: draftSession.teamCount,
    draftType: draftSession.draftType as 'snake' | 'linear' | 'auction',
    thirdRoundReversal: draftSession.thirdRoundReversal,
  })
  const receiveOverall = resolveOverallForRoundSlot({
    round: receiveRound,
    slot: receiveSlot,
    teamCount: draftSession.teamCount,
    draftType: draftSession.draftType as 'snake' | 'linear' | 'auction',
    thirdRoundReversal: draftSession.thirdRoundReversal,
  })
  const draftedOveralls = new Set((draftSession.picks ?? []).map((pick) => pick.overall))
  if ((giveOverall != null && draftedOveralls.has(giveOverall)) || (receiveOverall != null && draftedOveralls.has(receiveOverall))) {
    return NextResponse.json({ error: 'Cannot trade picks that are already on the board.' }, { status: 400 })
  }

  const aiBlob = parseCommissionerAiManagers((draftSession as { commissionerAiManagers?: unknown }).commissionerAiManagers)
  const proposeGate = canAiProposeTrade({
    blob: aiBlob,
    proposerRosterId: myRosterId,
    receiverRosterId,
    now: new Date(),
  })
  if (!proposeGate.allowed) {
    return NextResponse.json({ error: proposeGate.reason ?? 'Trade not allowed.' }, { status: 400 })
  }
  const picksCount = draftSession.picks?.length ?? 0
  const currentRound = Math.ceil((picksCount + 1) / Math.max(1, draftSession.teamCount))
  const capGate = checkAiProposalRoundCap(aiBlob, myRosterId, currentRound)
  if (!capGate.ok) {
    return NextResponse.json({ error: capGate.reason ?? 'Proposal cap reached.' }, { status: 400 })
  }

  const proposerSlotEntry = slotOrder.find((e: any) => e.rosterId === myRosterId)
  const receiverSlotEntry = slotOrder.find((e: any) => e.rosterId === receiverRosterId)
  const proposerName = proposerSlotEntry?.displayName ?? giveResolvedOwner.displayName ?? ''
  const resolvedReceiverName = receiverName || receiverSlotEntry?.displayName || receiveResolvedOwner.displayName || null

  const created = await (prisma as any).draftPickTradeProposal.create({
    data: {
      sessionId: draftSession.id,
      proposerRosterId: myRosterId,
      receiverRosterId,
      giveRound,
      giveSlot,
      // Keep canonical "original owner" stable for correct future ownership resolution.
      giveOriginalRosterId: giveBaseSlotEntry.rosterId,
      receiveRound,
      receiveSlot,
      receiveOriginalRosterId: receiveBaseSlotEntry.rosterId,
      proposerName,
      receiverName: resolvedReceiverName,
      status: 'pending',
    },
  })

  if (isRosterAiControlled(aiBlob, myRosterId)) {
    try {
      const nextBlob = withUpdatedProposalThrottle(aiBlob, myRosterId, currentRound, new Date())
      await saveCommissionerAiManagers(leagueId, nextBlob)
    } catch (e) {
      console.error('[trade-proposals AI throttle]', e)
    }
  }

  if (isRosterAiControlled(aiBlob, receiverRosterId)) {
    void maybeAutoRespondToTradeProposal(leagueId, created.id)
  }

  const { createDraftNotification, getAppUserIdForRoster, notifyDraftAiTradeReviewAvailable } = await import('@/lib/draft-notifications')
  const receiverUserId = await getAppUserIdForRoster(receiverRosterId)
  let privateAiDmSent = false
  let privateAiDmCounterSuggestion: string | null = null
  if (receiverUserId) {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true } })
    const aiReview = buildDraftTradeAiReview({
      giveRound: created.receiveRound,
      giveSlot: created.receiveSlot,
      receiveRound: created.giveRound,
      receiveSlot: created.giveSlot,
      teamCount: draftSession.teamCount,
      draftType: draftSession.draftType as 'snake' | 'linear' | 'auction',
      thirdRoundReversal: draftSession.thirdRoundReversal,
    })
    void createDraftNotification(receiverUserId, 'draft_trade_offer_received', {
      leagueId,
      leagueName: league?.name ?? undefined,
      tradeProposalId: created.id,
    })
    void notifyDraftAiTradeReviewAvailable(leagueId, receiverUserId, created.id)
    const privateAiDm = await sendPrivateTradeAIDM({
      receiverUserId,
      leagueId,
      proposalId: created.id,
      review: {
        verdict: aiReview.verdict,
        summary: aiReview.summary,
        reasons: aiReview.reasons,
        counterReasons: aiReview.counterReasons,
        declineReasons: aiReview.declineReasons,
        suggestedCounterPackage: aiReview.suggestedCounterPackage,
      },
      trigger: 'trade_received',
    })
    privateAiDmSent = privateAiDm.sent
    privateAiDmCounterSuggestion = privateAiDm.counterSuggestion
    void dispatchNotification({
      userIds: [receiverUserId],
      category: 'trade_proposals',
      productType: 'app',
      type: 'draft_trade_ai_private_review',
      title: `Private AI trade review${league?.name ? ` - ${league.name}` : ''}`,
      body: `${aiReview.summary} Suggested action: ${aiReview.verdict.toUpperCase()}. Counter suggestion: ${privateAiDm.counterSuggestion}.`,
      actionHref: `/league/${leagueId}?tab=Draft`,
      actionLabel: 'Open draft trade panel',
      meta: {
        leagueId,
        tradeProposalId: created.id,
        private: true,
        suggestedAction: aiReview.verdict,
        reasons: aiReview.reasons,
        counterReasons: aiReview.counterReasons,
        declineReasons: aiReview.declineReasons,
        suggestedCounterPackage: aiReview.suggestedCounterPackage,
        counterSuggestion: privateAiDm.counterSuggestion,
        privateAiDmSent: privateAiDm.sent,
      },
      severity: aiReview.verdict === 'reject' ? 'medium' : 'low',
    })
  }

  /*
   * The offer itself, in the DM between the two managers. The Chimmy review above goes to a private
   * `ai` thread the DM tab hides, so until now the one place two managers already talk never showed
   * the offer at all. Fire-and-forget: the proposal is saved, and the DM path must not fail it.
   */
  const proposalId = String(created.id)
  try {
    void Promise.all([
      import('@/lib/chat-notifications/tradeOfferDm'),
      import('@/lib/chat-notifications/tradeOfferSources'),
    ])
      .then(([dm, sources]) =>
        dm.postTradeOfferToDm({
          source: 'draft_pick',
          tradeId: proposalId,
          load: () =>
            sources.loadDraftPickTradeOffer({
              leagueId,
              proposalId,
              proposerUserId: userId,
              receiverRosterId,
            }),
        }),
      )
      .catch(() => undefined)
  } catch {
    /* never reaches the proposal response */
  }

  return NextResponse.json({
    ok: true,
    proposal: {
      id: created.id,
      giveRound: created.giveRound,
      giveSlot: created.giveSlot,
      receiveRound: created.receiveRound,
      receiveSlot: created.receiveSlot,
      receiverRosterId: created.receiverRosterId,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
      giveCurrentOwnerName: giveResolvedOwner.displayName,
      receiveCurrentOwnerName: receiveResolvedOwner.displayName,
    },
    privateAiReviewQueued: Boolean(receiverUserId),
    privateAiDmSent,
    privateAiDmCounterSuggestion,
    privacy: { aiReview: 'private' as const },
  })
}
