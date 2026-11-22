/**
 * GET — commissioner / co-commissioner: every automation in the league, whether it is on, and where its
 * switch is (lib/commissioner-hub/automationOverview.ts). Read-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readAutomationOverview } from '@/lib/commissioner-hub/automationOverviewService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const r = await readAutomationOverview(leagueId, userId)
  if (!r.ok) return NextResponse.json({ error: r.status === 404 ? 'League not found' : 'Forbidden' }, { status: r.status })
  return NextResponse.json(r.view, { headers: { 'Cache-Control': 'private, no-store' } })
}
