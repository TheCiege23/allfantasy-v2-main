import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { createLiveReplayInsightDataProvider } from '@/lib/decision-os/replay-insights/replayInsightResolver'
import { buildManagerReplayInsights, type ManagerReplayInsightSetV1 } from '@/lib/replay-framework/insights/managerReplayInsight'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/replay-insights
 *
 * INTERNAL, session-authenticated, league-scoped consumer of the replay-insight
 * pipeline for the Manager OS Dashboard card (Phase 20, the "A1" path). It
 * consumes the resolver server-side DIRECTLY — it does NOT call the public keyed
 * Intelligence API route (`/api/v1/intelligence/replay-insights`) and holds no
 * API key. Auth is the user's session; scope is the user's own league membership.
 *
 * Read-only: the live provider performs only the Phase 15/16 Decision Replay
 * Correlation queries (two findMany, zero writes). Display-only — the body is
 * exactly the user-safe `ManagerReplayInsightSetV1` contract (no raw replay IDs,
 * no internals, no recommendation logic).
 *
 * Gated by `MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED=true` (default off → the
 * card renders nothing). This is an internal dashboard flag, independent of the
 * public API's `DECISION_OS_INTELLIGENCE_API_ENABLED`.
 */
export interface ReplayInsightsCardResponse {
  enabled: boolean
  data?: ManagerReplayInsightSetV1
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params

  // Feature gate — default off, so the card stays dark until explicitly enabled.
  if (process.env.MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED !== 'true') {
    return NextResponse.json({ enabled: false } satisfies ReplayInsightsCardResponse, { status: 200 })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Tenant scoping: any real league role (commissioner/co/member/viewer) may view;
  // a non-member gets 403. Session-scoped — never a cross-tenant API key.
  const role = await getLeagueRole(leagueId, userId)
  if (!role) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const summary = await createLiveReplayInsightDataProvider().getReplayCorrelationSummary(leagueId)
    if (!summary) {
      // The live provider returns a (possibly zero-trade) summary in practice;
      // a null here is defensive only — treat as "enabled, no data" (empty card).
      return NextResponse.json({ enabled: true } satisfies ReplayInsightsCardResponse, { status: 200 })
    }
    const data = buildManagerReplayInsights(summary, { scope: 'league', now: new Date() })
    return NextResponse.json({ enabled: true, data } satisfies ReplayInsightsCardResponse, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Replay insights are temporarily unavailable.' }, { status: 500 })
  }
}
