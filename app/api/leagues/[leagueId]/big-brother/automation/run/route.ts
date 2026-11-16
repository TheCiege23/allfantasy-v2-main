/**
 * [NEW] POST: Run Big Brother automation (phase transitions, auto-nominate, veto draw, close eviction).
 * Commissioner or cron. PROMPT 3.
 */

import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isBigBrotherLeague } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { runAutomation } from '@/lib/big-brother/BigBrotherAutomationService'

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

  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  const commissioner = await canCommissionerAct(leagueId, userId, 'league')
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const action = body.action ?? 'tick'

  const result = await runAutomation({
    leagueId,
    action: ['tick', 'close_eviction', 'auto_nominate', 'veto_draw', 'veto_decision_timeout', 'auto_replacement', 'lock_voting'].includes(
      String(action)
    )
      ? (action as 'tick' | 'close_eviction' | 'auto_nominate' | 'veto_draw' | 'veto_decision_timeout' | 'auto_replacement' | 'lock_voting')
      : 'tick',
    systemUserId: body.systemUserId ?? userId,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result)
}
