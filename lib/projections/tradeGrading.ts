/**
 * Trade grading — value both sides, or refuse to grade.
 *
 * ⚠ THE FAILURE THIS FILE EXISTS TO PREVENT: a "C" that means NO DATA.
 * A grade band centred on zero maps an unvalued trade to the middle of the scale,
 * so a trade we know nothing about renders as "C — dead even". That is not a
 * hedge, it is a false statement: "these sides are equal" and "we could not price
 * these sides" are opposite claims, and only one of them is true. Measured on
 * production: of 3,221 trades with players on both sides, 944 are only PARTIALLY
 * valued. Grading those would have produced 944 confident, wrong letters.
 *
 * So a trade is priced here only with full coverage behind it, or reported as an explicit
 * no-signal result. There is no third option and no default value. (The letter itself is the one
 * trade engine's — `lib/decision-os/trade/evaluateTrade.ts`.)
 */

export type ValuedAsset = {
  id: string
  /** Rank within the value source, 1 = most valuable. Null when unvalued. */
  rank: number | null
  /** Raw source value, kept for display only — NEVER summed. See below. */
  rawValue: number | null
}

export type TradeSide = {
  label: string
  assets: ValuedAsset[]
}

/**
 * The shape the rank-space grader returned. Its withheld branch is still how `lib/core-app/tradePicks`
 * describes a trade it cannot price (`describeNoSignal`, `withheldTradeReason`).
 */
export type TradeGrade =
  | {
      graded: true
      letter: 'A' | 'B' | 'C' | 'D' | 'F'
      /** Positive = the subject side received more value. */
      edge: number
      /** 0–100, share of total traded value the subject side received. */
      sharePct: number
      sideAValue: number
      sideBValue: number
      detail: string
    }
  | {
      graded: false
      reason: 'NO_ASSETS' | 'PARTIAL_COVERAGE' | 'NO_COVERAGE'
      /** How many assets could be priced, out of how many were involved. */
      covered: number
      total: number
      detail: string
    }

/**
 * The empirical rank→value curve, sampled from a real market source.
 *
 * ⚠ MEASURED, NOT MODELLED — AND AN EXPONENTIAL WAS TRIED FIRST AND REJECTED.
 * The observed shape is nothing like a constant-decay curve. Sampled from live
 * FantasyCalc values across 399 ranks:
 *
 *     rank   1 → 10436      rank 100 → 2129   (4.9x off the top)
 *     rank  25 →  5344      rank 200 → 1164   (9.0x)
 *     rank  50 →  3863      rank 300 →  266   (39x)
 *                           rank 399 →    5   (2087x)
 *
 * Gentle across the startable ranks, then a cliff. A single exponential fitted to
 * the endpoints (decay ≈ 0.981) is far too steep at the top and nowhere near steep
 * enough at the bottom; the first version of this file used 0.985 and priced deep
 * players at roughly nothing, which made any stud-for-depth trade look lopsided
 * regardless of its actual fairness.
 *
 * So the curve is interpolated from real values instead of assumed.
 */
export type RankCurve = Array<{ rank: number; value: number }>

/**
 * Sampled from live FantasyCalc values. Refresh alongside the value ingest.
 *
 * ⚠ KNOWN LIMITATION — CROSS-SOURCE RANK ALIGNMENT. This curve is FantasyCalc's
 * `overallRank` scale (399 ranked players). Feeding another source's rank through
 * it assumes the two rank scales mean the same thing, and they do not:
 * DynastyProcess ECR covers ~698 players, so its rank 300 sits at a different
 * point in the talent distribution than FantasyCalc's rank 300. The effect is
 * largest deep in the curve, where it falls off a cliff.
 *
 * The right fix is percentile alignment — map each source's rank to its own
 * percentile, then read the curve at that percentile — not a second hardcoded
 * curve. Until then, treat grades whose assets came mostly from the secondary
 * source as less precise than those priced entirely from FantasyCalc.
 */
