import { prisma } from '../prisma'
import { resolveCurrentTradeLearningSeason } from './season-resolver'

const MIN_ISOTONIC_SAMPLE = 50
const DEFAULT_BIN_COUNT = 20

export interface IsotonicBinPoint {
  x: number
  y: number
  count: number
}

export interface IsotonicMap {
  version: '1.0.0'
  points: IsotonicBinPoint[]
  sampleSize: number
  ece: number
  eceCalibratedEstimate: number
  computedAt: string
}

function pavaFit(xs: number[], ys: number[], ws: number[]): number[] {
  const n = xs.length
  if (n === 0) return []

  const result = [...ys]
  const weights = [...ws]
  const blocks: Array<{ start: number; end: number; value: number; weight: number }> = []

  for (let i = 0; i < n; i++) {
    blocks.push({ start: i, end: i, value: result[i], weight: weights[i] })

    while (blocks.length >= 2) {
      const curr = blocks[blocks.length - 1]
      const prev = blocks[blocks.length - 2]

      if (prev.value <= curr.value) break

      const totalWeight = prev.weight + curr.weight
      const merged = (prev.value * prev.weight + curr.value * curr.weight) / totalWeight

      blocks.pop()
      blocks.pop()
      blocks.push({
        start: prev.start,
        end: curr.end,
        value: merged,
        weight: totalWeight,
      })
    }
  }

  for (const block of blocks) {
    for (let i = block.start; i <= block.end; i++) {
      result[i] = block.value
    }
  }

  return result
}

function binPairedData(
  predictions: number[],
  outcomes: number[],
  binCount: number = DEFAULT_BIN_COUNT,
): { xs: number[]; ys: number[]; ws: number[] } {
  const bins = Array.from({ length: binCount }, () => ({ sumP: 0, sumY: 0, count: 0 }))

  for (let i = 0; i < predictions.length; i++) {
    const p = predictions[i]
    const y = outcomes[i]
    let b = Math.floor(p * binCount)
    if (b >= binCount) b = binCount - 1
    if (b < 0) b = 0
    bins[b].sumP += p
    bins[b].sumY += y
    bins[b].count += 1
  }

  const xs: number[] = []
  const ys: number[] = []
  const ws: number[] = []

  for (let i = 0; i < binCount; i++) {
    const bin = bins[i]
    if (bin.count === 0) continue
    xs.push(bin.sumP / bin.count)
    ys.push(bin.sumY / bin.count)
    ws.push(bin.count)
  }

  return { xs, ys, ws }
}

function computeECE(predictions: number[], outcomes: number[], binCount: number = 10): number {
  const n = predictions.length
  if (n === 0) return 0

  const bins = Array.from({ length: binCount }, () => ({ sumP: 0, sumY: 0, count: 0 }))
  for (let i = 0; i < n; i++) {
    let b = Math.floor(predictions[i] * binCount)
    if (b >= binCount) b = binCount - 1
    if (b < 0) b = 0
    bins[b].sumP += predictions[i]
    bins[b].sumY += outcomes[i]
    bins[b].count += 1
  }

  let ece = 0
  for (const bin of bins) {
    if (bin.count === 0) continue
    const meanP = bin.sumP / bin.count
    const meanY = bin.sumY / bin.count
    ece += (bin.count / n) * Math.abs(meanP - meanY)
  }
  return ece
}

export function fitIsotonicMap(
  predictions: number[],
  outcomes: number[],
): IsotonicMap | null {
  if (predictions.length < MIN_ISOTONIC_SAMPLE) return null

  const { xs, ys, ws } = binPairedData(predictions, outcomes, DEFAULT_BIN_COUNT)

  if (xs.length < 3) return null

  const calibratedYs = pavaFit(xs, ys, ws)

  const points: IsotonicBinPoint[] = xs.map((x, i) => ({
    x: Math.round(x * 10000) / 10000,
    y: Math.round(calibratedYs[i] * 10000) / 10000,
    count: ws[i],
  }))

  const eceBefore = computeECE(predictions, outcomes)

  const calibratedPredictions = predictions.map(p => applyIsotonicMap(p, points))
  const eceAfter = computeECE(calibratedPredictions, outcomes)

  return {
    version: '1.0.0',
    points,
    sampleSize: predictions.length,
    ece: Math.round(eceBefore * 10000) / 10000,
    eceCalibratedEstimate: Math.round(eceAfter * 10000) / 10000,
    computedAt: new Date().toISOString(),
  }
}

