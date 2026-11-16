/**
 * PROMPT 3: POST — trigger lifecycle automation sync (declare detection, draft detection, auto-promotion, expiration).
 * Commissioner only.
 */

import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isDevyLeague } from '@/lib/devy'
import { runLifecycleAutomationSync } from '@/lib/devy/lifecycle/DevyLifecycleAutomation'

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

  const commissioner = await canCommissionerAct(leagueId, userId, 'league')
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const isDevy = await isDevyLeague(leagueId)
  if (!isDevy) return NextResponse.json({ error: 'Not a devy dynasty league' }, { status: 404 })

  let body: {
    sport?: string
    seasonYear?: number
    enableAutoPromotion?: boolean
    enableExpiration?: boolean
  } = {}
  try {
    body = await req.json()
  } catch {
    // empty body is fine — all fields are optional
  }

  const sport = (body.sport as 'NFL' | 'NBA') ?? 'NFL'
  const seasonYear = body.seasonYear ?? new Date().getFullYear()
  const enableAutoPromotion = body.enableAutoPromotion ?? true
  const enableExpiration = body.enableExpiration ?? false

  const result = await runLifecycleAutomationSync({
    leagueId,
    sport,
    seasonYear,
    enableAutoPromotion,
    enableExpiration,
  })

  return NextResponse.json({ ok: true, ...result })
}
