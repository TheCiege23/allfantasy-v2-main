/**
 * GET: the auction room's bid history for the league's current draft session, newest first.
 * Response: { bids: AuctionBidRow[] }.
 *
 * Postgres only (`auction_bids`, written by the auction engine as bids are accepted). Until the
 * table's migration is applied the list is empty rather than an error, and the room shows nothing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { listAuctionBids } from '@/lib/live-draft-engine/auction/auctionBidLog'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const draft = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, draftType: true },
  })
  if (!draft || draft.draftType !== 'auction') {
    return NextResponse.json({ bids: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const bids = await listAuctionBids(draft.id, leagueId)
  return NextResponse.json({ bids }, { headers: { 'Cache-Control': 'no-store' } })
}
