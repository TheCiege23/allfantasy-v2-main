/**
 * PROMPT 3: Commissioner — regenerate C2C college pool (audit; actual pool built on draft load).
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
    eventType: 'regenerate_pool',
    payload: { triggeredBy: userId, pool: 'college', at: new Date().toISOString() },
  })

  return NextResponse.json({ ok: true, message: 'College pool regeneration logged; pool is built when loading draft.' })
}
