import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { endSwitchingPeriod } from '@/lib/league/switching/endSwitching'

export const dynamic = 'force-dynamic'

/**
 * POST — the head commissioner's "Everyone's here": ends a switching league's switching period
 * (lib/league/switching/endSwitching.ts). Nothing is copied from the old platform after this, and every team is run
 * on AllFantasy. Returns the teams that had not switched.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const refused = await commissionerAccessResponse(leagueId, userId, 'head')
  if (refused) return refused

  const result = await endSwitchingPeriod({ leagueId, userId })
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.status })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
