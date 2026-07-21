import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { buildRosterLabelMap } from '@/lib/scoring-engine/resolveTeamLabels'

export async function GET(
  req: NextRequest,
  { params }: { params: { leagueId: string } },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = params.leagueId
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { id: true, season: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Canonical membership predicate. Was gating on the nullable `LeagueTeam.platformUserId`,
  // which 403'd real members of imported leagues (their membership lives in `Roster`).
  const access = await resolveLeagueAccess(leagueId, session.user.id)
  if (!access?.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const season = Math.max(2000, Math.min(2100, Number(sp.get('season')) || league.season))
  const week = Math.max(1, Math.min(40, Number(sp.get('week')) || 1))

  const [rows, labels] = await Promise.all([
    prisma.teamWeekResult.findMany({
      where: { leagueId, season, week },
      orderBy: { rosterId: 'asc' },
    }),
    buildRosterLabelMap(leagueId),
  ])

  const enriched = rows.map((r) => ({
    rosterId: r.rosterId,
    teamName: labels.get(r.rosterId) ?? r.rosterId,
    totalPoints: r.totalPoints,
    opponentRosterId: r.opponentRosterId,
    opponentName: r.opponentRosterId ? labels.get(r.opponentRosterId) ?? r.opponentRosterId : null,
    winLoss: r.winLoss,
    status: r.status,
  }))

  return NextResponse.json({ season, week, matchups: enriched })
}
