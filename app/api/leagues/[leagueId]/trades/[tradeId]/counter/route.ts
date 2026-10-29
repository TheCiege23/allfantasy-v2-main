import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { createAfLeagueTrade } from '@/lib/league-trade-engine/tradeService'
import type { TradeAssetInput } from '@/lib/league-trade-engine/types'
import { postDraftLockErrorResponse } from '@/lib/league/postDraftRosterLock'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; tradeId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId, tradeId } = await ctx.params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const body = (await req.json().catch(() => ({}))) as {
    proposerRosterId?: string
    receiverRosterId?: string
    assets?: TradeAssetInput[]
    metadata?: Record<string, unknown>
  }
  if (!body.proposerRosterId || !body.receiverRosterId || !Array.isArray(body.assets)) {
    return NextResponse.json({ error: 'proposerRosterId, receiverRosterId, assets required' }, { status: 400 })
  }

  try {
    const { id } = await createAfLeagueTrade({
      leagueId,
      proposedByUserId: userId,
      proposerRosterId: body.proposerRosterId,
      receiverRosterId: body.receiverRosterId,
      assets: body.assets,
      parentTradeId: tradeId,
      // No week from the body: a counter used to send its own `currentWeek`, which let the requester
      // pick the week the deadline was checked against. The service resolves the league's own week.
      metadata: body.metadata,
    })
    return NextResponse.json({ ok: true, tradeId: id })
  } catch (e) {
    const locked = postDraftLockErrorResponse(e)
    if (locked) return NextResponse.json(locked.body, { status: locked.status })
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
