import 'server-only'

import { completedOriginal, completedTradeGraderFor, type TradeTimeDeps } from './completedTradeGrade'
import { loadFrozenCompletedGrades, saveFrozenCompletedGrades, sleeperTradeKey, type FrozenCompletedGrade } from './frozenCompletedGrade'
import { gradeDeal, type LeagueTradeGrader } from './leagueTradeGrader'
import type { TradeGradeView } from './tradeGrade'
import type { GradeInputs } from './tradeGradeInputs'
import { tradeTimeOf } from './tradeTimeCapture'

/**
 * THE GRADE FOR A LIST OF COMPLETED TRADES FROM ANY PLATFORM, each the trade's FROZEN ORIGINAL (Trade OS,
 * 2026-11-16 — owner: "do not forget the Fantrax, ESPN, Yahoo, MFL and Fleaflicker trade systems").
 *
 * Until now only Sleeper's completed trades had an original: a native AllFantasy trade had no grade at all,
 * and a Yahoo/ESPN/Fantrax/MFL/Fleaflicker trade was re-priced on TODAY's values on every read
 * (`providerCompletedGrades.ts` froze Sleeper only), so its letter could change between two visits.
 *
 * 🛑 THE FROZEN TABLE IS NOT SLEEPER-SHAPED. An original is keyed on (AllFantasy league row, the source's own
 * trade id), and one league row has exactly one source — so a native `AfLeagueTrade.id`, a Yahoo transaction key
 * or an ESPN id cannot collide with a Sleeper id in the same key space. `sleeperTradeKey` keeps the id's last
 * `:`-segment, which is the whole id for every one of them.
 *
 * Same decision as every Sleeper surface (`completedOriginal`): a frozen original wins; otherwise the deal is
 * priced at the time of the trade when a market record covers it, and on today's values when not; a withheld
 * grade is never frozen. One grader per league, one read of the frozen rows, one insert for new originals; a
 * failed write leaves today's letter, never one claiming to be an original that is not stored.
 */

export type CompletedDeal = {
  /** The source's own trade id: `AfLeagueTrade.id`, a provider transaction id. */
  tradeId: string
  /** One side's view: what that side sent (`give`) and received (`get`). */
  inputs: { give: GradeInputs; get: GradeInputs }
  /** The same deal at the time of the trade, when it differs (a used pick as the pick). Defaults to `inputs`. */
  tradeTimeInputs?: { give: GradeInputs; get: GradeInputs } | null
  /** When the trade completed, when the source says. */
  completedAt?: string | Date | null
}

/** A deal with nothing on one side is a giveaway or a record gap, not a trade to grade (the shared completed rule). */
function gradeable(d: CompletedDeal): boolean {
  return d.inputs.give.assets.length + d.inputs.give.unpriceable.length > 0 && d.inputs.get.assets.length + d.inputs.get.unpriceable.length > 0
}

export async function gradeCompletedTradesWithOriginals(args: {
  afLeagueId: string
  deals: ReadonlyArray<CompletedDeal>
  /**
   * True only when every `tradeId` is a Sleeper transaction id. Then a deal with no `completedAt` is timed by
   * the id's own timestamp; any other source's id is never decoded as one (a long numeric id is not a snowflake).
   */
  sleeperIds?: boolean
  graderFor?: (afLeagueId: string) => Promise<LeagueTradeGrader | null>
  now?: Date
  tradeTime?: TradeTimeDeps
}): Promise<Map<string, TradeGradeView>> {
  const out = new Map<string, TradeGradeView>()
  if (!args.afLeagueId || args.deals.length === 0) return out
  const grader = await (args.graderFor ?? completedTradeGraderFor)(args.afLeagueId).catch(() => null)
  const frozen = await loadFrozenCompletedGrades(args.afLeagueId, args.deals.filter(gradeable).map((d) => d.tradeId))
  const now = args.now ?? new Date()
  const toFreeze: Array<{ row: FrozenCompletedGrade; tradeId: string; current: TradeGradeView }> = []

  await Promise.all(
    args.deals.map(async (d) => {
      if (!gradeable(d)) {
        out.set(d.tradeId, { graded: false, reason: 'one side received nothing on record — not graded as a trade', basis: null })
        return
      }
      try {
        const current = await gradeDeal(grader, { ...d.inputs, viewerSide: false })
        const { view, toFreeze: row } = await completedOriginal({
          grader,
          tradeId: d.tradeId,
          inputs: d.inputs,
          tradeTimeInputs: d.tradeTimeInputs === undefined ? d.inputs : d.tradeTimeInputs,
          tradeAt: tradeTimeOf({ completedAt: d.completedAt ?? null, tradeId: args.sleeperIds ? d.tradeId : null }),
          current,
          frozen: frozen.get(sleeperTradeKey(d.tradeId)),
          now,
          deps: args.tradeTime,
        })
        if (row) toFreeze.push({ row, tradeId: d.tradeId, current })
        out.set(d.tradeId, view)
      } catch {
        out.set(d.tradeId, { graded: false, reason: 'the trade could not be graded just now', basis: null })
      }
    }),
  )

  if (toFreeze.length > 0 && !(await saveFrozenCompletedGrades(args.afLeagueId, toFreeze.map((f) => f.row)))) {
    for (const f of toFreeze) out.set(f.tradeId, f.current)
  }
  return out
}
