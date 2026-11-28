import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { checkNativeReadiness } from '@/lib/league/nativeReadiness'

export const dynamic = 'force-dynamic'

/**
 * GET — could this imported league switch to running on AllFantasy, and what is in the way?
 *
 * Read-only: it runs the switchover's checks and writes nothing
 * (docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md §7 step 1). Head commissioner only, the same
 * bar the switch itself will have — a co-commissioner cannot turn a league native, so they are not
 * shown a checklist for it.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // The one commissioner rule (lib/league/commissionerAccess.ts), head only: the switch is not a co-commissioner's call.
  const refused = await commissionerAccessResponse(leagueId, userId, 'head')
  if (refused) return refused

  try {
    const report = await checkNativeReadiness(prisma, leagueId)
    if (!report) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[native-readiness] check failed', JSON.stringify({ leagueId, error: error instanceof Error ? error.message : String(error) }))
    return NextResponse.json({ error: 'Could not check this league right now.' }, { status: 500 })
  }
}
