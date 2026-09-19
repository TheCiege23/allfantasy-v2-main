import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTournamentStandingsBoard } from '@/lib/tournament/standingsBoard'
import { buildWeeklyReport } from '@/lib/tournament/weeklyReport'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, ctx: { params: Promise<{ tournamentId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const { tournamentId } = await ctx.params
  const board = await getTournamentStandingsBoard(tournamentId, session.user.id)
  if (!board) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })
  const season = Number(request.nextUrl.searchParams.get('season') ?? new Date().getFullYear())
  const weekParam = request.nextUrl.searchParams.get('week')
  let week = weekParam == null || weekParam.trim() === '' ? null : Number(weekParam)
  if (!Number.isInteger(season) || season < 2000 || season > 2200 || (week != null && (!Number.isInteger(week) || week < 1 || week > 53))) {
    return NextResponse.json({ error: 'Choose a valid season and week (1–53).' }, { status: 400 })
  }
  const ids = board.conferences.flatMap((c) => c.leagues.flatMap((l) => l.leagueId ? [l.leagueId] : []))
  const sources = await prisma.league.findMany({ where: { id: { in: ids } }, select: { id: true, platformLeagueId: true } })
  const sourceIds = sources.flatMap((l) => l.platformLeagueId ? [l.platformLeagueId] : [])
  if (week == null) {
    const latest = await prisma.weeklyMatchup.findFirst({
      // Imports can contain future zero-score fixtures. Only auto-select a week
      // with scoring activity; explicit weeks still include actual zero scores.
      where: { leagueId: { in: sourceIds }, seasonYear: season, pointsFor: { not: 0 } },
      orderBy: { week: 'desc' },
      select: { week: true },
    })
    if (!latest) return NextResponse.json({ error: 'No scoring activity collected for this season yet. Choose a week to view manager status and missing-score coverage.' }, { status: 404 })
    week = latest.week
  }
  const results = await prisma.weeklyMatchup.findMany({
    where: { leagueId: { in: sourceIds }, seasonYear: season, week: week },
    select: { leagueId: true, rosterId: true, pointsFor: true, updatedAt: true },
  })
  return NextResponse.json(buildWeeklyReport(board, season, week, sources, results), { headers: { 'Cache-Control': 'private, no-store' } })
}
