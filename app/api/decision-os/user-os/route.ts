import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveUserOsSnapshot } from '@/lib/decision-os/userOs'
import { authorizeLeagueRead } from '@/lib/decision-os/leagueReadAuthorization'

export const dynamic = 'force-dynamic'

/**
 * Fantasy OS Suite — Phase D Increment 5.
 *
 * User OS read API for the signed-in session user, in one league. Mirrors
 * `/api/decision-os/manager-intelligence`'s contract exactly (session-gated, `leagueId` required,
 * degraded-safe, always resolves the SESSION user's own managerId — never a URL param). Works
 * whether or not the signed-in user commissions this league. Read-only.
 * `resolveUserOsSnapshot` never throws — a pipeline failure returns an honest
 * `available: false` snapshot, not a 500.
 *
 * Phase OS-C6.1: gated by `authorizeLeagueRead`, same rationale as the identical addition to
 * `/api/decision-os/manager-intelligence` — closes the `leagueTrend` (real, league-wide activity
 * data) leak to non-members, even though the rest of this payload was already self-scoped.
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

  const snapshot = await resolveUserOsSnapshot(leagueId, userId)
  return NextResponse.json(snapshot)
}
