import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { readWeeklyChecklist } from '@/lib/commissioner/weeklyChecklistService'

export const dynamic = 'force-dynamic'

/**
 * GET — this week's commissioner checklist for a redraft league (lib/commissioner/weeklyChecklist).
 * Commissioners and co-commissioners. `{ applies: false, reason }` for leagues it does not cover yet.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  try {
    await requireCommissionerRole(leagueId, userId)
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
  try {
    const view = await readWeeklyChecklist(leagueId)
    if (!view) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    return NextResponse.json(view)
  } catch (err) {
    console.error('[weekly-checklist]', err)
    return NextResponse.json({ error: 'Could not build this week’s checklist' }, { status: 500 })
  }
}
