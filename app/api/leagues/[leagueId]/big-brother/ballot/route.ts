/**
 * [NEW] GET: Eviction ballot for current user (final nominees; eligible to vote).
 * Private voting: voter sees only the block and can submit via AI chat or this API. PROMPT 3.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isBigBrotherLeague } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { getCurrentCycleForLeague } from '@/lib/big-brother/BigBrotherPhaseStateMachine'
import { getFinalNomineeRosterIds } from '@/lib/big-brother/BigBrotherNominationEngine'
import { getEligibleVoterRosterIds } from '@/lib/big-brother/BigBrotherVoteEngine'
import { getBigBrotherConfig } from '@/lib/big-brother/BigBrotherLeagueConfig'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  const current = await getCurrentCycleForLeague(leagueId)
  if (!current) return NextResponse.json({ ballot: null, error: 'No active cycle' })

  const config = await getBigBrotherConfig(leagueId)
  if (!config) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  if (!roster) return NextResponse.json({ ballot: null, error: 'Not a league member' })

  const eligible = await getEligibleVoterRosterIds(leagueId, current.id, config.hohVotesOnlyInTie, config.evictionTieBreakMode === 'hoh_vote')
  const canVote = eligible.includes(roster.id)
  const finalNominees = await getFinalNomineeRosterIds(current.id)

  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: current.id },
    select: { voteDeadlineAt: true, voteOpenedAt: true, closedAt: true },
  })

  return NextResponse.json({
    ballot: {
      cycleId: current.id,
      week: current.week,
      phase: current.phase,
      finalNomineeRosterIds: finalNominees,
      canVote: canVote && current.phase === 'VOTING_OPEN' && !cycle?.closedAt && (!cycle?.voteOpenedAt || cycle.voteOpenedAt <= new Date()) && (!cycle?.voteDeadlineAt || cycle.voteDeadlineAt > new Date()),
      voteDeadlineAt: cycle?.voteDeadlineAt?.toISOString() ?? null,
      voteOpenedAt: cycle?.voteOpenedAt?.toISOString() ?? null,
      closed: !!cycle?.closedAt || current.phase === 'VOTING_LOCKED' || !!cycle?.voteDeadlineAt && cycle.voteDeadlineAt <= new Date(),
    },
  })
}
