/**
 * PROMPT 3: Commissioner — regenerate devy pool (recompute NCAA-eligible list).
 */

import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isDevyLeague, appendDevyLifecycleEvent } from '@/lib/devy'

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

  const isDevy = await isDevyLeague(leagueId)
  if (!isDevy) return NextResponse.json({ error: 'Not a devy dynasty league' }, { status: 404 })

  await appendDevyLifecycleEvent({
    leagueId,
    eventType: 'regenerate_pool',
    payload: { pool: 'devy', triggeredBy: userId, at: new Date().toISOString() },
  })

  return NextResponse.json({ ok: true, message: 'Devy pool regeneration triggered.' })
}
