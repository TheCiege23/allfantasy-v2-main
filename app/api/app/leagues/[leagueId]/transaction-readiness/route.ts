import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { createLiveTransactionReadinessDataProvider, type ManagerTransactionReadinessV1 } from '@/lib/decision-os/manager-intelligence/transaction-readiness'

export const dynamic = 'force-dynamic'

/**
 * GET /api/app/leagues/[leagueId]/transaction-readiness
 *
 * INTERNAL, session-authenticated, league-scoped consumer of the deterministic
 * Transaction Readiness aggregator for the Manager Intelligence Hub (Phase 4, the
 * "A1" path). Consumes the resolver server-side DIRECTLY — no public keyed API,
 * no API key. Auth is the user's session; scope is their own league membership
 * and their own roster within it.
 *
 * Read-only + display-only: the live provider performs at most four reads and
 * zero writes, consumes NO waiver/trade recommendation endpoint, and the body is
 * exactly the user-safe `ManagerTransactionReadinessV1` contract — deterministic,
 * observational, no AI, no recommendation logic.
 *
 * Gated by `MANAGER_TRANSACTION_READINESS_ENABLED=true` (default off → the module
 * renders a quiet "expanding soon" state). Independent of the hub's client flag.
 */
export interface TransactionReadinessResponse {
  enabled: boolean
  data?: ManagerTransactionReadinessV1
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params

  if (process.env.MANAGER_TRANSACTION_READINESS_ENABLED !== 'true') {
    return NextResponse.json({ enabled: false } satisfies TransactionReadinessResponse, { status: 200 })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Tenant scoping: any real league role may view their own readiness; a
  // non-member gets 403. Session-scoped — never a cross-tenant API key.
  const role = await getLeagueRole(leagueId, userId)
  if (!role) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const data = await createLiveTransactionReadinessDataProvider().getManagerTransactionReadiness({ userId, leagueId })
    if (!data) {
      // No roster / no active players yet — "enabled, no data" (empty state).
      return NextResponse.json({ enabled: true } satisfies TransactionReadinessResponse, { status: 200 })
    }
    return NextResponse.json({ enabled: true, data } satisfies TransactionReadinessResponse, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Transaction readiness is temporarily unavailable.' }, { status: 500 })
  }
}
