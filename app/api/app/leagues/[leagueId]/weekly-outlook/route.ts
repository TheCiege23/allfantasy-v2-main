import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { createLiveWeeklyOutlookDataProvider, type ManagerWeeklyOutlookV1 } from '@/lib/decision-os/manager-intelligence/weekly-outlook'

export const dynamic = 'force-dynamic'

/**
 * GET /api/app/leagues/[leagueId]/weekly-outlook
 *
 * INTERNAL, session-authenticated, league-scoped consumer of the deterministic
 * Weekly Outlook aggregator for the Manager Intelligence Hub (Phase 3, the "A1"
 * path). Consumes the resolver server-side DIRECTLY — no public keyed API, no
 * API key. Auth is the user's session; scope is their own league membership and
 * their own roster within it.
 *
 * Read-only + display-only: the live provider performs at most three reads and
 * zero writes, and the body is exactly the user-safe `ManagerWeeklyOutlookV1`
 * contract — deterministic, observational, no AI, no recommendation logic.
 *
 * Gated by `MANAGER_WEEKLY_OUTLOOK_ENABLED=true` (default off → the module
 * renders a quiet "expanding soon" state). Independent of the hub's client flag.
 */
export interface WeeklyOutlookResponse {
  enabled: boolean
  data?: ManagerWeeklyOutlookV1
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params

  if (process.env.MANAGER_WEEKLY_OUTLOOK_ENABLED !== 'true') {
    return NextResponse.json({ enabled: false } satisfies WeeklyOutlookResponse, { status: 200 })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Tenant scoping: any real league role may view their own outlook; a
  // non-member gets 403. Session-scoped — never a cross-tenant API key.
  const role = await getLeagueRole(leagueId, userId)
  if (!role) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const data = await createLiveWeeklyOutlookDataProvider().getManagerWeeklyOutlook({ userId, leagueId })
    if (!data) {
      // No roster / nothing to describe yet — "enabled, no data" (empty state).
      return NextResponse.json({ enabled: true } satisfies WeeklyOutlookResponse, { status: 200 })
    }
    return NextResponse.json({ enabled: true, data } satisfies WeeklyOutlookResponse, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Weekly outlook is temporarily unavailable.' }, { status: 500 })
  }
}
