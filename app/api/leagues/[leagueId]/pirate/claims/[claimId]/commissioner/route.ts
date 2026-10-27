import { NextResponse, type NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { isPirateLeague } from '@/lib/pirate/rules'
import {
  commissionerRetryPirateClaim,
  commissionerReversePirateClaim,
  commissionerSelectPirateClaim,
  commissionerVoidPirateClaim,
} from '@/lib/pirate/service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string; claimId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const actorUserId = session?.user?.id
  if (!actorUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId, claimId } = await ctx.params
  const gate = await assertLeagueCommissioner(leagueId, actorUserId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  if (!isPirateLeague(gate.league)) return NextResponse.json({ error: 'Not a Pirate League' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  try {
    let claim
    if (body.action === 'select') {
      if (typeof body.playerId !== 'string' || !body.playerId.trim()) throw new Error('Choose an unprotected player.')
      claim = await commissionerSelectPirateClaim({ leagueId, claimId, actorUserId, playerId: body.playerId })
    } else if (body.action === 'void') {
      if (typeof body.reason !== 'string') throw new Error('A reason is required.')
      claim = await commissionerVoidPirateClaim({ leagueId, claimId, actorUserId, reason: body.reason })
    } else if (body.action === 'retry') {
      claim = await commissionerRetryPirateClaim({ leagueId, claimId, actorUserId })
    } else if (body.action === 'reverse') {
      if (typeof body.reason !== 'string') throw new Error('A score correction reason is required.')
      claim = await commissionerReversePirateClaim({ leagueId, claimId, actorUserId, reason: body.reason })
    } else {
      throw new Error('Unknown commissioner claim action.')
    }
    return NextResponse.json({ claim, message: 'Commissioner action recorded.' })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Commissioner action failed' }, { status: 400 })
  }
}
