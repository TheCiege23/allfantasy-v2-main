/**
 * afValue — one value per player, blended from every source with an opinion,
 * carrying how much those sources actually agreed.
 *
 * Dependency-free on purpose (see gradeScale.ts): renderers must reach this
 * without pulling a server module into their import graph.
 *
 * Two sources today, chosen because they are independently derived — FantasyCalc
 * from real user-submitted trades, DynastyProcess from FantasyPros expert
 * consensus. Agreement between two methods that different is worth something;
 * divergence is the most useful thing we know about a player, and flattening it
 * into one confident number would discard the only warning available.
 *
 * BLENDED IN RANK SPACE, NOT VALUE SPACE. Measured 2026-08-13 across the 395
 * players both sources price: Spearman rank correlation 0.939 — they agree
 * closely on ORDER. They do not agree on scale even slightly. Real example:
 *
 *   Brenton Strange  FC 1589  DP 563   ratio 2.8
 *   Rashid Shaheed   FC 1388  DP 280   ratio 5.0
 *   Woody Marks      FC 1318  DP 187   ratio 7.0
 *
 * The ratio spans 2.8-7.0 because the two value curves have different shapes,
 * so no single scale factor reconciles them and averaging raw values would be
 * meaningless. Ranks are directly comparable: "both sources have him around
 * 130th" is a real statement about a player, "both say 1589" is not.
 *
 * So: blend ranks, then read the blended rank off a reference value curve. The
 * output stays in the reference source's units, which is what every existing
 * consumer already expects.
 */

export type ValueSource = 'fantasycalc' | 'dynastyprocess'

export type SourceReading = {
  source: ValueSource
  /** 1 = most valuable player in that source's ordering. */
  rank: number
  /** That source's own published value, kept for display and debugging. */
  raw: number
}

export type AfValueConfidence = 'high' | 'moderate' | 'low'

export type AfValue = {
  /** Value on the reference scale, read off the reference curve at blendedRank. */
  value: number
  blendedRank: number
  sources: ValueSource[]
  /**
   * Widest rank disagreement between sources. Null with a single source — one
   * opinion cannot corroborate itself, and reporting 0 would claim agreement
   * that was never tested.
   */
  rankGap: number | null
  /**
   * How far apart the sources are IN VALUE UNITS — the reference curve read at
   * the best and worst rank any source gave him.
   *
   * This is the honest uncertainty for a blended value. FantasyCalc's own
   * maybeMovingStandardDeviation is a moving average over TIME (measured at 15
   * and 2 on a real trade), so it never fires as a doubt signal. Genuine
   * cross-source disagreement does.
   *
   * Null with a single source: one opinion cannot disagree with itself, and 0
   * would claim a precision nothing tested.
   */
  valueSpread: number | null
  confidence: AfValueConfidence
  readings: SourceReading[]
}

/**
 * Calibrated against the observed distribution rather than guessed: across the
 * 395 commonly-priced players the median rank gap is 16 and the 90th percentile
 * is 50. So a gap inside 20 is ordinary agreement, and beyond 60 the two
 * sources are genuinely telling different stories about the player.
 */
export const RANK_GAP_HIGH_CONFIDENCE = 20
export const RANK_GAP_LOW_CONFIDENCE = 60

/**
 * Blend readings in rank space and price the result off a reference curve.
 *
 * `valueAtRank` maps a (possibly fractional) rank to a value on the reference
 * scale; callers build it from whichever source they treat as canonical.
 *
 * Mean of ranks rather than a weighted vote: there is no evidence either source
 * is systematically better, and inventing weights would assert an accuracy we
 * have never measured.
 */
export function blendByRank(
  readings: SourceReading[],
  valueAtRank: (rank: number) => number | null,
): AfValue | null {
  const usable = readings.filter((r) => Number.isFinite(r.rank) && r.rank > 0)
  if (usable.length === 0) return null

  const ranks = usable.map((r) => r.rank)
  const blendedRank = Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 10) / 10
  const value = valueAtRank(blendedRank)
  if (value == null || !Number.isFinite(value)) return null

  const rankGap = usable.length < 2 ? null : Math.max(...ranks) - Math.min(...ranks)

  // Translate the rank disagreement into value units via the same curve the
  // blend is priced on, so callers can compare it against a value edge directly.
  let valueSpread: number | null = null
  if (usable.length >= 2) {
    const best = valueAtRank(Math.min(...ranks))
    const worst = valueAtRank(Math.max(...ranks))
    if (best != null && worst != null && Number.isFinite(best) && Number.isFinite(worst)) {
      valueSpread = Math.round(Math.abs(best - worst) * 10) / 10
    }
  }

  let confidence: AfValueConfidence
  if (rankGap == null) {
    // A single uncorroborated source is never "high" — nothing checked it.
    confidence = 'moderate'
  } else if (rankGap >= RANK_GAP_LOW_CONFIDENCE) {
    confidence = 'low'
  } else if (rankGap <= RANK_GAP_HIGH_CONFIDENCE) {
    confidence = 'high'
  } else {
    confidence = 'moderate'
  }

  return {
    value: Math.round(value),
    blendedRank,
    sources: usable.map((r) => r.source),
    rankGap,
    valueSpread,
    confidence,
    readings: usable,
  }
}

