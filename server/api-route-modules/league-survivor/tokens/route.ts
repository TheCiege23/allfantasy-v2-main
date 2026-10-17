import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'
/**
 * GET /api/leagues/[leagueId]/survivor/tokens
 * Returns the requesting user's token balance and ledger history.
 * Commissioner can query any team via ?userId=.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { leagueId: string } },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status ?? 403 })

  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access?.isLeagueMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const queryUserId = access.decisions.canSeeHiddenIdolAssignments
    ? (req.nextUrl.searchParams.get('userId') ?? userId) : userId
  const links = await prisma.survivorExileLeague.findMany({ where: { mainLeagueId: leagueId }, select: { exileLeagueId: true } })
  const exileLeagueIds = links.map(link => link.exileLeagueId)
  const ownRosters = await prisma.roster.findMany({ where: { leagueId: { in: exileLeagueIds }, platformUserId: queryUserId }, select: { id: true } })

  const player = await prisma.survivorPlayer.findFirst({
    where: { leagueId, userId: queryUserId },
    select: { tokenBalance: true, totalTokensEarned: true },
  })

  const exileTokens = await prisma.survivorExileToken.findMany({
    where: {
      exileLeagueId: { in: exileLeagueIds },
      rosterId: { in: ownRosters.map(roster => roster.id) },
    },
    orderBy: { lastAwardedWeek: 'desc' },
    take: 20,
  })

  return NextResponse.json({
    balance: player?.tokenBalance ?? 0,
    totalEarned: player?.totalTokensEarned ?? 0,
    ledgerStatus: 'pending',
    recentExileTokens: exileTokens,
  })
}
