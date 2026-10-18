/**
 * POST /api/leagues/[leagueId]/survivor/votes/reveal
 * Commissioner: publish the Torch Ceremony for the tallied council. Delegates to the canonical
 * reveal, which posts the ceremony and sets the reveal flag in one transaction.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { revealCouncil } from '@/lib/survivor/survivorVoteTallyService'
import { prisma } from '@/lib/prisma'

import { survivorHostGuard } from '@/lib/survivor/survivorHostGuard'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { leagueId: string } },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = params
  const denied = await survivorHostGuard(leagueId, userId)
  if (denied) return denied
  const gate = await assertLeagueCommissioner(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Commissioner only' }, { status: gate.status ?? 403 })

  const council = await prisma.survivorTribalCouncil.findFirst({
    where: { leagueId, isRevealed: false, status: { in: ['closed', 'tie_pending', 'voting_closed'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (!council) return NextResponse.json({ error: 'No tallied council is waiting to be revealed' }, { status: 404 })

  const result = await revealCouncil(leagueId, council.id, userId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, councilId: council.id, eliminatedName: result.eliminatedName, isTie: result.isTie })
}
