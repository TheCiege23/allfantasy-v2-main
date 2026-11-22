import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readMyTeamAutomations } from '@/lib/lineup-automation/myTeamAutomationsService'

/**
 * GET /api/league/my-automations?leagueId=… → what AllFantasy may do for the signed-in manager's own
 * team in this league (lib/lineup-automation/myTeamAutomations.ts). Read-only; only the team's owner.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const uid = session?.user?.id
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = new URL(req.url).searchParams.get('leagueId')?.trim() ?? ''
  if (!leagueId) return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  return NextResponse.json(await readMyTeamAutomations(leagueId, uid), { headers: { 'Cache-Control': 'private, no-store' } })
}
