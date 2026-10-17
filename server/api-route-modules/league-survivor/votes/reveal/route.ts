/**
 * POST /api/leagues/[leagueId]/survivor/votes/reveal
 * Commissioner-only: reveal locked votes and resolve elimination.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { tallyVotes, getSeasonPointsFromRosterPerformance } from '@/lib/survivor/SurvivorVoteEngine'
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
    where: { leagueId, status: 'votes_locked' },
    orderBy: { createdAt: 'desc' },
  })
  if (!council) return NextResponse.json({ error: 'No locked council found' }, { status: 404 })

  try {
    const tally = await tallyVotes(council.id, {
      getSeasonPointsForRoster: (lid, rid, week) =>
        getSeasonPointsFromRosterPerformance(lid, rid, week),
    })
    return NextResponse.json({ ok: true, councilId: council.id, tally })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
