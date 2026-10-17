import 'server-only'

import { evaluateTrade, type EvaluateTradeDeps, type StoredTradeContext, type TradeEvaluationReceipt, type TradeEvaluationSurface } from './evaluateTrade'
import type { TradeGradeView } from './tradeGrade'
import type { GradeInputs } from './tradeGradeInputs'
import type { TradeRef } from './tradeRecord'

/**
 * Record a grade a screen has ALREADY computed as an `evaluateTrade()` receipt (Trade OS, design
 * build-order step 5).
 *
 * List screens — the inbox, the league Trades tab, the trades board, emails — grade many deals per view
 * through `gradeDeal`, the same grader `evaluateTrade` uses. Re-pricing each deal to get a receipt would
 * double the cost of every view for no new information; this hands the grade already in hand to
 * `evaluateTrade` as its grader, so the receipt holds exactly the letter the screen shows.
 *
 * Never throws, like `evaluateTrade`. Until the receipts migration is applied every save is refused and
 * `receiptId` is null; after it, an identical receipt within the reuse window is pointed at rather than
 * written again (`./receiptStore.ts`), so a page view that says nothing new writes nothing.
 */
export type RecordTradeGradeInput = {
  surface: TradeEvaluationSurface
  leagueId: string | null
  userId: string | null
  give: GradeInputs
  get: GradeInputs
  /** Whether the grade was priced from the viewer's side (roster need), as it was passed to `gradeDeal`. */
  viewerSide: boolean
  grade: TradeGradeView
  stored?: StoredTradeContext | null
}

export async function recordTradeGrade(
  input: RecordTradeGradeInput,
  deps: Partial<Pick<EvaluateTradeDeps, 'saveReceipt'>> = {},
): Promise<TradeEvaluationReceipt> {
  return evaluateTrade(
    {
      surface: input.surface,
      leagueId: input.leagueId,
      userId: input.userId,
      give: input.give,
      get: input.get,
      viewerSide: input.viewerSide,
      stored: input.stored ?? null,
    },
    { ...deps, grade: async () => input.grade },
  )
}

/** Just the id, for a row that only needs to point at its receipt. Null when unsaved. */
export async function receiptIdForGrade(input: RecordTradeGradeInput): Promise<string | null> {
  try {
    return (await recordTradeGrade(input)).receiptId
  } catch {
    return null
  }
}

/**
 * The link from a list screen's receipt back to its trade, in the same `ref` shape `evaluateStoredTrade`
 * records, so "every receipt for this trade" is one query over `evidence.storedTrade` whichever surface
 * wrote it. A list screen did not re-check roster sync, so it says so (`unverified`) rather than claim it.
 */
export function storedTradeLink(
  ref: TradeRef,
  args: { source: string; platform: string; status: string },
): StoredTradeContext {
  const tradeId = ref.kind === 'af' ? ref.tradeId : ref.kind === 'redraft' ? ref.proposalId : `${ref.provider}:${ref.providerTradeId}`
  return {
    ref: { ...ref } as Record<string, string>,
    tradeId,
    source: args.source,
    platform: args.platform,
    status: args.status,
    rawStatus: args.status,
    deepLink: null,
    rostersSyncedAt: null,
    rostersStale: false,
    rosterCheck: 'unverified',
  }
}
