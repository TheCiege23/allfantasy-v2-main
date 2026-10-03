import 'server-only'

import { completedTradeGraderFor, gradeArchivedTradeWithInputs } from '@/lib/decision-os/trade/completedTradeGrade'
import {
  loadFrozenCompletedGrades,
  saveFrozenCompletedGrades,
  type FrozenCompletedGrade,
} from '@/lib/decision-os/trade/frozenCompletedGrade'
import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { ledgerKey, loadLedgerSidesForTrades } from './archivedPickOutcomes'
import { draftedPickNamesForRow, withDraftedNames } from './archivedPickMatch'
import { pickAssets, type TradeAsset } from './tradePicks'

/**
 * THE grade for archived `LeagueTrade` rows — shared by the /core Trades grade list and the player
 * card (2026-09-27), so one trade cannot read one letter in the list and another on the card.
 *
 * Extracted from `lib/core-app/trades.ts` rather than copied: this repo has already paid for two
 * implementations of one grading rule once. Behaviour is unchanged from that list:
 *
 *  - graded from the ROW's point of view (what it received against what it gave), on this league's
 *    own chart, without roster need — the trade has happened;
 *  - the letter is each trade's FROZEN ORIGINAL (`frozenCompletedGrade.ts`), taken the first time
 *    it was graded on this AF league row, with today's re-grade beside it as `current` — not a fresh
 *    price on today's values;
 *  - 🛑 a USED pick is graded as the player drafted with it (Guap's ruling, 2026-09-25), named from
 *    the league's graded ledger (`archivedPickOutcomes.ts`), one read for the rows that moved a pick;
 *  - any asset that cannot be priced withholds the letter. Nothing is priced as zero.
 */

/** The `LeagueTrade` columns this reads. */
export type ArchivedTradeRow = {
  transactionId: string
  playersGiven: unknown
  playersReceived: unknown
  picksGiven: unknown
  picksReceived: unknown
  /** Which side of the graded ledger is the OTHER one — see `draftedPickNamesForRow`. */
  partnerRosterId?: number | null
}

/** A printable pick with the drafted player attached where the ledger knows it. */
export type ArchivedPick = TradeAsset & { drafted: string | null }

export type ArchivedTradeGrade = {
  grade: TradeGradeView
  picksIn: ArchivedPick[]
  picksOut: ArchivedPick[]
  /** What was graded, in the grader's terms — so a caller can record the grade as a receipt (Trade OS). */
  give: GradeInputs
  get: GradeInputs
}

const idsOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

export async function gradeArchivedTradeRows(args: {
  /** The AllFantasy league row the chart and scoring are read through — the viewer's own copy. */
  afLeagueId: string
  /** The provider's league id, which keys the graded ledger. */
  platformLeagueId: string
  rows: ReadonlyArray<ArchivedTradeRow>
  /** A Sleeper id to a display name, or null — an unnamed player withholds the letter. */
  nameOf: (sleeperId: string) => string | null
  currentSeason?: number
}): Promise<Map<string, ArchivedTradeGrade>> {
  const out = new Map<string, ArchivedTradeGrade>()
  if (args.rows.length === 0) return out
  const currentSeason = args.currentSeason ?? new Date().getUTCFullYear()
  const grader = await completedTradeGraderFor(args.afLeagueId)

  const [ledgerSides, frozen] = await Promise.all([
    loadLedgerSidesForTrades(
      args.rows
        .filter((t) => pickAssets(t.picksGiven).length + pickAssets(t.picksReceived).length > 0)
        .map((t) => ({ sleeperLeagueId: args.platformLeagueId, transactionId: t.transactionId })),
    ),
    // Each trade's frozen original on this row, one read for the whole list (`frozenCompletedGrade.ts`).
    loadFrozenCompletedGrades(args.afLeagueId, args.rows.map((t) => t.transactionId)),
  ])
  const toFreeze: FrozenCompletedGrade[] = []
  const now = new Date()

  await Promise.all(
    args.rows.map(async (t) => {
      const pickRef = (p: { pickSeason?: string; pickRound?: number }) => ({ season: p.pickSeason ?? null, round: p.pickRound ?? null })
      const drafted = draftedPickNamesForRow(
        {
          picksIn: pickAssets(t.picksReceived).map(pickRef),
          picksOut: pickAssets(t.picksGiven).map(pickRef),
          partnerRosterId: t.partnerRosterId ?? null,
        },
        ledgerSides.get(ledgerKey(args.platformLeagueId, t.transactionId)),
      )
      const picksIn = withDraftedNames(pickAssets(t.picksReceived), drafted?.picksIn, drafted?.idsIn)
      const picksOut = withDraftedNames(pickAssets(t.picksGiven), drafted?.picksOut, drafted?.idsOut)
      // Priced by the Sleeper id the row keys each player by, as the live paths price him — see `sleeperPlayerInput`.
      const player = (sleeperId: string) => ({ name: args.nameOf(sleeperId), sleeperId })
      const { grade, give, get } = await gradeArchivedTradeWithInputs(grader, {
        received: idsOf(t.playersReceived).map(player),
        gave: idsOf(t.playersGiven).map(player),
        picksIn: picksIn.map((p) => ({ ...pickRef(p), label: p.name, drafted: p.drafted, draftedId: p.draftedId })),
        picksOut: picksOut.map((p) => ({ ...pickRef(p), label: p.name, drafted: p.drafted, draftedId: p.draftedId })),
        currentSeason,
        original: { afLeagueId: args.afLeagueId, tradeId: t.transactionId, frozen, onFreeze: (f) => toFreeze.push(f), now },
      })
      out.set(t.transactionId, { grade, picksIn, picksOut, give, get })
    }),
  )
  await saveFrozenCompletedGrades(args.afLeagueId, toFreeze)
  return out
}