export function applyIsotonicMap(rawProbability: number, points: IsotonicBinPoint[]): number {
  if (points.length === 0) return rawProbability

  const p = Math.max(0, Math.min(1, rawProbability))

  if (p <= points[0].x) return points[0].y
  if (p >= points[points.length - 1].x) return points[points.length - 1].y

  let lo = 0
  let hi = points.length - 1
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (points[mid].x <= p) lo = mid
    else hi = mid
  }

  const x0 = points[lo].x
  const x1 = points[hi].x
  const y0 = points[lo].y
  const y1 = points[hi].y

  if (x1 === x0) return y0

  const t = (p - x0) / (x1 - x0)
  const interpolated = y0 + t * (y1 - y0)

  return Math.max(0.02, Math.min(0.98, Math.round(interpolated * 10000) / 10000))
}

/**
 * Computes and stores the isotonic calibration map from paired prediction/outcome data.
 * IMPORTANT: TradeOfferEvent.acceptProb stores the raw logistic model output (with b0
 * calibration but WITHOUT isotonic calibration). Isotonic calibration is applied post-hoc
 * in buildAcceptModel (core-engine.ts) and calibrateAcceptProbability (accept-calibration.ts).
 * This ensures the isotonic map is always fitted on pre-isotonic predictions, avoiding
 * circular calibration.
 */
export async function computeAndStoreIsotonicMap(
  season?: number,
): Promise<IsotonicMap | null> {
  const resolvedSeason = season ?? await resolveCurrentTradeLearningSeason()
  const outcomes = await prisma.tradeOutcomeEvent.findMany({
    where: {
      season: resolvedSeason,
      offerEventId: { not: null },
      outcome: { in: ['ACCEPTED', 'REJECTED'] },
    },
    select: { offerEventId: true, outcome: true },
  })

  if (outcomes.length < MIN_ISOTONIC_SAMPLE) {
    console.log(`[IsotonicCalibrator] Only ${outcomes.length} outcomes, need ${MIN_ISOTONIC_SAMPLE}. Skipping.`)
    return null
  }

  const outcomeMap = new Map<string, boolean>()
  for (const o of outcomes) {
    if (o.offerEventId) {
      outcomeMap.set(o.offerEventId, o.outcome === 'ACCEPTED')
    }
  }

  const offerIds = Array.from(outcomeMap.keys())
  const offers = await prisma.tradeOfferEvent.findMany({
    where: { id: { in: offerIds } },
    select: { id: true, acceptProb: true },
  })

  const predictions: number[] = []
  const ys: number[] = []

  for (const offer of offers) {
    if (offer.acceptProb == null || offer.acceptProb <= 0) continue
    const accepted = outcomeMap.get(offer.id)
    if (accepted === undefined) continue

    predictions.push(offer.acceptProb)
    ys.push(accepted ? 1 : 0)
  }

  const map = fitIsotonicMap(predictions, ys)
  if (!map) {
    console.log(`[IsotonicCalibrator] Could not fit isotonic map (insufficient bins). Skipping.`)
    return null
  }

  await prisma.tradeLearningStats.upsert({
    where: { season: resolvedSeason },
    create: {
      season: resolvedSeason,
      isotonicMapJson: map as any,
      isotonicComputedAt: new Date(),
      isotonicSampleSize: map.sampleSize,
    },
    update: {
      isotonicMapJson: map as any,
      isotonicComputedAt: new Date(),
      isotonicSampleSize: map.sampleSize,
    },
  })

  console.log(`[IsotonicCalibrator] Isotonic map stored: ${map.points.length} points, sample=${map.sampleSize}, ECE ${map.ece.toFixed(4)} → ${map.eceCalibratedEstimate.toFixed(4)}`)

  return map
}
