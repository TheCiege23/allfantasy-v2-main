import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole, isCommissionerRole } from '@/lib/league/permissions'
import { rateLimit } from '@/lib/rate-limit'
import { explainTrade } from '@/lib/decision-os/trade/explainTrade'
import { receiptGradeFields } from '@/lib/decision-os/trade/receiptViews'
import type { TradeRef } from '@/lib/decision-os/trade/tradeRecord'
import { reviewStoredTrade } from '@/lib/decision-os/trade/tradeReviewContext'

export const dynamic = 'force-dynamic'

/**
 * COMMISSIONER REVIEW MODE (design build-order step 6) for one trade.
 *
 *   GET /api/leagues/{leagueId}/trades/{tradeId}/review?kind=af|redraft|provider[&explain=1]
 *
 * `tradeId` is the trade's own id in its source: an `AfLeagueTrade.id`, a `RedraftTradeProposal.id`, or a
 * Sleeper transaction id. The flags and the recommendation are computed in code
 * (`lib/decision-os/trade/tradeReview.ts`); with `explain=1` the AI explanation layer writes a note to
 * the league, validated against them. Without it the note is the deterministic template — no model call.
 *
 * 🛑 ADVICE, NEVER AN ACTION. This route reads; it approves, rejects and vetoes nothing. The
 * commissioner acts through the existing decision routes, which log the review they were shown.
 *
 * Gate: the canonical commissioner role (`getLeagueRole` — commissioner or co-commissioner, viewers
 * excluded, imported head commissioners recognised).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; tradeId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId, tradeId } = await ctx.params
  const role = await getLeagueRole(leagueId, userId).catch(() => null)
  if (!isCommissionerRole(role)) {
    return NextResponse.json({ error: 'Only the commissioner or a co-commissioner can review a trade.' }, { status: 403 })
  }
  if (!rateLimit(`trade-review:${userId}`, 30, 60_000).success) {
    return NextResponse.json({ error: 'Too many reviews at once. Try again shortly.' }, { status: 429 })
  }

  const kind = req.nextUrl.searchParams.get('kind')
  const ref: TradeRef | null =
    kind === 'af'
      ? { kind: 'af', tradeId }
      : kind === 'redraft'
        ? { kind: 'redraft', proposalId: tradeId }
        : kind === 'provider'
          ? { kind: 'provider', provider: 'sleeper', providerTradeId: tradeId }
          : null
  if (!ref) return NextResponse.json({ error: 'kind must be af, redraft or provider' }, { status: 400 })

  const result = await reviewStoredTrade({ leagueId, ref, userId }).catch(() => null)
  if (!result) return NextResponse.json({ error: 'This trade could not be reviewed just now.' }, { status: 500 })
  if (!result.ok) {
    const status = result.refusal.code === 'not_found' ? 404 : result.refusal.code === 'not_member' ? 403 : 422
    return NextResponse.json({ error: result.refusal.reason, code: result.refusal.code }, { status })
  }

  const explain = req.nextUrl.searchParams.get('explain') === '1'
  const explanation = await explainTrade(
    {
      receipt: result.receipt,
      teamNames: { teamA: result.sideNames[0], teamB: result.sideNames[1] },
      commissionerReview: result.review,
    },
    explain ? {} : { spendEnabled: () => false },
  )

  const imported = result.trade.origin.source === 'provider'
  return NextResponse.json({
    review: result.review,
    sides: result.sideNames,
    tradeGrade: receiptGradeFields(result.receipt),
    /** The receipt this review rests on. Null until the receipts migration is applied. */
    reviewId: result.receipt.receiptId,
    explanation: {
      noteToLeague: explanation.verdict.commissioner?.noteToLeague ?? null,
      headline: explanation.verdict.headline,
      source: explanation.source,
    },
    // An imported trade is decided on its own platform; AllFantasy can show the review, not act on it.
    actOn: imported
      ? { platform: result.trade.origin.platform, deepLink: result.trade.origin.deepLink, note: `Approve or veto this trade on ${result.trade.origin.platform}.` }
      : null,
  })
}