export const DEFAULT_RANK_CURVE: RankCurve = [
  { rank: 1, value: 10436 },
  { rank: 5, value: 8775 },
  { rank: 10, value: 7263 },
  { rank: 25, value: 5344 },
  { rank: 50, value: 3863 },
  { rank: 100, value: 2129 },
  { rank: 200, value: 1164 },
  { rank: 300, value: 266 },
  { rank: 399, value: 5 },
]

/**
 * Convert a rank into a comparable value by interpolating the empirical curve.
 *
 * ⚠ RANK IS THE INTERCHANGE FORMAT BETWEEN SOURCES, AND THAT IS THE POINT.
 * Value sources disagree on SCALE far more than on ORDER — they rank players
 * nearly identically (Spearman ~0.94) while assigning very different multiples.
 * Summing raw values across sources therefore averages two incompatible
 * yardsticks; linear normalisation of raw values was tested and REFUTED for the
 * same reason. Mapping every source's rank through ONE empirical curve puts every
 * asset on a single, real scale without inventing one.
 */
export function rankToValue(rank: number | null, curve: RankCurve = DEFAULT_RANK_CURVE): number {
  if (rank == null || !Number.isFinite(rank) || rank < 1) return 0
  if (curve.length === 0) return 0

  const first = curve[0]
  const last = curve[curve.length - 1]
  if (rank <= first.rank) return first.value
  // Beyond the deepest sampled rank, hold the floor rather than extrapolating to
  // zero or negative — an unranked-but-real player is worth little, not nothing.
  if (rank >= last.rank) return last.value

  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i]
    const b = curve[i + 1]
    if (rank >= a.rank && rank <= b.rank) {
      const t = (rank - a.rank) / (b.rank - a.rank)
      return a.value + t * (b.value - a.value)
    }
  }
  return last.value
}

/**
 * ⚠ CALL THIS BEFORE SURFACING ANY LETTER.
 *
 * Returns true when the trade cannot be honestly graded. Partial coverage counts
 * as no signal ON PURPOSE: pricing three of four assets and calling the result a
 * grade silently treats the fourth as worthless, which systematically favours
 * whichever side held the unvalued player.
 */
export function hasNoSignal(sideA: TradeSide, sideB: TradeSide): boolean {
  const all = [...sideA.assets, ...sideB.assets]
  if (sideA.assets.length === 0 || sideB.assets.length === 0) return true
  return all.some((a) => a.rank == null)
}

/** Side arithmetic, in rank space. */
export function sideMath(side: TradeSide): { value: number; covered: number; total: number } {
  let value = 0
  let covered = 0
  for (const a of side.assets) {
    if (a.rank == null) continue
    covered++
    value += rankToValue(a.rank)
  }
  return { value, covered, total: side.assets.length }
}

/*
 * 🛑 NO LETTER IS MADE HERE ANY MORE (2026-09-26). This file used to export `gradeTrade` (a
 * share-of-value letter in rank space) and `evaluateTrade` (per-side objective verdicts on top of
 * it). Neither had a runtime caller, and both were verdict-shaped exports outside the engine, so
 * they were deleted when `lib/decision-os/trade/evaluateTrade.ts` became the one trade engine. What
 * stays is what `lib/core-app` actually uses: the measured rank→value curve, the side arithmetic,
 * the coverage guard (`hasNoSignal`) and the no-signal wording.
 */

/**
 * The sentence to show when a trade cannot be graded.
 *
 * ⚠ NEVER RETURNS A LETTER, AND NEVER THE WORD "EVEN". The whole point is that
 * this path must not be mistakable for a C.
 */
export function describeNoSignal(grade: Extract<TradeGrade, { graded: false }>): string {
  switch (grade.reason) {
    case 'NO_ASSETS':
      return 'Not graded — one side has no assets on record.'
    case 'NO_COVERAGE':
      return 'Not graded — no player values on file for this trade.'
    case 'PARTIAL_COVERAGE':
      return `Not graded — only ${grade.covered} of ${grade.total} players have values on file.`
  }
}
