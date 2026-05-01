/**
 * POST: Commissioner-only — persist completed draft picks to league rosters (NFL redraft core).
 * Uses `syncDraftPicksToRoster`; does not mark draft complete (session must already be `completed`).
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { syncDraftPicksToRoster } from '@/lib/league/roster/draft-to-roster-sync'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId } = await ctx.params
  if (!leagueId) {
    return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const draftId = typeof body?.draftId === 'string' ? body.draftId.trim() : ''
  if (!draftId) {
    return NextResponse.json({ error: 'Missing draftId' }, { status: 400 })
  }

  const result = await syncDraftPicksToRoster({ leagueId, draftId, actorUserId: userId })
  if (!result.ok) {
    const status =
      result.code === 'UNAUTHORIZED'
        ? 401
        : result.code === 'FORBIDDEN'
          ? 403
          : result.code === 'LEAGUE_NOT_FOUND' || result.code === 'SESSION_NOT_FOUND'
            ? 404
            : result.code === 'NOT_NFL_REDRAFT_CORE'
              ? 422
              : result.code === 'DRAFT_NOT_COMPLETED'
                ? 409
                : result.code === 'LIFECYCLE_BLOCKED'
                  ? 423
                  : 400
    return NextResponse.json({ error: result.message, code: result.code }, { status })
  }

  return NextResponse.json({ ok: true, summary: result.summary })
}
