import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { advanceNflRedraftPlayoffRuntimeRound } from '@/lib/playoff-runtime'

export const dynamic = 'force-dynamic'

async function canManageLeague(leagueId: string, userId: string): Promise<boolean> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      userId: true,
      teams: {
        where: { claimedByUserId: userId },
        select: { isCommissioner: true, isCoCommissioner: true },
      },
    },
  })
  if (!league) return false
  if (league.userId === userId) return true
  return (league.teams as { isCommissioner: boolean; isCoCommissioner: boolean }[]).some(
    (t) => t.isCommissioner || t.isCoCommissioner,
  )
}

/**
 * POST /api/redraft/playoffs/advance
 * Body: { seasonId: string; week: number }
 *
 * Advances winners from completed playoff matchups into the next round.
 * Commissioner-only. Idempotent - safe to call multiple times per week.
 * Legacy route contract used advancePlayoffWinners from playoffEngine; G40
 * delegates the route to the canonical NFL redraft playoff runtime.
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { seasonId?: string; week?: number }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const seasonId = body.seasonId?.trim()
  if (!seasonId) return NextResponse.json({ error: 'seasonId required' }, { status: 400 })

  const week = Number(body.week)
  if (!Number.isFinite(week) || week < 1) {
    return NextResponse.json({ error: 'week must be a positive integer' }, { status: 400 })
  }

  const season = await prisma.redraftSeason.findFirst({
    where: { id: seasonId },
    select: { leagueId: true },
  })
  if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 })

  const allowed = await canManageLeague(season.leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden - commissioner only' }, { status: 403 })

  try {
    const result = await advanceNflRedraftPlayoffRuntimeRound({
      seasonId,
      week,
      actorUserId: userId,
    })
    return NextResponse.json({
      seasonId,
      week,
      advanced: result.ok ? result.advancedRosterIds.length : 0,
      skipped: 0,
      blocked: result.ok ? [] : result.blockedMatchupIds.map((matchupId) => ({ matchupId, reason: result.message })),
      status: result.ok
        ? result.status === 'championship_ready'
          ? 'ready_for_champion_finalization'
          : result.status
        : result.code.toLowerCase(),
      result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to advance playoff round'
    const status = message.includes('not_found') ? 404 : message.includes('not_nfl_redraft') ? 400 : 409
    return NextResponse.json({ error: message }, { status })
  }
}
