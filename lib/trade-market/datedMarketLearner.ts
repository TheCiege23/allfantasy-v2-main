import {
  COMPLETED_MIN_SAMPLE,
  type CompletedTradeMarketValue,
} from './completedTradeObservations'

/**
 * THE TRADE MARKET, MEASURED ON THE DAY EACH TRADE HAPPENED (owner's call, 2026-11-22 — trade learning, step 2).
 *
 * The completed-trade market (`completedTradeObservations.ts`, `formatMarkets.ts`) reads what managers paid for a player
 * against what the chart says he is worth. It measured every trade against TODAY's chart. A 2025 trade of a player
 * whose value has since tripled then reads as a wild overpay for whatever he was traded for, and that old trade counts
 * as much as last week's.
 *
 * Here each trade is measured against the chart as it stood ON ITS DATE — the nearest daily capture on or before it,
 * within two weeks — and recorded as a RATIO: what the other side paid for him over his own value that day. A ratio
 * travels across time where an absolute value does not, so it is applied to today's value at the end. Recent trades
 * count more: each trade's weight halves every 90 days, and the published move is capped on the EFFECTIVE sample those
 * weights leave, so a pile of old trades cannot stand in for a few recent ones.
 *
 * ⚠ A TRADE WITH NO CAPTURE NEAR ITS DATE IS NOT MEASURED, never priced on a later chart under its date. Daily captures
 * began in 2026, so older trades fall outside this market until values for those seasons can be inferred from the
 * trades themselves — the next step.
 *
 * ⚠ SHADOW FIRST. `TRADE_MARKET_LEARNER=dated` publishes these values; anything else keeps publishing the current ones
 * and records the gap between the two, so the switch is made on a measured comparison, not on faith.
 *
 * PURE apart from nothing — every function here takes its inputs and returns its answer.
 */

export const TRADE_MARKET_LEARNER_ENV = 'TRADE_MARKET_LEARNER'
/** A trade's weight halves every this many days. */
export const DATED_HALF_LIFE_DAYS = 90
/** A trade is measured on a capture at most this many days before it, or not at all. */
export const DATED_MAX_CAPTURE_GAP_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000
/** The most the dated market moves a chart value, at any evidence level — the same ceiling as the current market. */
const DATED_MAX_ADJUSTMENT = 12

export function datedLearnerLive(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env[TRADE_MARKET_LEARNER_ENV] ?? '').trim().toLowerCase() === 'dated'
}

/** 1 for a trade made now, ½ after one half-life, ¼ after two. 0 for a trade with no date or a future date. */
export function recencyWeight(tradeDate: Date | null, now: Date): number {
  if (!tradeDate) return 0
  const ageDays = (now.getTime() - tradeDate.getTime()) / DAY_MS
  if (!Number.isFinite(ageDays) || ageDays < -1) return 0
  return Math.pow(0.5, Math.max(0, ageDays) / DATED_HALF_LIFE_DAYS)
}

/** The newest capture day (UTC midnight, ms) on or before the trade, within the gap; null when there is none. `days` ascending. */
export function captureDayFor(days: readonly number[], tradeDate: Date | null): number | null {
  if (!tradeDate) return null
  const t = tradeDate.getTime()
  let best: number | null = null
  for (const d of days) {
    if (d > t) break
    best = d
  }
  return best != null && t - best <= DATED_MAX_CAPTURE_GAP_DAYS * DAY_MS ? best : null
}

/** The value at which half the total weight lies on each side. */
export function weightedMedian(pairs: ReadonlyArray<{ value: number; weight: number }>): number | null {
  const usable = pairs.filter((p) => Number.isFinite(p.value) && p.weight > 0).sort((a, b) => a.value - b.value)
  const total = usable.reduce((s, p) => s + p.weight, 0)
  if (total <= 0) return null
  let run = 0
  for (const p of usable) {
    run += p.weight
    if (run >= total / 2) return p.value
  }
  return usable[usable.length - 1]!.value
}

/** How many equally weighted trades the evidence is worth: (Σw)² / Σw². Ten trades all a year old count for less than ten. */
export function effectiveSample(weights: readonly number[]): number {
  const sum = weights.reduce((s, w) => s + w, 0)
  const sq = weights.reduce((s, w) => s + w * w, 0)
  return sq > 0 ? (sum * sum) / sq : 0
}

export type DatedObservation = {
  transactionId: string
  /** What the other side paid for him, over his own value — both on the chart of the trade's date. */
  ratio: number
  weight: number
}

export type DatedGather = {
  byPlayer: Map<string, { name: string | null; position: string | null; baseValue: number; observations: DatedObservation[] }>
  tradesUsed: number
  /** Trades not measured here, by reason (`no_dated_chart`, `undated`, the attribution's own reasons). */
  skipped: Record<string, number>
}

export function emptyDatedGather(): DatedGather {
  return { byPlayer: new Map(), tradesUsed: 0, skipped: {} }
}

/**
 * The weighted median ratio for each quartile of today's value: what a player at THIS value normally fetches. The same
 * correction the current market makes (stars carry a premium, depth is discounted), on the dated ratios.
 */
