import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runPromotionRelegation } from '@/lib/promotion-relegation'

export const dynamic = 'force-dynamic'

/**
 * POST /api/leagues/[leagueId]/promotion/run
 * Body: { dryRun?: boolean }
 * Runs promotion/relegation for the league; returns planned or applied transitions.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    try {
      await assertCommissionerAccess(leagueId, userId, 'league')
    } catch {
      return NextResponse.json({ error: 'Forbidden: commissioner only' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const dryRun = body.dryRun === true

    const result = await runPromotionRelegation({ leagueId, dryRun })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[promotion run POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to run promotion' },
      { status: 500 }
    )
  }
}
