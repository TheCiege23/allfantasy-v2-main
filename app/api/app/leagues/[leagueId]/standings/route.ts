import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { proxyToExisting } from '@/lib/api/proxy-adapter'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { leagueId: string } }) {
  const leagueId = params.leagueId
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Detect fantasy (redraft) league by checking for a RedraftSeason.
  // Bracket pool leagues (NBA/NHL/FIFA challenges) never create RedraftSeason records.
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, season: true },
  })

  if (!season) {
    // No redraft season — this is a bracket pool league. Preserve existing behavior.
    return proxyToExisting(req, {
      targetPath: `/api/bracket/leagues/${leagueId}/standings`,
    })
  }

  // Verify the user has access to this fantasy league
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { id: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  // Canonical membership predicate. Was gating on the nullable `LeagueTeam.platformUserId`,
  // which 403'd real members of imported leagues (their membership lives in `Roster`).
  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId: season.id },
    orderBy: [{ playoffSeed: 'asc' }, { wins: 'desc' }, { pointsFor: 'desc' }],
    select: {
      id: true,
      teamName: true,
      ownerName: true,
      wins: true,
      losses: true,
      ties: true,
      pointsFor: true,
      pointsAgainst: true,
      playoffSeed: true,
      streak: true,
    },
  })

  type RosterRow = {
    id: string
    teamName: string | null
    ownerName: string
    wins: number
    losses: number
    ties: number
    pointsFor: number
    pointsAgainst: number
    playoffSeed: number | null
    streak: string | null
  }

  const standings = (rosters as RosterRow[]).map((r, i) => ({
    id: r.id,
    teamName: r.teamName,
    ownerName: r.ownerName,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    pointsFor: Math.round(r.pointsFor * 100) / 100,
    pointsAgainst: Math.round(r.pointsAgainst * 100) / 100,
    playoffSeed: r.playoffSeed ?? i + 1,
    streak: r.streak,
  }))

  return NextResponse.json({ standings, seasonId: season.id, season: season.season })
}
