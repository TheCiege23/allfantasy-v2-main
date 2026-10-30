import { NextResponse, type NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { respondToPirateClaim, selectPirateClaim } from '@/lib/pirate/service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string; claimId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const actorUserId = session?.user?.id
  if (!actorUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId, claimId } = await ctx.params
  const claim = await prisma.pirateClaim.findFirst({ where: { id: claimId, leagueId }, select: { id: true } })
  if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  try {
    if (body.action === 'select') {
      if (typeof body.playerId !== 'string') throw new Error('Choose a player to claim.')
      const result = await selectPirateClaim({
        claimId, actorUserId, playerId: body.playerId,
        offeredPlayerId: typeof body.offeredPlayerId === 'string' ? body.offeredPlayerId : null,
      })
      return NextResponse.json({ claim: result })
    }
    if (!['accept', 'counter', 'accept_counter', 'decline_counter'].includes(String(body.action))) {
      throw new Error('Unknown claim action.')
    }
    const result = await respondToPirateClaim({
      claimId, actorUserId,
      action: body.action as 'accept' | 'counter' | 'accept_counter' | 'decline_counter',
      counterPlayerId: typeof body.counterPlayerId === 'string' ? body.counterPlayerId : null,
    })
    return NextResponse.json({ claim: result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Claim action failed' }, { status: 400 })
  }
}
