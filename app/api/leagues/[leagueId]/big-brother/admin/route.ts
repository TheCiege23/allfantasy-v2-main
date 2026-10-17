/**
 * [NEW] POST: Big Brother commissioner admin actions. PROMPT 5.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isBigBrotherLeague } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { runBigBrotherAdminAction } from '@/lib/big-brother/BigBrotherAdminService'
import type { BigBrotherAdminAction } from '@/lib/big-brother/BigBrotherAdminService'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (league.userId !== userId) return NextResponse.json({ error: 'Forbidden: commissioner only' }, { status: 403 })

  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  let body: { action?: string; params?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const action = body.action as BigBrotherAdminAction | undefined
  if (!action) return NextResponse.json({ error: 'Missing action' }, { status: 400 })

  const validActions: BigBrotherAdminAction[] = [
    'start_week_one',
    'force_advance_week',
    'reopen_nominations',
    'reopen_veto',
    'extend_vote_window',
    'rerun_vote_tally',
    'resolve_eviction_tie',
    'force_waiver_release',
    'resolve_veto_state',
    'replace_inactive_hoh',
    'replace_inactive_veto_decision',
    'repair_duplicate_status',
    'update_config',
    'pause_week',
    'resume_week',
  ]
  if (!validActions.includes(action)) {
    return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 })
  }

  const result = await runBigBrotherAdminAction({
    leagueId,
    action,
    params: body.params,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Action failed' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, message: result.message })
}