export type SourceEntries = {
  source: ValueSource
  /** Every player that source prices. Order irrelevant; ranks are derived here. */
  entries: { sleeperId: string; value: number }[]
}

/**
 * Blend every player any source prices, into AF Values on the reference scale.
 *
 * A player priced by only one source still gets a value — dropping him would
 * lose real information — but he is marked 'moderate' rather than 'high',
 * because nothing corroborated it.
 */
export function buildAfValues(
  sources: SourceEntries[],
  reference: ValueSource,
): Map<string, AfValue> {
  const rankMaps = new Map<ValueSource, Map<string, { rank: number; raw: number }>>()
  let referenceCurve: number[] = []

  for (const { source, entries } of sources) {
    const usable = entries.filter((e) => e.sleeperId && Number.isFinite(e.value) && e.value > 0)
    const sorted = [...usable].sort((a, b) => b.value - a.value)
    const ranks = new Map<string, { rank: number; raw: number }>()
    sorted.forEach((e, idx) => ranks.set(e.sleeperId, { rank: idx + 1, raw: e.value }))
    rankMaps.set(source, ranks)
    if (source === reference) referenceCurve = sorted.map((e) => e.value)
  }

  // Without the reference curve there is nothing to price the blend in.
  if (referenceCurve.length === 0) return new Map()
  const valueAtRank = valueAtRankFrom(referenceCurve)

  const allIds = new Set<string>()
  for (const ranks of rankMaps.values()) for (const id of ranks.keys()) allIds.add(id)

  const out = new Map<string, AfValue>()
  for (const sleeperId of allIds) {
    const readings: SourceReading[] = []
    for (const [source, ranks] of rankMaps) {
      const hit = ranks.get(sleeperId)
      if (hit) readings.push({ source, rank: hit.rank, raw: hit.raw })
    }
    const blended = blendByRank(readings, valueAtRank)
    if (blended) out.set(sleeperId, blended)
  }
  return out
}

export type PickEntries = {
  source: ValueSource
  /** Round-average value keyed `${season}:${round}`. */
  byRound: Record<string, number>
}

/**
 * Blend PICK values the same way players are blended — in rank space.
 *
 * Picks need their own ranking rather than joining the player ordering: a 2026
 * 2nd is not "the 140th most valuable player" in either feed, and mixing them
 * would rank a pick against players whose curve it does not share. Within picks
 * the ordering is well defined and both sources agree on its shape — an earlier
 * round is worth more than a later one — which is exactly the condition rank
 * blending needs.
 *
 * Same contract as players: output is on the reference source's scale, and a
 * round only one source prices still gets a value, marked 'moderate' because
 * nothing corroborated it.
 */
export function buildAfPickValues(
  sources: PickEntries[],
  reference: ValueSource,
): Map<string, AfValue> {
  const rankMaps = new Map<ValueSource, Map<string, { rank: number; raw: number }>>()
  let referenceCurve: number[] = []

  for (const { source, byRound } of sources) {
    const usable = Object.entries(byRound ?? {}).filter(
      ([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0,
    )
    const sorted = usable.sort((a, b) => b[1] - a[1])
    const ranks = new Map<string, { rank: number; raw: number }>()
    sorted.forEach(([key, v], idx) => ranks.set(key, { rank: idx + 1, raw: v }))
    rankMaps.set(source, ranks)
    if (source === reference) referenceCurve = sorted.map(([, v]) => v)
  }

  if (referenceCurve.length === 0) return new Map()
  const valueAtRank = valueAtRankFrom(referenceCurve)

  const allKeys = new Set<string>()
  for (const ranks of rankMaps.values()) for (const k of ranks.keys()) allKeys.add(k)

  const out = new Map<string, AfValue>()
  for (const key of allKeys) {
    const readings: SourceReading[] = []
    for (const [source, ranks] of rankMaps) {
      const hit = ranks.get(key)
      if (hit) readings.push({ source, rank: hit.rank, raw: hit.raw })
    }
    const blended = blendByRank(readings, valueAtRank)
    if (blended) out.set(key, blended)
  }
  return out
}

/**
 * Build a rank -> value reader over a reference curve, interpolating between
 * neighbours so a blended rank of 142.5 does not have to round to somebody.
 *
 * `sortedValues` must be descending by value (rank 1 first).
 */
export function valueAtRankFrom(sortedValues: number[]): (rank: number) => number | null {
  return (rank: number) => {
    if (sortedValues.length === 0) return null
    if (rank <= 1) return sortedValues[0]!
    if (rank >= sortedValues.length) return sortedValues[sortedValues.length - 1]!
    const lowIdx = Math.floor(rank) - 1
    const highIdx = lowIdx + 1
    const low = sortedValues[lowIdx]
    const high = sortedValues[highIdx]
    if (low == null || high == null) return low ?? high ?? null
    const t = rank - Math.floor(rank)
    return low + (high - low) * t
  }
}
