/**
 * POST: Resolve current auction (sell to high bidder or pass). Commissioner or when timer expired.
 * Used by commissioner to force-sell or when client detects timer expiry.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { resolveAuctionWin } from '@/lib/live-draft-engine/auction/AuctionEngine'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { appendPickToRosterDraftSnapshot } from '@/lib/live-draft-engine/RosterAssignmentService'
import { prisma } from '@/lib/prisma'
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

  const body = await req.json().catch(() => ({}))
  const forceByCommissioner = Boolean(body.forceByCommissioner ?? body.force_by_commissioner ?? false)
  const draftSession = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { status: true, timerEndAt: true, draftType: true },
  })
  if (!draftSession || draftSession.draftType !== 'auction') {
    return NextResponse.json({ error: 'Auction session not found' }, { status: 404 })
  }
  if (draftSession.status !== 'in_progress') {
    return NextResponse.json({ error: 'Draft is not in progress' }, { status: 400 })
  }
  const timerExpired =
    draftSession.timerEndAt != null && draftSession.timerEndAt.getTime() <= Date.now()
  const requiresCommissioner = forceByCommissioner || !timerExpired
  if (requiresCommissioner) {
    try {
      await assertCommissioner(leagueId, userId)
    } catch {
      return NextResponse.json({ error: 'Only commissioners can resolve before timer expiry' }, { status: 403 })
    }
  }

  const result = await resolveAuctionWin(leagueId, { force: requiresCommissioner, now: new Date() })
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  if (result.sold && result.winnerRosterId) {
    const snap = await buildSessionSnapshot(leagueId)
    const lastPick = snap?.picks?.slice(-1)[0]
    if (lastPick) {
      await appendPickToRosterDraftSnapshot(leagueId, result.winnerRosterId, {
        playerName: lastPick.playerName,
        position: lastPick.position,
        team: lastPick.team ?? null,
        playerId: lastPick.playerId ?? null,
        byeWeek: lastPick.byeWeek ?? null,
      }).catch(() => {})
    }
  }

  const updated = await buildSessionSnapshot(leagueId)
  return NextResponse.json({
    ok: true,
    sold: result.sold,
    winnerRosterId: result.winnerRosterId,
    amount: result.amount,
    session: updated,
  })
}
