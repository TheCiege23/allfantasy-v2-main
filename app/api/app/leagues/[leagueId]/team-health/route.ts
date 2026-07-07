import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { createLiveTeamHealthDataProvider, type ManagerTeamHealthV1 } from '@/lib/decision-os/manager-intelligence/team-health'

export const dynamic = 'force-dynamic'

/**
 * GET /api/app/leagues/[leagueId]/team-health
 *
 * INTERNAL, session-authenticated, league-scoped consumer of the deterministic
 * Team Health aggregator for the Manager Intelligence Hub (Phase 2, the "A1"
 * path). Consumes the resolver server-side DIRECTLY — no public keyed API, no
 * API key. Auth is the user's session; scope is their own league membership and
 * their own roster within it.
 *
 * Read-only + display-only: the live provider performs at most three reads and
 * zero writes, and the body is exactly the user-safe `ManagerTeamHealthV1`
 * contract — deterministic, observational, no AI, no recommendation logic.
 *
 * Gated by `MANAGER_TEAM_HEALTH_ENABLED=true` (default off → the module renders
 * a quiet "expanding soon" state). Independent of the hub's client flag.
 */
export interface TeamHealthResponse {
  enabled: boolean
  data?: ManagerTeamHealthV1
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params

  if (process.env.MANAGER_TEAM_HEALTH_ENABLED !== 'true') {
    return NextResponse.json({ enabled: false } satisfies TeamHealthResponse, { status: 200 })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Tenant scoping: any real league role may view their own team health; a
  // non-member gets 403. Session-scoped — never a cross-tenant API key.
  const role = await getLeagueRole(leagueId, userId)
  if (!role) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const data = await createLiveTeamHealthDataProvider().getManagerTeamHealth({ userId, leagueId })
    if (!data) {
      // No roster / no active players yet — "enabled, no data" (empty state).
      return NextResponse.json({ enabled: true } satisfies TeamHealthResponse, { status: 200 })
    }
    return NextResponse.json({ enabled: true, data } satisfies TeamHealthResponse, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Team health is temporarily unavailable.' }, { status: 500 })
  }
}
