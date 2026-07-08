import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { createLiveTradeReviewDataProvider, type CommissionerTradeReviewV1 } from '@/lib/decision-os/commissioner-intelligence/trade-review'

export const dynamic = 'force-dynamic'

/**
 * GET /api/app/leagues/[leagueId]/commissioner/trade-review
 *
 * INTERNAL, session-authenticated, COMMISSIONER-scoped consumer of the
 * deterministic Trade Review aggregator for the Commissioner Intelligence Hub
 * (Phase 4, the "A1" path). Consumes the resolver server-side DIRECTLY — no
 * public keyed API, no API key.
 *
 * Read-only + display-only: the provider performs at most three reads and zero
 * writes, consumes NO AI/recommendation source, and the body is exactly the
 * user-safe `CommissionerTradeReviewV1` contract — review WORKLOAD only, never a
 * fairness/veto/collusion verdict.
 *
 * Gated by `COMMISSIONER_TRADE_REVIEW_ENABLED=true` (default off → the module
 * renders a quiet "expanding soon" state).
 */
export interface TradeReviewResponse {
  enabled: boolean
  data?: CommissionerTradeReviewV1
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params

  if (process.env.COMMISSIONER_TRADE_REVIEW_ENABLED !== 'true') {
    return NextResponse.json({ enabled: false } satisfies TradeReviewResponse, { status: 200 })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Commissioner-scoped: assertCommissioner throws for non-commissioners → 403.
  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const data = await createLiveTradeReviewDataProvider().getCommissionerTradeReview({ leagueId })
    if (!data) {
      // No redraft season / nothing to describe — "enabled, no data" (empty state).
      return NextResponse.json({ enabled: true } satisfies TradeReviewResponse, { status: 200 })
    }
    return NextResponse.json({ enabled: true, data } satisfies TradeReviewResponse, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Trade review is temporarily unavailable.' }, { status: 500 })
  }
}
