import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
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
    select: { id: true, season: true, userId: true, teams: { select: { platformUserId: true } } },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const memberIds = new Set(
    league.teams.map((t) => t.platformUserId).filter((x): x is string => Boolean(x)),
  )
  if (league.userId !== session.user.id && !memberIds.has(session.user.id)) {
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

  if (rows.length > 0) {
    const enriched = rows.map((r) => ({
      rosterId: r.rosterId,
      teamName: labels.get(r.rosterId) ?? r.rosterId,
      totalPoints: r.totalPoints,
      opponentRosterId: r.opponentRosterId,
      opponentName: r.opponentRosterId ? labels.get(r.opponentRosterId) ?? r.opponentRosterId : null,
      winLoss: r.winLoss,
      status: r.status,
      homeScore: null as number | null,
      awayScore: null as number | null,
    }))
    return NextResponse.json({ season, week, matchups: enriched })
  }

  // Fall back to RedraftMatchup for redraft leagues when TeamWeekResult is empty.
  const redraftSeason = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    select: { id: true, season: true, currentWeek: true },
    orderBy: { season: 'desc' },
  })
  if (!redraftSeason) {
    return NextResponse.json({ season, week, matchups: [] })
  }

  const redraftMatchups = await prisma.redraftMatchup.findMany({
    where: { leagueId, week },
    include: {
      homeRoster: { select: { id: true, teamName: true, ownerName: true, wins: true, losses: true, pointsFor: true, playoffSeed: true } },
      awayRoster: { select: { id: true, teamName: true, ownerName: true, wins: true, losses: true, pointsFor: true, playoffSeed: true } },
    },
    orderBy: { id: 'asc' },
  })

  const rosterName = (r: { teamName: string | null; ownerName: string }): string =>
    r.teamName?.trim() || r.ownerName || 'Team'

  const enrichedRedraft = redraftMatchups.flatMap((m) => {
    const homeName = rosterName(m.homeRoster)
    const awayName = m.awayRoster ? rosterName(m.awayRoster) : null
    const homeWinLoss = m.homeScore > m.awayScore ? 'W' : m.homeScore < m.awayScore ? 'L' : 'T'
    const awayWinLoss = m.awayScore > m.homeScore ? 'W' : m.awayScore < m.homeScore ? 'L' : 'T'
    const rows = [
      {
        rosterId: m.homeRosterId,
        teamName: homeName,
        totalPoints: m.homeScore,
        opponentRosterId: m.awayRosterId ?? null,
        opponentName: awayName,
        winLoss: m.awayRosterId ? homeWinLoss : null,
        status: m.status,
        homeScore: m.homeScore,
        awayScore: m.awayRosterId ? m.awayScore : null,
        homeTeamName: homeName,
        awayTeamName: awayName,
        homeRosterWins: m.homeRoster.wins,
        homeRosterLosses: m.homeRoster.losses,
        homeRosterPF: m.homeRoster.pointsFor,
        homePlayoffSeed: m.homeRoster.playoffSeed ?? null,
        awayRosterWins: m.awayRoster?.wins ?? null,
        awayRosterLosses: m.awayRoster?.losses ?? null,
        awayRosterPF: m.awayRoster?.pointsFor ?? null,
        awayPlayoffSeed: m.awayRoster?.playoffSeed ?? null,
      },
    ]
    if (m.awayRosterId && m.awayRoster) {
      rows.push({
        rosterId: m.awayRosterId,
        teamName: awayName ?? m.awayRosterId,
        totalPoints: m.awayScore,
        opponentRosterId: m.homeRosterId,
        opponentName: homeName,
        winLoss: awayWinLoss,
        status: m.status,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        homeTeamName: homeName,
        awayTeamName: awayName,
        homeRosterWins: m.homeRoster.wins,
        homeRosterLosses: m.homeRoster.losses,
        homeRosterPF: m.homeRoster.pointsFor,
        homePlayoffSeed: m.homeRoster.playoffSeed ?? null,
        awayRosterWins: m.awayRoster.wins,
        awayRosterLosses: m.awayRoster.losses,
        awayRosterPF: m.awayRoster.pointsFor,
        awayPlayoffSeed: m.awayRoster.playoffSeed ?? null,
      })
    }
    return rows
  })

  return NextResponse.json({ season: redraftSeason.season, week, matchups: enrichedRedraft })
}
