'use client'

import { TradeReviewPanel } from '@/components/trade-review/TradeReviewPanel'

/**
 * The redraft commissioner's review of a proposal — the ONE review (design build-order step 6,
 * `components/trade-review/TradeReviewPanel.tsx`), 2026-09-27.
 *
 * 🛑 REPLACED, NOT EXTENDED (Guap's call). This panel used to show the proposal-time snapshot's flags
 * and a 60% fairness + 40% confidence review score — judgements on the snapshot's own scale, beside a
 * letter from the one grade. It now shows the code-computed review every trade gets: the one grade,
 * six checks, and a recommendation that is advice only. The old engine
 * (`lib/trade-review/redraftCommissionerTradeReview.ts`), its route and Chimmy's unreachable path to it
 * were deleted on 2026-09-27 (design step 7).
 */
export function CommissionerReviewPanel({ leagueId, proposalId }: { leagueId: string; proposalId: string }) {
  return <TradeReviewPanel leagueId={leagueId} tradeId={proposalId} kind="redraft" />
}
