/**
 * The orphan team auction (lib/orphan-auction): an abandoned team's players and picks sold for sealed
 * FAAB bids.
 *
 *   GET   commissioner, co-commissioner or a team in the league — the auction (never anyone else's
 *         bids while it is open), the orphan teams a commissioner could auction, and the viewer's
 *         own bids and FAAB
 *   POST  { action: 'open', sourceRosterIds, closeAfterHours?, minBid? }   commissioner, AF Commissioner
 *         { action: 'bid', bids: { [assetId]: dollars } }                  a team; replaces its bids
 *         { action: 'close' }   commissioner, once the closing time has passed (the hourly run also does)
 *         { action: 'cancel' }  commissioner; nothing moves
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  cancelOrphanAuction,
  closeOrphanAuction,
  openOrphanAuction,
  readOrphanAuctionView,
  saveOrphanAuctionBids,
  type ActionResult,
} from '@/lib/orphan-auction/orphanAuctionService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const r = await readOrphanAuctionView(leagueId, userId)
  if (!r.ok) return NextResponse.json({ error: r.status === 404 ? 'League not found' : 'Forbidden' }, { status: r.status })
  return NextResponse.json(r.view, { headers: { 'Cache-Control': 'private, no-store' } })
}

function reply(r: ActionResult) {
  if (!r.ok) return NextResponse.json({ error: r.error, ...(r.code ? { code: r.code } : {}) }, { status: r.status })
  return NextResponse.json({ ok: true, status: r.auction.status, closesAt: r.auction.closesAt })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  switch (body?.action) {
    case 'open':
      return reply(await openOrphanAuction(leagueId, userId, { sourceRosterIds: body.sourceRosterIds, closeAfterHours: body.closeAfterHours, minBid: body.minBid }))
    case 'bid':
      return reply(await saveOrphanAuctionBids(leagueId, userId, body.bids))
    case 'close':
      return reply(await closeOrphanAuction(leagueId, { actorUserId: userId }))
    case 'cancel':
      return reply(await cancelOrphanAuction(leagueId, userId))
    default:
      return NextResponse.json({ error: "Send an action: 'open', 'bid', 'close' or 'cancel'." }, { status: 400 })
  }
}
