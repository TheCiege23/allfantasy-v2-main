/**
 * POST: Respond to a draft pick trade proposal (accept | reject | counter).
 * Accept: appends two trades to session.tradedPicks and marks proposal accepted.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { appendDraftPickTrades, type DraftPickTradeSessionView } from '@/lib/live-draft-engine/DraftPickTradeService'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { resolveOverallForRoundSlot } from '@/lib/live-draft-engine/draftPickTradeInventory'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { onTradeReaction } from '@/lib/commentary-engine'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { prisma } from '@/lib/prisma'
import { isDraftPickTradingAllowedForLeague } from '@/lib/tournament-mode/safety'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { queueTradeStatusInDm } from '@/lib/chat-notifications/tradeOfferDm'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; proposalId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId, proposalId } = await ctx.params
  if (!leagueId || !proposalId) return NextResponse.json({ error: 'Missing leagueId or proposalId' }, { status: 400 })
  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const myRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  const proposal = await (prisma as any).draftPickTradeProposal.findFirst({
    where: { id: proposalId },
    include: { session: { select: { leagueId: true, slotOrder: true } } },
  })
  if (!proposal || !proposal.session || proposal.session.leagueId !== leagueId) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  }
  if (proposal.status !== 'pending') {
    return NextResponse.json({ error: 'Proposal already responded to' }, { status: 400 })
  }
  if (proposal.receiverRosterId !== myRosterId) {
    return NextResponse.json({ error: 'Only the receiver can respond to this proposal' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const action = (body.action ?? body.response ?? 'reject').toLowerCase()

  if (action === 'accept') {
    const draftPickTradingAllowed = await isDraftPickTradingAllowedForLeague(leagueId)
    if (!draftPickTradingAllowed) {
      return NextResponse.json({ error: 'Draft pick trading is disabled in Tournament Mode leagues.' }, { status: 403 })
    }
    const uiSettings = await getDraftUISettingsForLeague(leagueId)
    if (!uiSettings.pickTradeEnabled) {
      return NextResponse.json({ error: 'Draft pick trading is disabled in draft settings.' }, { status: 403 })
    }

    const slotOrder = (proposal.session?.slotOrder as { slot: number; rosterId: string; displayName: string }[]) ?? []
    /*
     * 🛑 THE TWO TEAMS TRADING, BY ROSTER — NOT THE ORIGINAL OWNERS OF THE TWO SLOTS. These were read
     * by `giveSlot`/`receiveSlot`, which is the same team only for a pick that has never moved. Once a
     * pick had been traded, flipping it again named the new owner after its first owner: the board and
     * the on-the-clock banner showed a third team's name against the right roster (2026-10-26).
     */
    const nameOf = (rosterId: string) => slotOrder.find((e: any) => e.rosterId === rosterId)?.displayName
    const previousGive = nameOf(proposal.proposerRosterId) ?? proposal.proposerName ?? 'Team'
    const previousReceive = nameOf(proposal.receiverRosterId) ?? proposal.receiverName ?? 'Team'
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
    const appendResult = await appendDraftPickTrades(leagueId, newTrades as any, {
      sessionId: proposal.sessionId,
      validate: (s) => validateAcceptAgainstSession(proposal, s),
    })
    if (!appendResult.success) {
      return NextResponse.json({ error: appendResult.error ?? 'Failed to record trade' }, { status: 400 })
    }
    await (prisma as any).draftPickTradeProposal.update({
      where: { id: proposalId },
      data: { status: 'accepted', respondedAt: new Date(), responsePayload: { accepted: true }, updatedAt: new Date() },
    })
    void emitAcceptedTradeCommentary({
      leagueId,
      proposerName: proposal.proposerName,
      receiverName: proposal.receiverName,
      giveRound: proposal.giveRound,
      receiveRound: proposal.receiveRound,
      previousGive,
      previousReceive,
    })
    // The answer, under the offer card in the two managers' DM. Fire-and-forget; no-op when there is no card.
    queueTradeStatusInDm({ source: 'draft_pick', tradeId: proposalId, status: 'accepted', actorUserId: userId, detail: 'The picks have moved.' })
    const updated = await buildSessionSnapshot(leagueId)
    return NextResponse.json({ ok: true, action: 'accepted', session: updated })
  }

  if (action === 'reject') {
    const reason = body.reason ?? body.declineReason ?? null
    await (prisma as any).draftPickTradeProposal.update({
      where: { id: proposalId },
      data: { status: 'rejected', respondedAt: new Date(), responsePayload: { reason }, updatedAt: new Date() },
    })
    queueTradeStatusInDm({ source: 'draft_pick', tradeId: proposalId, status: 'rejected', actorUserId: userId })
    return NextResponse.json({ ok: true, action: 'rejected' })
  }

  if (action === 'counter') {
    const counterPayload = body.counterPayload ?? body.counter ?? {}
    await (prisma as any).draftPickTradeProposal.update({
      where: { id: proposalId },
      data: { status: 'countered', respondedAt: new Date(), responsePayload: counterPayload, updatedAt: new Date() },
    })
    return NextResponse.json({ ok: true, action: 'countered' })
  }

  return NextResponse.json({ error: 'Invalid action; use accept, reject, or counter' }, { status: 400 })
}

