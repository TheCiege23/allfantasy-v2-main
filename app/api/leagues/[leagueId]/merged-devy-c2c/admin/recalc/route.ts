/**
 * PROMPT 3: Commissioner — recalc C2C college/pro status (re-evaluate declare/draft state).
 */

import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isC2CLeague } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { appendC2CLifecycleEvent } from '@/lib/merged-devy-c2c/lifecycle/C2CAuditLog'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const commissioner = await canCommissionerAct(leagueId, userId, 'league')
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const isC2C = await isC2CLeague(leagueId)
  if (!isC2C) return NextResponse.json({ error: 'Not a C2C league' }, { status: 404 })

  await appendC2CLifecycleEvent({
    leagueId,
    eventType: 'recalc_status',
    payload: { triggeredBy: userId, at: new Date().toISOString() },
  })

  return NextResponse.json({ ok: true, message: 'Recalc triggered; lifecycle state will be re-evaluated from data source.' })
}
