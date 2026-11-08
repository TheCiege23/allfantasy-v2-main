import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const MAX_LEAGUES = 24
const MAX_DRAFT_SIGNALS = 8
const MAX_MATCHUP_ROWS = 1200
const MAX_MATCHUP_SIGNALS = 8

function parseLeagueIds(searchParams: URLSearchParams): string[] {
  const values = searchParams
    .getAll('leagueId')
    .map((value) => value.trim())
    .filter(Boolean)
  return Array.from(new Set(values)).slice(0, MAX_LEAGUES)
}

type DraftSignal = {
  leagueId: string
  status: string
  updatedAt: string
}

type MatchupSignal = {
  leagueId: string
  week: number
  seasonYear: number
  matchupCount: number
  updatedAt: string
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requestedLeagueIds = parseLeagueIds(req.nextUrl.searchParams)
  if (requestedLeagueIds.length === 0) {
    return NextResponse.json({ upcomingDrafts: [], liveMatchups: [] })
  }

  /*
   * Leagues the caller owns OR holds a claimed team in. A member of a league someone else imported —
   * and every member of a public ESPN league joined by picking a team, which the system account owns —
   * has no row of their own, so owner-only matching showed them no drafts and no live matchups.
   * Same rule as `/core`'s list (`lib/dashboard/get-dashboard-league-list.ts`).
   */
  const ownedLeagues = await (prisma as any).league.findMany({
    where: {
      id: { in: requestedLeagueIds },
      OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: { id: true },
  })
  const ownedLeagueIds = ownedLeagues.map((league: { id: string }) => league.id)
  if (ownedLeagueIds.length === 0) {
    return NextResponse.json({ upcomingDrafts: [], liveMatchups: [] })
  }

  const [draftSessions, weeklyRows] = await Promise.all([
    (prisma as any).draftSession.findMany({
      where: {
        leagueId: { in: ownedLeagueIds },
        status: { in: ['pre_draft', 'in_progress', 'paused'] },
      },
      orderBy: [{ updatedAt: 'desc' }],
      select: {
        leagueId: true,
        status: true,
        updatedAt: true,
      },
      take: MAX_DRAFT_SIGNALS,
    }),
    (prisma as any).weeklyMatchup.findMany({
      where: { leagueId: { in: ownedLeagueIds } },
      orderBy: [{ seasonYear: 'desc' }, { week: 'desc' }, { updatedAt: 'desc' }],
      select: {
        leagueId: true,
        seasonYear: true,
        week: true,
        matchupId: true,
        updatedAt: true,
      },
      take: MAX_MATCHUP_ROWS,
    }),
  ])

  const upcomingDrafts: DraftSignal[] = draftSessions.map(
    (session: { leagueId: string; status: string; updatedAt: Date }) => ({
      leagueId: session.leagueId,
      status: session.status,
      updatedAt: session.updatedAt.toISOString(),
    })
  )

  const latestWeekByLeague = new Map<string, { seasonYear: number; week: number }>()
  for (const row of weeklyRows as Array<{ leagueId: string; seasonYear: number; week: number }>) {
    const current = latestWeekByLeague.get(row.leagueId)
    if (
      !current ||
      row.seasonYear > current.seasonYear ||
      (row.seasonYear === current.seasonYear && row.week > current.week)
    ) {
      latestWeekByLeague.set(row.leagueId, {
        seasonYear: row.seasonYear,
        week: row.week,
      })
    }
  }

  const aggregate = new Map<
    string,
    {
      seasonYear: number
      week: number
      updatedAt: string
      matchupIds: Set<number>
      rowCount: number
    }
  >()

  for (const row of weeklyRows as Array<{
    leagueId: string
    seasonYear: number
    week: number
    matchupId: number | null
    updatedAt: Date
  }>) {
    const latest = latestWeekByLeague.get(row.leagueId)
    if (!latest) continue
    if (row.seasonYear !== latest.seasonYear || row.week !== latest.week) continue
    const key = row.leagueId
    const existing = aggregate.get(key)
    if (!existing) {
      aggregate.set(key, {
        seasonYear: row.seasonYear,
        week: row.week,
        updatedAt: row.updatedAt.toISOString(),
        matchupIds: row.matchupId != null ? new Set([row.matchupId]) : new Set<number>(),
        rowCount: 1,
      })
      continue
    }
    if (row.matchupId != null) existing.matchupIds.add(row.matchupId)
    existing.rowCount += 1
    if (row.updatedAt.toISOString() > existing.updatedAt) {
      existing.updatedAt = row.updatedAt.toISOString()
    }
  }

  const liveMatchups: MatchupSignal[] = Array.from(aggregate.entries())
    .map(([leagueId, value]) => {
      const computedMatchups =
        value.matchupIds.size > 0 ? value.matchupIds.size : Math.max(1, Math.floor(value.rowCount / 2))
      return {
        leagueId,
        seasonYear: value.seasonYear,
        week: value.week,
        matchupCount: computedMatchups,
        updatedAt: value.updatedAt,
      }
    })
    .filter((row) => row.matchupCount > 0)
    .sort((a, b) => {
      if (a.updatedAt === b.updatedAt) return b.matchupCount - a.matchupCount
      return b.updatedAt.localeCompare(a.updatedAt)
    })
    .slice(0, MAX_MATCHUP_SIGNALS)

  return NextResponse.json({
    upcomingDrafts,
    liveMatchups,
  })
}

