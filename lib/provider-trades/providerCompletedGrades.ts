import 'server-only'

import { completedTradeGraderFor } from '@/lib/decision-os/trade/completedTradeGrade'
import {
  loadFrozenCompletedGrades,
  saveFrozenCompletedGrades,
  sleeperTradeKey,
  withFrozenOriginal,
  type FrozenCompletedGrade,
} from '@/lib/decision-os/trade/frozenCompletedGrade'
import { gradeDeal, type LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { gradeInputsFromPending } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { PendingProviderTrade } from './scanPendingSleeperTrades'

/**
 * THE grade for the Trade Center's provider-COMPLETED rows: the trade's FROZEN ORIGINAL, from the
 * viewer's side, with today's re-evaluation beside it as `current` (`frozenCompletedGrade.ts`).
 *
 * 🛑 UNTIL 2026-10-03 THESE ROWS WERE RE-GRADED ON TODAY'S VALUES ON EVERY READ. The trades panel
 * called `gradeDeal` directly for them, so the same Sleeper trade could read one letter in the Trade
 * Center and another on /core Trades, the grade email and League Buzz, which all show the original.
 *
 * Same grader as every other completed-trade surface (`completedTradeGraderFor`, the league row with no
 * viewer — a completed trade has no roster need to price), same Sleeper-id asset keys
 * (`gradeInputsFromPending`), one read and one insert for the whole list.
 *
 * Not frozen, and graded exactly as before:
 *  - a non-Sleeper trade — the frozen table is keyed on Sleeper's transaction id;
 *  - a side that received nothing — the shared completed path withholds a giveaway rather than
 *    grading it, so this surface must not write an original nobody else would ever read.
 * A write that fails leaves the letter as today's: it must not claim to be an original that is not stored.
 */
export async function gradeProviderCompletedTrades(args: {
  /** The AllFantasy league row the trades are priced and frozen on — the viewer's own copy. */
  afLeagueId: string
  trades: ReadonlyArray<PendingProviderTrade>
  graderFor?: (afLeagueId: string) => Promise<LeagueTradeGrader | null>
  now?: Date
}): Promise<Map<string, TradeGradeView>> {
  const out = new Map<string, TradeGradeView>()
  if (args.trades.length === 0) return out
  const grader = await (args.graderFor ?? completedTradeGraderFor)(args.afLeagueId)
  const freezable = (t: PendingProviderTrade) =>
    (t.provider ?? 'sleeper') === 'sleeper' && t.assetsGiven.length > 0 && t.assetsReceived.length > 0
  const frozen = await loadFrozenCompletedGrades(
    args.afLeagueId,
    args.trades.filter(freezable).map((t) => t.transactionId),
  )
  const now = args.now ?? new Date()
  const toFreeze: Array<{ row: FrozenCompletedGrade; transactionId: string; current: TradeGradeView }> = []

  await Promise.all(
    args.trades.map(async (t) => {
      const provider = t.provider ?? 'sleeper'
      const inputs = { give: gradeInputsFromPending(t.assetsGiven, provider), get: gradeInputsFromPending(t.assetsReceived, provider) }
      const current = await gradeDeal(grader, { ...inputs, viewerSide: false })
      if (!freezable(t)) {
        out.set(t.transactionId, current)
        return
      }
      const { view, toFreeze: row } = withFrozenOriginal({
        tradeId: t.transactionId, inputs, current, frozen: frozen.get(sleeperTradeKey(t.transactionId)), now,
      })
      if (row) toFreeze.push({ row, transactionId: t.transactionId, current })
      out.set(t.transactionId, view)
    }),
  )

  if (toFreeze.length > 0 && !(await saveFrozenCompletedGrades(args.afLeagueId, toFreeze.map((f) => f.row)))) {
    for (const f of toFreeze) out.set(f.transactionId, f.current)
  }
  return out
}
