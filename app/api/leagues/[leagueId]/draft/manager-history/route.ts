/**
 * GET /api/leagues/[leagueId]/draft/manager-history
 *
 * Each roster's reach / value tendency across its manager's other completed drafts,
 * for the draft room's Intel tab. Fetched once per room load, not per poll: it is a
 * multi-league read and changes only when another draft completes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { loadManagerHistoryForLeague } from '@/lib/draft-room/managerHistoryReads'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const historyByRoster = await loadManagerHistoryForLeague(leagueId)
    return NextResponse.json(
      { leagueId, historyByRoster },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    )
  } catch (error) {
    // History is an enhancement; the room reads "this draft only" without it.
    console.warn('[draft/manager-history] load failed', {
      leagueId,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ leagueId, historyByRoster: {} })
  }
}
