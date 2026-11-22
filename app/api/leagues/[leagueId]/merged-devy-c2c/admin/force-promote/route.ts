/**
 * PROMPT 3: Commissioner — force promote a C2C rights record.
 */

import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isC2CLeague } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { c2CForcePromote } from '@/lib/merged-devy-c2c/promotion/C2CPromotionService'

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

  const commissioner = await canCommissionerAct(leagueId, userId, 'league')
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const isC2C = await isC2CLeague(leagueId)
  if (!isC2C) return NextResponse.json({ error: 'Not a C2C league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const { rightsId, promotedProPlayerId, addToRoster } = body
  if (!rightsId || !promotedProPlayerId) {
    return NextResponse.json({ error: 'rightsId and promotedProPlayerId required' }, { status: 400 })
  }

  const result = await c2CForcePromote({
    leagueId,
    rightsId,
    promotedProPlayerId: String(promotedProPlayerId),
    addToRoster: addToRoster === true,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
