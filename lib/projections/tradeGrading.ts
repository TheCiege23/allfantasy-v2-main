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
 * So: every path out of here is either a grade with full coverage behind it, or an
 * explicit no-signal result. There is no third option and no default letter.
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

/**
 * Grade band thresholds, expressed as SHARE OF TOTAL TRADED VALUE.
 *
 * ⚠ SHARE, NOT ABSOLUTE POINT DIFFERENCE. A 2,000-point edge is a heist in a
 * trade of two mid-round players and a rounding error in a blockbuster; an
 * absolute band would grade the first as fair and the second as lopsided. Share
 * is scale-free, so the same letter means the same thing in both.
 *
 * 50% is a perfectly even split.
 */
const BANDS: Array<{ min: number; letter: 'A' | 'B' | 'C' | 'D' | 'F' }> = [
  { min: 65, letter: 'A' },
  { min: 55, letter: 'B' },
  { min: 45, letter: 'C' },
  { min: 35, letter: 'D' },
  { min: 0, letter: 'F' },
]

function letterFor(sharePct: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  for (const b of BANDS) if (sharePct >= b.min) return b.letter
  return 'F'
}

/**
 * Grade a trade from the perspective of `sideA`.
 *
 * `sideA` is what that manager RECEIVED; `sideB` is what they gave up.
 */
export function gradeTrade(sideA: TradeSide, sideB: TradeSide): TradeGrade {
  const a = sideMath(sideA)
  const b = sideMath(sideB)
  const total = a.total + b.total
  const covered = a.covered + b.covered

  if (sideA.assets.length === 0 || sideB.assets.length === 0) {
    return {
      graded: false,
      reason: 'NO_ASSETS',
      covered,
      total,
      detail: 'one side of this trade has no assets recorded, so there is nothing to compare',
    }
  }

  if (covered === 0) {
    return {
      graded: false,
      reason: 'NO_COVERAGE',
      covered,
      total,
      detail: `none of the ${total} assets in this trade have a value on file`,
    }
  }

  if (covered < total) {
    /*
     * ⚠ THE MOST IMPORTANT RETURN IN THIS FILE. It would be trivial — and wrong —
     * to grade the priced assets and ignore the rest. Doing so treats every
     * unvalued player as worth zero, which is not a neutral assumption: it
     * mechanically favours whichever manager received the unvalued player.
     */
    return {
      graded: false,
      reason: 'PARTIAL_COVERAGE',
      covered,
      total,
      detail: `only ${covered} of ${total} assets have a value on file — grading the rest as zero would favour whichever side received the unpriced players`,
    }
  }

  const sum = a.value + b.value
  if (sum <= 0) {
    return {
      graded: false,
      reason: 'NO_COVERAGE',
      covered,
      total,
      detail: 'every asset in this trade priced to zero, so there is no signal to grade',
    }
  }

  const sharePct = (a.value / sum) * 100
  const letter = letterFor(sharePct)
  const edge = a.value - b.value

  return {
    graded: true,
    letter,
    edge: Math.round(edge),
    sharePct: Math.round(sharePct * 10) / 10,
    sideAValue: Math.round(a.value),
    sideBValue: Math.round(b.value),
    detail:
      `${sideA.label} received ${Math.round(sharePct)}% of the traded value ` +
      `(${total} assets, all priced)`,
  }
}

/**
 * Evaluate a trade for BOTH sides independently.
 *
 * ⚠ THIS REPLACES "WHO WON THE TRADE" AS THE HEADLINE, AND THE CHANGE IS NOT
 * COSMETIC. gradeTrade() above answers a zero-sum question: what share of the
 * traded value did one side get. That framing is wrong for the most common good
 * trade in fantasy — a contender and a rebuilder swapping present for future
 * value, where BOTH teams genuinely improve against their own objective. A
 * calculator that declares a winner there is not merely unhelpful; it is
 * incorrect, and it trains users to think about trades badly.
 *
 * So each side is graded against ITS OWN objective, and `mutualBenefit` is a
 * first-class output rather than a footnote. When both deltas are positive, say
 * so: "this helps both teams — you are buying now, they are buying later."
 *
 * ⚠ THE VALUE SPLIT IS STILL COMPUTED, BUT IT IS AN INPUT, NOT THE VERDICT. Value
 * share tells you how the assets priced; the objective delta tells you whether
 * the trade was a good idea for that team. They are different questions and only
 * the second one is worth grading.
 */
export type SideOutcome = {
  teamId: string
  /** Change in that team's objective. Positive = improved. */
  delta: number
  verdict: 'STRONG_GAIN' | 'GAIN' | 'NEUTRAL' | 'LOSS' | 'STRONG_LOSS'
  detail: string
}

export type TradeEvaluation =
  | {
      evaluated: true
      sides: SideOutcome[]
      /** True when EVERY side improves — the honest, frequent, headline case. */
      mutualBenefit: boolean
      /** Value split, retained as supporting context only. */
      valueSplit: Extract<TradeGrade, { graded: true }>
      engineVersion: string
    }
  | {
      evaluated: false
      reason: 'NO_ASSETS' | 'PARTIAL_COVERAGE' | 'NO_COVERAGE'
      detail: string
    }

function verdictFor(delta: number): SideOutcome['verdict'] {
  if (delta > 0.04) return 'STRONG_GAIN'
  if (delta > 0.005) return 'GAIN'
  if (delta >= -0.005) return 'NEUTRAL'
  if (delta >= -0.04) return 'LOSS'
  return 'STRONG_LOSS'
}

/**
 * `objectiveDeltaFor` is supplied by the caller so this module stays free of any
 * particular engine — swapping the heuristic for a simulation changes nothing
 * here. See objectiveEngine.ts for why that boundary is load-bearing.
 */
export function evaluateTrade(args: {
  sideA: TradeSide & { teamId: string }
  sideB: TradeSide & { teamId: string }
  /** Objective delta for a team, given the value it received and gave up. */
  objectiveDeltaFor: (teamId: string, valueIn: number, valueOut: number) => number
  engineVersion: string
}): TradeEvaluation {
  const grade = gradeTrade(args.sideA, args.sideB)
  if (!grade.graded) {
    // Coverage guards apply identically here — an ungradeable trade is an
    // unevaluatable one, and neither gets a letter.
    return { evaluated: false, reason: grade.reason, detail: grade.detail }
  }

  const aIn = grade.sideAValue
  const bIn = grade.sideBValue

  const deltaA = args.objectiveDeltaFor(args.sideA.teamId, aIn, bIn)
  const deltaB = args.objectiveDeltaFor(args.sideB.teamId, bIn, aIn)

  const sides: SideOutcome[] = [
    {
      teamId: args.sideA.teamId,
      delta: Math.round(deltaA * 10000) / 10000,
      verdict: verdictFor(deltaA),
      detail: `received ${Math.round(grade.sharePct)}% of the traded value`,
    },
    {
      teamId: args.sideB.teamId,
      delta: Math.round(deltaB * 10000) / 10000,
      verdict: verdictFor(deltaB),
      detail: `received ${Math.round(100 - grade.sharePct)}% of the traded value`,
    },
  ]

  return {
    evaluated: true,
    sides,
    mutualBenefit: sides.every((s) => s.delta > 0),
    valueSplit: grade,
    engineVersion: args.engineVersion,
  }
}

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