/** Only the proposer can cancel while pending (withdraw sent offer). */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; proposalId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId, proposalId } = await ctx.params
  if (!leagueId || !proposalId) return NextResponse.json({ error: 'Missing leagueId or proposalId' }, { status: 400 })
  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const myRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  const proposal = await (prisma as any).draftPickTradeProposal.findFirst({
    where: { id: proposalId },
    include: { session: { select: { leagueId: true } } },
  })
  if (!proposal || !proposal.session || proposal.session.leagueId !== leagueId) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  }
  if (proposal.status !== 'pending') {
    return NextResponse.json({ error: 'Proposal already settled' }, { status: 400 })
  }
  if (proposal.proposerRosterId !== myRosterId) {
    return NextResponse.json({ error: 'Only the proposing manager can withdraw this offer' }, { status: 403 })
  }

  await (prisma as any).draftPickTradeProposal.update({
    where: { id: proposalId },
    data: {
      status: 'cancelled',
      respondedAt: new Date(),
      responsePayload: { cancelledBy: 'proposer' },
      updatedAt: new Date(),
    },
  })

  queueTradeStatusInDm({ source: 'draft_pick', tradeId: proposalId, status: 'cancelled', actorUserId: userId })
  return NextResponse.json({ ok: true, action: 'cancelled' })
}

async function emitAcceptedTradeCommentary(input: {
  leagueId: string
  proposerName?: string | null
  receiverName?: string | null
  giveRound: number
  receiveRound: number
  previousGive: string
  previousReceive: string
}) {
  try {
    const league = await (prisma as any).league.findUnique({
      where: { id: input.leagueId },
      select: { name: true, sport: true },
    })
    const sport = normalizeToSupportedSport(league?.sport)
    const managerA = input.proposerName?.trim() || input.previousGive || 'Manager A'
    const managerB = input.receiverName?.trim() || input.previousReceive || 'Manager B'
    const summary = `${managerA} and ${managerB} swapped draft capital: round ${input.giveRound} for round ${input.receiveRound}.`

    await onTradeReaction(
      {
        eventType: 'trade_reaction',
        leagueId: input.leagueId,
        sport,
        leagueName: league?.name ?? undefined,
        managerA,
        managerB,
        summary,
        tradeType: 'draft_pick_swap',
      },
      { skipStats: true, persist: true }
    )
  } catch {
    // non-fatal
  }
}

/**
 * The same checks the propose route makes, re-run against the session as it stands at accept time:
 * a pending offer can outlive its picks (made, or traded away elsewhere) and the draft itself.
 */
function validateAcceptAgainstSession(
  proposal: {
    proposerRosterId: string
    receiverRosterId: string
    giveRound: number
    giveSlot: number
    receiveRound: number
    receiveSlot: number
  },
  s: DraftPickTradeSessionView
): string | null {
  if (s.status !== 'in_progress') return 'The draft is no longer in progress.'
  const giveOwner = resolvePickOwner(proposal.giveRound, proposal.giveSlot, s.slotOrder, s.tradedPicks)
  const receiveOwner = resolvePickOwner(proposal.receiveRound, proposal.receiveSlot, s.slotOrder, s.tradedPicks)
  if (!giveOwner || giveOwner.rosterId !== proposal.proposerRosterId) {
    return 'The offered pick is no longer owned by the proposing manager.'
  }
  if (!receiveOwner || receiveOwner.rosterId !== proposal.receiverRosterId) {
    return 'You no longer own the requested pick.'
  }
  const overallFor = (round: number, slot: number) =>
    resolveOverallForRoundSlot({
      round,
      slot,
      teamCount: s.teamCount,
      draftType: s.draftType as 'snake' | 'linear' | 'auction',
      thirdRoundReversal: s.thirdRoundReversal,
    })
  const giveOverall = overallFor(proposal.giveRound, proposal.giveSlot)
  const receiveOverall = overallFor(proposal.receiveRound, proposal.receiveSlot)
  if ((giveOverall != null && s.draftedOveralls.has(giveOverall)) || (receiveOverall != null && s.draftedOveralls.has(receiveOverall))) {
    return 'One of these picks has already been made.'
  }
  return null
}
