/**
 * POST /api/leagues/[leagueId]/survivor/votes/lock
 * Commissioner: close the open council's vote window and tally it. Delegates to the canonical
 * council services, so this legacy URL can never run a second vote engine on the same council.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { closeVoteWindow } from '@/lib/survivor/survivorCouncilService'
import { tallyCouncil } from '@/lib/survivor/survivorVoteTallyService'
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
    where: { leagueId, status: 'voting_open', isRevealed: false },
    orderBy: { createdAt: 'desc' },
  })
  if (!council) return NextResponse.json({ error: 'No open council' }, { status: 404 })

  const closed = await closeVoteWindow(leagueId, council.id, userId)
  if (!closed.ok) return NextResponse.json({ error: closed.error }, { status: closed.status })
  const tally = await tallyCouncil(leagueId, council.id)
  if (!tally.ok) return NextResponse.json({ error: tally.error }, { status: tally.status })
  return NextResponse.json({ ok: true, councilId: council.id, status: tally.status })
}
