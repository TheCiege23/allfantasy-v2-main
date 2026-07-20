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
    select: {
      id: true,
      season: true,
      settings: true,
    },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rawMode =
    league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? (league.settings as Record<string, unknown>).scoring_mode
      : null
  const scoringMode: 'points' | 'h2h_category' | 'roto' =
    rawMode === 'h2h_category' || rawMode === 'roto' ? rawMode : 'points'

  // Canonical membership predicate. Was gating on the nullable `LeagueTeam.platformUserId`,
  // which 403'd real members of imported leagues (their membership lives in `Roster`).
  const access = await resolveLeagueAccess(leagueId, session.user.id)
  if (!access?.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const season = Math.max(2000, Math.min(2100, Number(sp.get('season')) || league.season))

  const [rows, labels] = await Promise.all([
    prisma.fantasyStanding.findMany({
      where: { leagueId, season },
      orderBy: [{ rank: 'asc' }],
    }),
    buildRosterLabelMap(leagueId),
  ])

  const standings = rows.map((r) => ({
    rosterId: r.rosterId,
    teamName: labels.get(r.rosterId) ?? r.rosterId,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    pointsFor: r.pointsFor,
    pointsAgainst: r.pointsAgainst,
    rank: r.rank,
    playoffSeed: r.playoffSeed,
    categoryWinsFor: r.categoryWinsFor ?? 0,
    categoryLossesFor: r.categoryLossesFor ?? 0,
    categoryTiesFor: r.categoryTiesFor ?? 0,
  }))

  return NextResponse.json({ season, standings, scoringMode })
}
