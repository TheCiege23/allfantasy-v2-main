import { NextRequest, NextResponse } from 'next/server'
import type { LeagueSport } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveActiveLeagueContext } from '@/lib/shared-services/league-hub/activeLeagueContext'
import { getBroadcastPayload } from '@/lib/broadcast-engine'
import { resolveScheduleContextForLeague } from '@/lib/multi-sport/MultiSportScheduleResolver'

export const dynamic = 'force-dynamic'

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function computeWinProbability(projA: number, projB: number): number {
  return 1 / (1 + Math.exp((projB - projA) / 12))
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const viewerUserId = session?.user?.id
  if (!viewerUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId } = await params
  if (!leagueId) {
    return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true, season: true },
  })
  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  // Membership gate. Deliberately `resolveActiveLeagueContext` (League.userId | RedraftLeagueMember |
  // LeagueTeam.claimedByUserId) rather than `canViewLeague`/`resolveLeagueAccess` (League.userId |
  // Roster.platformUserId): this route's real callers are the dashboard war-room cards, and
  // `getDashboardLeagueListForUser` selects the leagues they render with exactly this predicate
  // (lib/dashboard/get-dashboard-league-list.ts). Gating on `Roster.platformUserId` instead would 403 a
  // redraft member or a claim-only manager whose league the dashboard legitimately lists, silently
  // blanking their matchup card. Gate with the same definition of "member" that made the league visible.
  const access = await resolveActiveLeagueContext({ leagueId, userId: viewerUserId })
  if (!access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const requestedWeek = (() => {
    const raw = req.nextUrl.searchParams?.get('week')
    const parsed = raw ? Number(raw) : NaN
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
  })()

  const payload = await getBroadcastPayload({
    leagueId,
    sport: league.sport,
    week: null,
  })

  const availableWeeks = Array.from(
    new Set(
      payload.matchups
        .map((m) => m.weekOrPeriod)
        .filter((v) => Number.isFinite(v) && v > 0)
    )
  ).sort((a, b) => a - b)

  const fallbackWeek =
    payload.currentWeek ??
    (availableWeeks.length > 0
      ? availableWeeks[availableWeeks.length - 1]!
      : 1)
  const selectedWeekOrRound = requestedWeek ?? fallbackWeek

  const weekMatchups = payload.matchups.filter(
    (m) => m.weekOrPeriod === selectedWeekOrRound
  )

  const allTeamRefs = Array.from(
    new Set(
      weekMatchups.flatMap((m) => [m.teamAId, m.teamBId]).filter(Boolean)
    )
  )
  const teams = await prisma.leagueTeam.findMany({
    where: {
      leagueId,
      OR: [
        { id: { in: allTeamRefs } },
        { externalId: { in: allTeamRefs } },
      ],
    },
    select: { id: true, externalId: true },
  })

  const teamIdByRef = new Map<string, string>()
  for (const team of teams) {
    teamIdByRef.set(team.id, team.id)
    if (team.externalId) teamIdByRef.set(team.externalId, team.id)
  }

  const teamIds = Array.from(new Set(Array.from(teamIdByRef.values())))
  const performances = teamIds.length
    ? await prisma.teamPerformance.findMany({
        where: {
          teamId: { in: teamIds },
          season: league.season ?? new Date().getFullYear(),
          week: { lte: selectedWeekOrRound },
        },
        orderBy: [{ teamId: 'asc' }, { week: 'desc' }],
        select: { teamId: true, points: true },
      })
    : []

  const pointsByTeam = new Map<string, number[]>()
  for (const perf of performances) {
    const arr = pointsByTeam.get(perf.teamId) ?? []
    if (arr.length < 3) arr.push(toFiniteNumber(perf.points))
    pointsByTeam.set(perf.teamId, arr)
  }

  const matchupRows = weekMatchups.map((m) => {
    const scoreA = round1(toFiniteNumber(m.scoreA))
    const scoreB = round1(toFiniteNumber(m.scoreB))
    const mappedTeamA = teamIdByRef.get(m.teamAId ?? '') ?? null
    const mappedTeamB = teamIdByRef.get(m.teamBId ?? '') ?? null
    const recentA = mappedTeamA ? pointsByTeam.get(mappedTeamA) ?? [] : []
    const recentB = mappedTeamB ? pointsByTeam.get(mappedTeamB) ?? [] : []
    const avgA =
      recentA.length > 0
        ? recentA.reduce((sum, v) => sum + v, 0) / recentA.length
        : scoreA
    const avgB =
      recentB.length > 0
        ? recentB.reduce((sum, v) => sum + v, 0) / recentB.length
        : scoreB
    const projA = round1(Math.max(scoreA, avgA))
    const projB = round1(Math.max(scoreB, avgB))

    return {
      id: m.matchupId,
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      teamAName: m.teamAName,
      teamBName: m.teamBName,
      scoreA,
      scoreB,
      projA,
      projB,
      winProbA: computeWinProbability(projA, projB),
      remainingA: 0,
      remainingB: 0,
      weekOrRound: m.weekOrPeriod,
      season: m.season,
      winnerTeamId: m.winnerTeamId,
    }
  })

  const season =
    league.season ??
    (payload.season != null
      ? payload.season
      : new Date().getFullYear())
  const scheduleContext = await resolveScheduleContextForLeague(
    league.sport as LeagueSport,
    season,
    selectedWeekOrRound
  )

  return NextResponse.json({
    leagueId,
    sport: league.sport,
    season,
    label: scheduleContext.label,
    totalWeeksOrRounds: scheduleContext.totalWeeksOrRounds,
    currentWeekOrRound: payload.currentWeek ?? selectedWeekOrRound,
    selectedWeekOrRound,
    availableWeeks,
    matchups: matchupRows,
  })
}
