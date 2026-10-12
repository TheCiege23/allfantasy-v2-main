/**
 * GET /api/leagues/[leagueId]/survivor/votes
 * Returns current council vote state.
 * - Commissioner: sees all votes with voter/target details.
 * - Member: sees only own vote + whether council is open/locked/revealed.
 * Votes are hidden until reveal by default.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { leagueId: string } },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = params
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.isLeagueMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const council = await prisma.survivorTribalCouncil.findFirst({
    where: { leagueId, status: { in: ['voting_open', 'votes_locked', 'reveal_in_progress', 'complete'] } },
    include: { votes: true },
    orderBy: { createdAt: 'desc' },
  })

  if (!council) return NextResponse.json({ council: null, votes: [] })

  const revealed = council.isRevealed || council.status === 'complete' || council.status === 'reveal_in_progress'

  if (access.decisions.canSeePrivateVotes) {
    return NextResponse.json({
      council: { id: council.id, status: council.status, week: council.week },
      votes: council.votes,
      hiddenUntilReveal: false,
      privacyMode: access.isParticipatingCommissioner ? 'participating_commissioner_redacted' : 'host_visible',
    })
  }

  const ownRoster = access.rosterId
    ? { id: access.rosterId }
    : await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } })
  const ownVote = council.votes.find((v: any) => {
    return v.voterUserId === userId || (ownRoster?.id && v.voterRosterId === ownRoster.id)
  })
  return NextResponse.json({
    council: { id: council.id, status: council.status, week: council.week },
    votes: ownVote ? [ownVote] : [],
    hiddenUntilReveal: !revealed,
    privacyMode: access.isParticipatingCommissioner ? 'participating_commissioner_redacted' : 'player_redacted',
  })
}
