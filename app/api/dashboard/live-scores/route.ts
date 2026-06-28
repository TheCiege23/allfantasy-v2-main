import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { DashboardLiveScore } from '@/lib/types/liveScoring'

export async function GET() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  // Find all active redraft seasons where the user has a roster.
  const seasons = await prisma.redraftSeason.findMany({
    where: {
      status: 'active',
      rosters: { some: { ownerId: userId } },
    },
    select: {
      id: true,
      leagueId: true,
      sport: true,
      currentWeek: true,
      league: { select: { name: true } },
      rosters: {
        where: { ownerId: userId },
        select: {
          id: true,
          teamName: true,
          ownerName: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
        },
      },
    },
  })

  if (seasons.length === 0) return NextResponse.json({ scores: [] })

  // For each season, count total rosters and get the user's matchup for the current week.
  const results: DashboardLiveScore[] = []

  await Promise.all(
    seasons.map(async (season) => {
      const myRoster = season.rosters[0]
      if (!myRoster) return

      const week = Math.max(1, season.currentWeek)

      const [matchup, totalTeams, allRosters] = await Promise.all([
        prisma.redraftMatchup.findFirst({
          where: {
            leagueId: season.leagueId,
            week,
            OR: [{ homeRosterId: myRoster.id }, { awayRosterId: myRoster.id }],
          },
          include: {
            homeRoster: { select: { teamName: true, ownerName: true } },
            awayRoster: { select: { teamName: true, ownerName: true } },
          },
        }),
        prisma.redraftRoster.count({ where: { seasonId: season.id } }),
        prisma.redraftRoster.findMany({
          where: { seasonId: season.id },
          select: { wins: true, losses: true, ties: true, pointsFor: true },
        }),
      ])

      const isHome = matchup?.homeRosterId === myRoster.id
      const myPts = matchup ? (isHome ? matchup.homeScore : matchup.awayScore) : 0
      const oppPts = matchup ? (isHome ? matchup.awayScore : matchup.homeScore) : null
      const oppRoster = matchup ? (isHome ? matchup.awayRoster : matchup.homeRoster) : null
      const oppTeamName = oppRoster
        ? (oppRoster.teamName?.trim() || oppRoster.ownerName || null)
        : null

      const myWins = myRoster.wins
      const myPF = myRoster.pointsFor
      // Count rosters strictly better (more wins, or same wins + more PF) → rank = count + 1
      const betterCount = allRosters.filter(
        (r) => r.wins > myWins || (r.wins === myWins && r.pointsFor > myPF),
      ).length
      const myRank = betterCount + 1

      results.push({
        leagueId: season.leagueId,
        leagueName: season.league.name,
        sport: season.sport,
        week,
        myPts,
        oppPts: matchup?.awayRosterId ? oppPts : null,
        oppTeamName,
        myRecord: { wins: myRoster.wins, losses: myRoster.losses, ties: myRoster.ties },
        myRank,
        totalTeams,
        matchupStatus: matchup?.status ?? 'unknown',
      })
    }),
  )

  // Sort by sport relevance (NFL first) then by league name.
  results.sort((a, b) => {
    if (a.sport === 'NFL' && b.sport !== 'NFL') return -1
    if (b.sport === 'NFL' && a.sport !== 'NFL') return 1
    return a.leagueName.localeCompare(b.leagueName)
  })

  return NextResponse.json({ scores: results })
}
