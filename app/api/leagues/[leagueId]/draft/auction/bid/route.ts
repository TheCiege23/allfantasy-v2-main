/**
 * POST: Place a bid (auction draft). Body: { amount } (integer).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { placeBid } from '@/lib/live-draft-engine/auction/AuctionEngine'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { prisma } from '@/lib/prisma'
import { notifyAuctionOutbid } from '@/lib/draft-notifications'
import { rosterConfigurationIncompleteBody } from '@/lib/league/roster-configuration-gate-error'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export const dynamic = 'force-dynamic'

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

  const rosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  if (!rosterId) return NextResponse.json({ error: 'No roster for this league' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const amount = Number(body.amount ?? body.bid)
  if (!Number.isInteger(amount) || amount < 0) {
    return NextResponse.json({ error: 'Valid amount (integer) required' }, { status: 400 })
  }

  const before = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { auctionState: true },
  })
  const beforeState = (before?.auctionState ?? {}) as Record<string, unknown>
  const previousBidderRosterId =
    typeof beforeState.currentBidderRosterId === 'string' && beforeState.currentBidderRosterId.length > 0
      ? beforeState.currentBidderRosterId
      : null
  const previousBidAmount =
    typeof beforeState.currentBid === 'number' && Number.isFinite(beforeState.currentBid)
      ? beforeState.currentBid
      : null

  const result = await placeBid(leagueId, rosterId, amount)
  if (!result.success) {
    const status = result.code === 'ROSTER_CONFIGURATION_INCOMPLETE' ? 409 : 400
    if (result.code === 'ROSTER_CONFIGURATION_INCOMPLETE') {
      return NextResponse.json(rosterConfigurationIncompleteBody({ leagueId, message: result.error }), { status })
    }
    return NextResponse.json({ error: result.error }, { status })
  }

  if (previousBidderRosterId && previousBidderRosterId !== rosterId && (previousBidAmount ?? 0) > 0) {
    void notifyAuctionOutbid(leagueId, previousBidderRosterId, previousBidAmount ?? undefined)
  }

  const updated = await buildSessionSnapshot(leagueId)
  return NextResponse.json({ ok: true, session: updated })
}
