/**
 * AI League Advisor — GET returns personalized advice: lineup, trade, waiver, injury.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueAdvisorAdvice } from '@/lib/league-advisor'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { leagueId } = await ctx.params
    if (!leagueId) {
      return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    }

    const advice = await getLeagueAdvisorAdvice({
      leagueId,
      userId: session.user.id,
    })

    if (!advice) {
      return NextResponse.json(
        { error: 'League or roster not found, or you do not have access.' },
        { status: 404 }
      )
    }

    return NextResponse.json(advice)
  } catch (e) {
    console.error('[advisor GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Advisor failed' },
      { status: 500 }
    )
  }
}
