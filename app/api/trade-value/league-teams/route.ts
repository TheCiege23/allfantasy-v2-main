import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { prisma } from '@/lib/prisma'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { selectActiveTeams } from '@/lib/league-import/activeTeams'

/**
 * Lists league teams for trade opponent selection (requires membership).
 */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req as any) || 'unknown'
  const rl = rateLimit(`trade-value-league-teams:${ip}`, 40, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = req.nextUrl.searchParams.get('leagueId')?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  }

  const access = await assertLeagueMember(leagueId, userId)
  if (!access.ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  }

  /*
   * Trade partners are a CURRENT-competition list — an archived team cannot be traded with.
   * `selectActiveTeams` is applied to the rows below rather than the `where`, per the note on
   * that helper.
   */
  const teamRows = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: {
      externalId: true,
      teamName: true,
      ownerName: true,
      platformUserId: true,
      claimedByUserId: true,
      pointsFor: true,
      isOrphan: true,
    },
    orderBy: { pointsFor: 'desc' },
  })
  const teams = selectActiveTeams(teamRows)

  return NextResponse.json({
    teams: teams.map((t) => ({
      externalId: t.externalId,
      teamName: t.teamName,
      ownerName: t.ownerName,
      platformUserId: t.platformUserId,
      isYou: t.claimedByUserId === userId,
    })),
  })
}
