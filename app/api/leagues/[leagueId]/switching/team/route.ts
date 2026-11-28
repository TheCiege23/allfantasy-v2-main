import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requestedRosterIdFrom } from '@/lib/league/viewerTeams'
import { switchTeamToAllFantasy } from '@/lib/league/switching/switchTeam'

export const dynamic = 'force-dynamic'

/**
 * POST — a manager switches their own team to AllFantasy (lib/league/switching/switchTeam.ts). Only the team they
 * hold: the acting-team rules refuse anyone else's, and a manager with several teams must name one.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const result = await switchTeamToAllFantasy({ leagueId, userId, rosterId: requestedRosterIdFrom(req, body) })
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.status })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
