import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveManagerIntelligencePayload } from '@/lib/decision-os/dashboard-intelligence'
import { authorizeLeagueRead } from '@/lib/decision-os/leagueReadAuthorization'

export const dynamic = 'force-dynamic'

/**
 * Decision OS — Phase 8.1 real Manager DNA + Recommendations for the signed-in
 * user in one league. Read-only. Degraded-safe: `resolveManagerIntelligencePayload`
 * never throws — a pipeline failure returns honest nulls, not a 500.
 *
 * Phase OS-C6.1: gated by `authorizeLeagueRead`. The returned payload is already scoped to the
 * caller's own `managerId` (so an unrelated caller could never see another manager's DNA/
 * recommendations even before this gate), but `leagueTrend` is real, league-wide activity data
 * computed regardless of caller identity — closing this gap prevents that one field from leaking to a
 * non-member.
 */
export async function GET(request: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = new URL(request.url).searchParams.get('leagueId')?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  const gate = await authorizeLeagueRead(leagueId, userId)
  if (!gate.authorized) {
    return NextResponse.json(
      { error: gate.status === 403 ? 'Forbidden' : 'Unauthorized' },
      { status: gate.status },
    )
  }

  const payload = await resolveManagerIntelligencePayload({ leagueId, managerId: userId })
  return NextResponse.json(payload)
}
