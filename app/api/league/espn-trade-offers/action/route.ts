import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isEspnOfferAction, performEspnOfferAction } from '@/lib/provider-trades/espnOfferActions'

/**
 * POST { leagueId, offerId, action: 'accept' | 'decline' | 'counter' } — answer an ESPN trade offer.
 *
 * 🛑 REFUSES, EVERY TIME, UNTIL A WRITE CONTRACT IS CAPTURED (`contracts/espn/GAPS.md` T-03e). There is
 * no ESPN request behind this route: the shape of ESPN's trade write is unknown, and guessing it would
 * mean sending real writes to real leagues. The refusal says so plainly and points at ESPN, so a
 * client that reaches this (the buttons are hidden while it refuses) cannot read it as done.
 *
 * Nothing here calls ESPN or writes the ledger.
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { leagueId?: unknown; offerId?: unknown; action?: unknown } | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const offerId = typeof body?.offerId === 'string' ? body.offerId.trim() : ''
  if (!leagueId || !offerId || !isEspnOfferAction(body?.action)) {
    return NextResponse.json({ error: 'Send leagueId, offerId and an action of accept, decline or counter.' }, { status: 400 })
  }

  const outcome = await performEspnOfferAction({ action: body?.action })
  if (!outcome.ok) {
    return NextResponse.json(
      { ok: false, code: outcome.code, error: outcome.message, actOn: 'espn' },
      { status: outcome.code === 'not_available' ? 501 : 400 },
    )
  }
  return NextResponse.json({ ok: true, status: outcome.status })
}
