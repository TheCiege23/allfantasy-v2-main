/**
 * GET: the rookie-draft lottery odds Draft HQ shows, for the dynasty standings screen.
 *
 * READ-ONLY, and the same reader as Draft HQ (`getDraftLotteryOdds` → `loadLottery` in
 * lib/core-app/draftHq.ts): dynasty only, past the startup year, draft order set to
 * `weighted_lottery`, odds from `previewLotteryOdds`, which never draws. Anything else answers
 * `{ available: false, reason }` and the screen shows nothing. DB reads only; no provider call.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeague } from '@/lib/draft/access'
import { getDraftLotteryOdds } from '@/lib/core-app/draftHq'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  if (!(await canAccessLeague(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const lottery = await getDraftLotteryOdds(leagueId, userId)
  if (!lottery) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  return NextResponse.json({ lottery }, { headers: { 'Cache-Control': 'no-store' } })
}
