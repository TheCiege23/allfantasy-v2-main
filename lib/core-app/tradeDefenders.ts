/**
 * Pricing defenders on a trade screen, from the board that already prices them.
 *
 * 🛑 THIS ADDS NO VALUATION AND MUST NOT. Every number comes from
 * `lib/values/canonicalDefenderBoard.ts`, refreshed daily by `/api/cron/adp-refresh` and read
 * out of `sportsDataCache`. A second way to price a defender is the duplicate-board failure
 * `lib/values/leagueDefenderBoard.ts` names in its own header, and this module exists only to
 * put the existing answer into the grader's currency.
 *
 * ── THE GAP IT CLOSES ─────────────────────────────────────────────────────────────────────
 *
 * FantasyCalc publishes no defenders at any tier. Measured on production 2026-09-20 across
 * every traded player: LB 130/130, DB 69/69, DL 36/36, DE 33/33, CB 32/32, DT 24/24, S 5/5 —
 * every single one unpriced, so any trade touching a defender withheld its letter. The
 * canonical board covers 197 of those 331, which flips 319 trades from withheld to graded.
 *
 * ⚠ AND THE REST STAY UNPRICED, WHICH IS THE POINT. The board prices a defender only where it
 * has projection history for him; 134 traded defenders have none, CB worst at 5 of 32. Those
 * withhold exactly as before rather than being handed a floor value.
 */
import { DEFAULT_RANK_CURVE, type RankCurve } from '@/lib/projections/tradeGrading'
import type { CachedDefenderBoard } from '@/lib/values/canonicalDefenderBoardCache'

/**
 * A value on the market curve → the rank that carries it.
 *
 * 🛑 THE INVERSE OF `rankToValue`, AND UNLIKE THE PICK PATH THERE IS NO ALTERNATIVE HERE.
 * `sideMath` counts an asset only when it has a RANK, and it converts that rank back through
 * this same curve. A pick could skip the round trip because FantasyCalc ranks picks in the
 * players' own `overallRank` sequence, so a real rank existed to use. A defender has no such
 * rank: the board's `positionRankBySleeperId` is his standing among LB/DL/DB, which is not
 * comparable to an overall offensive rank and would price the best linebacker like a top-5
 * player outright.
 *
 * ⚠ THE INVERSION IS ONLY HONEST BECAUSE BOTH SIDES ARE ONE SCALE, AND THAT IS DELIBERATE
 * RATHER THAN LUCKY. `canonicalDefenderBoardCache` documents its values as "the same 0–10000
 * convention the trade engine uses", and the IDP ceiling was set against the offensive board
 * by SHARE of the #1 player — 5500 is 49% of the top asset, about overall #17-19 of 398. So a
 * value is converted to the rank the curve already agrees carries it, and `rankToValue` hands
 * back very nearly the number that went in. Were the two scales unrelated, this would price
 * every defender confidently and wrongly, which is the one outcome `tradeGrading.ts` exists
 * to prevent.
 */
export function valueToRank(value: number, curve: RankCurve = DEFAULT_RANK_CURVE): number | null {
  if (!Number.isFinite(value) || curve.length === 0) return null
  const first = curve[0]
  const last = curve[curve.length - 1]
  /* Richer than the top of the curve, or poorer than its floor: clamp rather than extrapolate. */
  if (value >= first.value) return first.rank
  if (value <= last.value) return last.rank

  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i]
    const b = curve[i + 1]
    /* Values DESCEND as rank ascends, so the bracket test reads the other way round. */
    if (value <= a.value && value >= b.value) {
      const span = a.value - b.value
      const t = span === 0 ? 0 : (a.value - value) / span
      return a.rank + t * (b.rank - a.rank)
    }
  }
  return last.rank
}

/** What a defender is worth, in both the currencies a trade screen needs. */
export type DefenderPrice = { rank: number; value: number }

/** Prices one defender by Sleeper id. Null means the board does not hold him. */
export type DefenderPricer = (sleeperId: string) => DefenderPrice | null

/**
 * Build a pricer from a board this league is entitled to use.
 *
 * 🛑 PASS `null` FOR A LEAGUE THAT DOES NOT SCORE IDP, AND THE CALLERS DO.
 * Replacement level is defined by starting requirements, so the canonical board answers "what
 * is a defender worth in a 12-team league starting three of them". In a league that starts
 * none, that number is not merely imprecise — it is a claim about a slot the league does not
 * have, and pricing a linebacker at 3,000 there would move a real trade grade on the strength
 * of it. `hasIdpScoring` is the gate, and both trade screens already hold the settings it
 * needs, so asking costs nothing.
 */
export function defenderPricerFrom(board: CachedDefenderBoard | null | undefined): DefenderPricer {
  if (!board?.valueBySleeperId) return () => null
  const values = board.valueBySleeperId
  return (sleeperId) => {
    const value = values[sleeperId]
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    const rank = valueToRank(value)
    if (rank == null) return null
    return { rank, value }
  }
}