export function datedTierBaselines(gather: DatedGather): (baseValue: number) => number {
  const rows: Array<{ base: number; ratio: number; weight: number }> = []
  for (const [, e] of gather.byPlayer) for (const o of e.observations) rows.push({ base: e.baseValue, ratio: o.ratio, weight: o.weight })
  if (rows.length === 0) return () => 1
  const sorted = [...rows].sort((a, b) => a.base - b.base)
  const cuts = [0.25, 0.5, 0.75].map((f) => sorted[Math.floor(f * (sorted.length - 1))]!.base)
  const indexOf = (base: number) => (base <= cuts[0]! ? 0 : base <= cuts[1]! ? 1 : base <= cuts[2]! ? 2 : 3)
  const buckets: Array<Array<{ value: number; weight: number }>> = [[], [], [], []]
  for (const r of sorted) buckets[indexOf(r.base)]!.push({ value: r.ratio, weight: r.weight })
  const medians = buckets.map((b) => weightedMedian(b) ?? 1)
  return (baseValue: number) => medians[indexOf(baseValue)] ?? 1
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** One player's dated market value, in the same shape the current market publishes. PURE. */
export function computeDatedTradeValue(input: {
  playerId: string
  playerName: string | null
  position: string | null
  /** Today's chart value — the dated ratio is applied to it. */
  baseValue: number
  observations: readonly DatedObservation[]
  tierBaselineRatio: number
}): CompletedTradeMarketValue {
  // One trade, one vote: a player can appear in a trade once, but guard against a duplicated row all the same.
  const byTrade = new Map<string, DatedObservation>()
  for (const o of input.observations) if (!byTrade.has(o.transactionId)) byTrade.set(o.transactionId, o)
  const obs = [...byTrade.values()].filter((o) => o.weight > 0 && Number.isFinite(o.ratio))
  const sampleSize = obs.length
  const effective = effectiveSample(obs.map((o) => o.weight))
  const base = { playerId: input.playerId, playerName: input.playerName, position: input.position, baseValue: input.baseValue, sampleSize }
  const unpublished = (reason: string): CompletedTradeMarketValue => ({
    ...base, marketValue: input.baseValue, adjustmentPercent: 0, adjustmentPoints: 0, confidence: 0, direction: 'insufficient', published: false, reasons: [reason],
  })

  if (sampleSize < COMPLETED_MIN_SAMPLE) {
    return unpublished(`Only ${sampleSize} trade${sampleSize === 1 ? '' : 's'} measured on the chart of the day — not enough to move a price`)
  }
  const ratio = weightedMedian(obs.map((o) => ({ value: o.ratio, weight: o.weight })))
  if (ratio == null || input.baseValue <= 0) return unpublished('No usable measured value')

  const baseline = input.tierBaselineRatio > 0 ? input.tierBaselineRatio : 1
  const rawPercent = (ratio / baseline - 1) * 100
  // The cap widens with the evidence the WEIGHTS leave, not with the raw count.
  const tierCap = effective < 8 ? 4 : effective < 15 ? 8 : DATED_MAX_ADJUSTMENT
  const adjustmentPercent = Math.round(clamp(rawPercent, -tierCap, tierCap) * 10) / 10

  const ratios = obs.map((o) => o.ratio)
  const spread = ratios.length > 1 ? Math.max(...ratios) - Math.min(...ratios) : 0
  const confidence = clamp(Math.round(45 + 4 * effective - 12 * spread), 0, 100)
  const marketValue = Math.round(input.baseValue * (1 + adjustmentPercent / 100))
  const direction = adjustmentPercent > 0.5 ? 'rising' : adjustmentPercent < -0.5 ? 'falling' : 'stable'

  const reasons = [
    `${sampleSize} completed trades (worth about ${Math.round(effective)} recent ones — newer trades count more), each measured on the chart of its own day; ` +
      `the market paid a median ${Math.round(ratio * 100)}% of his value (players at this value normally fetch ${Math.round(baseline * 100)}%)`,
  ]
  if (Math.abs(rawPercent) > tierCap) reasons.push(`Move capped at ±${tierCap}% for evidence worth about ${Math.round(effective)} recent trades`)

  return { ...base, marketValue, adjustmentPercent, adjustmentPoints: marketValue - input.baseValue, confidence, direction, published: true, reasons }
}

export type DatedBookComparison = {
  evaluated: number
  published: number
  tradesUsed: number
  medianAdjustment: number | null
  /** Players published by both: the median of |dated − current| adjustment, in points of percent. */
  medianGapPercent: number | null
  bothPublished: number
  onlyCurrent: number
  onlyDated: number
  skipped: Record<string, number>
}

/** The dated market for one book, and how far it sits from the current one. PURE. */
export function computeDatedBook(
  gather: DatedGather,
  current: readonly CompletedTradeMarketValue[],
): { values: CompletedTradeMarketValue[]; comparison: DatedBookComparison } {
  const baselineFor = datedTierBaselines(gather)
  const values = [...gather.byPlayer.entries()].map(([playerId, e]) =>
    computeDatedTradeValue({ playerId, playerName: e.name, position: e.position, baseValue: e.baseValue, observations: e.observations, tierBaselineRatio: baselineFor(e.baseValue) }),
  )
  const published = values.filter((v) => v.published)
  const adj = published.map((v) => v.adjustmentPercent).sort((a, b) => a - b)
  const cur = new Map(current.filter((v) => v.published).map((v) => [v.playerId, v]))
  const dat = new Map(published.map((v) => [v.playerId, v]))
  const gaps = [...dat.keys()].filter((id) => cur.has(id)).map((id) => Math.abs(dat.get(id)!.adjustmentPercent - cur.get(id)!.adjustmentPercent)).sort((a, b) => a - b)
  return {
    values,
    comparison: {
      evaluated: values.length,
      published: published.length,
      tradesUsed: gather.tradesUsed,
      medianAdjustment: adj.length ? adj[Math.floor(adj.length / 2)]! : null,
      medianGapPercent: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]! * 10) / 10 : null,
      bothPublished: gaps.length,
      onlyCurrent: [...cur.keys()].filter((id) => !dat.has(id)).length,
      onlyDated: [...dat.keys()].filter((id) => !cur.has(id)).length,
      skipped: gather.skipped,
    },
  }
}
