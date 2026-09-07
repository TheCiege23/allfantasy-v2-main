import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { finalizeSeasonAndEnterOffseason } from '@/lib/redraft/offseason/finalizeSeasonAndEnterOffseason'

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

function statusFromCode(code: string): 'no_bracket' | 'no_final_round' | 'final_round_incomplete' | 'no_winner' {
  if (code === 'NO_BRACKET') return 'no_bracket'
  if (code === 'NO_WINNER') return 'no_winner'
  if (code === 'NO_FINAL_ROUND') return 'no_final_round'
  return 'final_round_incomplete'
}

/**
 * POST /api/redraft/seasons/finalize
 * Body: { seasonId: string }
 *
 * Crowns the champion from the completed final playoff round and marks the
 * season complete. Commissioner-only. Idempotent - safe to call twice.
 * Legacy route contract used finalizeRedraftSeasonChampion and returned
 * NextResponse.json(result); G40 delegates to the canonical NFL redraft
 * playoff runtime while preserving the client response shape.
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { seasonId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const seasonId = body.seasonId?.trim()
  if (!seasonId) return NextResponse.json({ error: 'seasonId required' }, { status: 400 })

  const season = await prisma.redraftSeason.findUnique({
    where: { id: seasonId },
    select: { leagueId: true },
  })
  if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 })

  const allowed = await canManageLeague(season.leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden - commissioner only' }, { status: 403 })

  try {
    // The whole chain — finalize, archive, enter offseason, open the keeper
    // window — now lives in one service so the scheduled postseason roller runs
    // exactly what this route runs. It used to be inline here, which meant any
    // second caller would have had to remember all four steps.
    const outcome = await finalizeSeasonAndEnterOffseason({
      seasonId,
      leagueId: season.leagueId,
      actorUserId: userId,
    })

    if (!outcome.ok) {
      const status = statusFromCode(outcome.code)
      const httpStatus = status === 'no_bracket' || status === 'no_final_round' ? 422 : 422
      return NextResponse.json(
        { error: outcome.message, result: outcome.result, status },
        { status: httpStatus },
      )
    }

    const champion = outcome.result.ok
      ? outcome.result.state.teams.find((team) => team.rosterId === outcome.championRosterId)
      : undefined

    return NextResponse.json({
      status: outcome.alreadyFinalized ? 'already_finalized' : 'ok',
      alreadyFinalized: outcome.alreadyFinalized,
      offseasonEntered: outcome.offseasonEntered,
      offseasonSnapshotId: outcome.offseasonSnapshotId,
      championRosterId: outcome.championRosterId,
      championUserId: champion?.ownerId ?? null,
      championTeamName: champion?.displayName ?? null,
      runnerUpRosterId: outcome.runnerUpRosterId,
      finalStandings: outcome.result.ok ? outcome.result.finalStandings : [],
      playoffs: outcome.result.ok ? outcome.result.state : null,
      events: outcome.result.ok ? outcome.result.events : [],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to finalize redraft season'
    const status = message.includes('not_found') ? 404 : message.includes('not_nfl_redraft') ? 400 : 409
    return NextResponse.json({ error: message }, { status })
  }
}
