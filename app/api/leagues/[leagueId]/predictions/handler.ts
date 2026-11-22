import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import {
  createPredictionPoll,
  listPredictableMatchups,
  loadPredictionLeaderboard,
  resolvePredictionPollsForLeague,
} from '@/lib/league-chat/predictionPolls'

export const dynamic = 'force-dynamic'

/**
 * /api/leagues/[leagueId]/predictions — prediction polls and the season's Prediction Leaderboard.
 *
 * GET:  this week's matchups a member can predict, and the leaderboard.
 * POST: `{ matchupId, resultsVisibility? }` — post the prediction poll for that matchup into the
 *       league chat. One per matchup; a second POST returns the poll already there.
 *
 * Members and commissioners only (the canonical `resolveLeagueAccess`). Native leagues only: an
 * imported league's matchups live on its provider, so there is nothing here to resolve against,
 * and GET says `native: false` rather than pretending the league has no games.
 */

async function viewer(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(_req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const userId = await viewer()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const available = await listPredictableMatchups({ prisma, leagueId })
  if (!available.native) {
    return NextResponse.json({ native: false, season: null, week: null, matchups: [], leaderboard: [] })
  }

  /*
   * Settle any matchup that has gone final before counting. Idempotent, so a page load after the
   * week finalizer already did it writes nothing; it covers a week finalized before this shipped.
   */
  await resolvePredictionPollsForLeague({ prisma, leagueId })
  const season = available.season ?? new Date().getFullYear()
  const leaderboard = await loadPredictionLeaderboard({ prisma, leagueId, season })

  return NextResponse.json({
    native: true,
    season,
    week: available.week,
    matchups: available.matchups,
    leaderboard,
    viewerUserId: userId,
  })
}

const REFUSALS: Record<string, { status: number; error: string }> = {
  not_native: { status: 400, error: 'Prediction polls are available in AllFantasy leagues.' },
  matchup_not_found: { status: 404, error: 'That matchup is not in this league.' },
  not_predictable: { status: 409, error: 'That matchup has already started, or is not a head-to-head game.' },
  kicked_off: { status: 409, error: 'That matchup has kicked off — predictions are closed.' },
}

export async function POST(req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const userId = await viewer()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const matchupId = typeof body.matchupId === 'string' ? body.matchupId.trim() : ''
  if (!matchupId) return NextResponse.json({ error: 'matchupId required' }, { status: 400 })

  const result = await createPredictionPoll({
    prisma,
    leagueId,
    matchupId,
    authorUserId: userId,
    resultsVisibility: body.resultsVisibility === 'after_close' ? 'after_close' : 'live',
  })
  if (!result.ok) {
    const refusal = REFUSALS[result.code]
    return NextResponse.json({ error: refusal.error, code: result.code }, { status: refusal.status })
  }
  return NextResponse.json({ ok: true, messageId: result.messageId, created: result.created })
}
