/**
 * The canonical shape of a rookie-pick curve — one answer to one question.
 *
 * WHAT WAS WRONG. Five curves lived in this repo and disagreed by construction. As a share of
 * a first-round pick, a second was worth 0.735 in `redraft/tradeBuilderAnalysis`, 0.650 in
 * `pick-valuation`, 0.600 in `engine/utv`, 0.480 in `trade-value/valueEngine` and 0.277 in
 * `dynasty-tiers` — a 2.7x spread, 4.6x by the third round. Every dynasty trade verdict
 * inherited whichever one the caller happened to import, which meant the same trade could be
 * graded two ways by two screens and neither was wrong on its own terms.
 *
 * HOW THE WINNER WAS CHOSEN, since picking a favourite is not a fix. The market cannot settle
 * it: the ingested FantasyCalc board is 398 rows and not one is a pick. But offensive players
 * carry an independent market price and trades carry their contents, so across 771 dynasty
 * trades the round values are a solvable linear system — O + Σ v_r·x_r ≈ 0 per trade. Holding
 * each candidate's SHAPE fixed and fitting only its scale ranked them:
 *
 *   solved (from the data)   MAE 2109    1.000  0.449  0.202  0.091  0.041
 *   valueEngine              MAE 2109    1.000  0.480  0.240  0.128  0.072
 *   dynastyTiers             MAE 2114    1.000  0.277  0.108  0.038
 *   utv                      MAE 2116    1.000  0.600  0.333  0.200  0.107
 *   pickValuation            MAE 2122    1.000  0.650  0.400  0.200  0.100
 *   tradeBuilder             MAE 2132    1.000  0.735  0.500  0.324  0.206
 *
 * `valueEngine`'s shape is indistinguishable from the one the data solves for, and it was
 * already the curve in the canonical trade path. So it becomes the shape here.
 *
 * ⚠ THE EVIDENCE IS DIRECTIONAL, NOT STRONG, AND BOTH HALVES MATTER. Best-to-worst spread is
 * 23 MAE on a mean player side of 2,290 — one percent. That is enough to choose between five
 * candidates and nowhere near enough to call the others badly wrong. The reason to collapse is
 * the one the ledger gave: five answers to one question is the defect. This only settles which
 * answer to keep.
 *
 * ⚠ SHAPE ONLY — CALLERS KEEP THEIR OWN SCALE. Each module anchors its first round to whatever
 * its own units are (100, 650, 750, 2500), and that is a legitimate per-module decision about
 * denomination. Forcing one absolute scale would change far more than the defect requires.
 *
 * ⚠ AND REDRAFT IS NOT IN SCOPE. `lib/redraft/tradeBuilderAnalysis.ts` keeps its own curve: an
 * in-season redraft pick is a different asset from a dynasty rookie pick, and it has no
 * external importers to disagree with.
 */

/** Round value as a share of a first-round pick. */
export const PICK_ROUND_SHARE: Readonly<Record<number, number>> = {
  1: 1,
  2: 0.48,
  3: 0.24,
  4: 0.128,
  5: 0.072,
}

/**
 * Beyond the fifth round the curve is not extrapolated.
 *
 * Rounds four and five appear in only 177 and 24 of the 771 trades measured, and nothing at
 * all was observed past five. Continuing the decay would be inventing a number where the data
 * ran out, so the last observed share is held instead.
 */
const DEEPEST_OBSERVED_ROUND = 5

export function pickRoundShare(round: number): number {
  const r = Math.max(1, Math.round(round))
  return PICK_ROUND_SHARE[Math.min(r, DEEPEST_OBSERVED_ROUND)] ?? PICK_ROUND_SHARE[DEEPEST_OBSERVED_ROUND]
}

/**
 * A pick's value in the caller's own units.
 *
 * @param round             1-indexed draft round.
 * @param firstRoundValue   What THIS module calls a first-round pick. The scale stays local.
 */
export function pickRoundValue(round: number, firstRoundValue: number): number {
  return Math.round(firstRoundValue * pickRoundShare(round))
}

/**
 * The curve as a round-keyed table, for modules that hold one as a constant.
 *
 * @param firstRoundValue   The caller's own first-round anchor.
 * @param rounds            How many rounds to emit.
 */
export function pickRoundTable(firstRoundValue: number, rounds = 5): Record<number, number> {
  const out: Record<number, number> = {}
  for (let r = 1; r <= rounds; r++) out[r] = pickRoundValue(r, firstRoundValue)
  return out
}

/**
 * A first-round rookie pick in FantasyCalc dynasty units, measured rather than asserted.
 *
 * Solved at ~950 across the same 771 trades. Carried here because it is the first time the
 * pick-to-player exchange has been a measurement in this codebase, and because a module that
 * needs picks and players on one scale now has somewhere honest to get it.
 */
export const FIRST_ROUND_IN_MARKET_UNITS = 950
