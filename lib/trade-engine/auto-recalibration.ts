import { prisma } from '../prisma'
import { Prisma } from '@prisma/client'
import { invalidateCalibrationCache } from './accept-calibration'
import { computeAndStoreIsotonicMap, type IsotonicMap } from './isotonic-calibrator'
import { resolveCurrentTradeLearningSeason } from './season-resolver'

// Exported (values unchanged) so diagnostics tooling can reference the real
// thresholds instead of duplicating magic numbers. See lib/trade-engine/diagnostics.ts.
export const DEFAULT_B0 = -1.10
export const MIN_RECALIBRATION_SAMPLE = 30
export const MIN_SEGMENT_SAMPLE = 50
export const MAX_B0_SHIFT = 0.60
export const SHADOW_MATURITY_DAYS = 7
export const MAX_SHADOW_DIVERGENCE = 0.40
// Mirrors the cadence guard inside runWeeklyRecalibration() itself
// (daysSinceRecal < 6.5) — exported so diagnostics can report the same
// "would it run right now" answer without re-implementing the check.
export const RECALIBRATION_CADENCE_DAYS = 6.5

export interface ShadowB0Metrics {
  computedB0: number
  currentActiveB0: number
  observedRate: number
  predictedMean: number
  logOddsCorrection: number
  sampleSize: number
  computedAt: string
  mature: boolean
  divergence: number
}

export interface SegmentB0Entry {
  segment: string
  b0: number
  sampleSize: number
  observedRate: number
  predictedMean: number
  lastUpdated: string
}

export interface SegmentB0Map {
  segments: SegmentB0Entry[]
  lastUpdated: string
}

export interface RecalibrationResult {
  shadow: {
    computed: boolean
    shadowB0: number | null
    metrics: ShadowB0Metrics | null
    promoted: boolean
    promotedB0: number | null
  }
  segments: {
    computed: boolean
    segmentCount: number
    entries: SegmentB0Entry[]
  }
  isotonic: {
    computed: boolean
    sampleSize: number
    eceBefore: number | null
    eceAfter: number | null
  }
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

function reconstructAcceptProbSimple(
  valueGiven: number,
  valueReceived: number,
  b0: number,
): number {
  const totalValue = Math.max(valueGiven + valueReceived, 1)
  const marketDeltaPct = ((valueReceived - valueGiven) / totalValue) * 100
  const x3 = Math.max(-2, Math.min(2, marketDeltaPct / 12))
  const percentDiff = Math.abs(marketDeltaPct)
  const x1Proxy = percentDiff < 15 ? 0.3 : percentDiff < 25 ? 0.1 : -0.2
  const x2Proxy = percentDiff < 20 ? 0.2 : 0

  const z = b0
    + 1.25 * x1Proxy
    + 0.70 * x2Proxy
    + 0.90 * x3
    + 0.15 * 0
    + 0.25 * 0
    + 0.85 * 0
    + 0.20 * 0

  return Math.max(0.02, Math.min(0.95, sigmoid(z)))
}

/**
 * Binary-labels a TradeOutcomeEvent.outcome for acceptance-rate calibration.
 * Real values are the Prisma `TradeOutcome` enum (ACCEPTED | REJECTED | EXPIRED |
 * COUNTERED | UNKNOWN, schema.prisma) — uppercase, never 'accepted'/'completed'.
 * Only ACCEPTED/REJECTED/EXPIRED carry a real accept/reject signal, matching the
 * same convention already used by lib/trade-engine/model-metrics-etl.ts and
 * lib/rankings-engine/{weekly-weight-learning,adaptive-weight-learning}.ts.
 * COUNTERED/UNKNOWN are excluded rather than counted as non-accepted, since
 * they don't indicate whether the trade would have been accepted or not.
 */
export function computeObservedAcceptRate(
  outcomes: Array<{ outcome: string }>,
): number | null {
  const labeled = outcomes.filter(
    o => o.outcome === 'ACCEPTED' || o.outcome === 'REJECTED' || o.outcome === 'EXPIRED',
  )
  if (labeled.length === 0) return null
  const accepted = labeled.filter(o => o.outcome === 'ACCEPTED').length
  return accepted / labeled.length
}

function logOddsCorrection(observed: number, predicted: number): number {
  const safeObs = Math.max(0.01, Math.min(0.99, observed))
  const safePred = Math.max(0.01, Math.min(0.99, predicted))
  const logitObs = Math.log(safeObs / (1 - safeObs))
  const logitPred = Math.log(safePred / (1 - safePred))
  return logitObs - logitPred
}

export async function computeShadowB0(
  season?: number,
): Promise<ShadowB0Metrics | null> {
  const resolvedSeason = season ?? await resolveCurrentTradeLearningSeason()
  const outcomes = await prisma.tradeOutcomeEvent.findMany({
    where: {
      season: resolvedSeason,
      offerEventId: { not: null },
    },
    select: { offerEventId: true, outcome: true },
  })

  if (outcomes.length < MIN_RECALIBRATION_SAMPLE) {
    console.log(`[AutoRecal] Only ${outcomes.length} outcomes, need ${MIN_RECALIBRATION_SAMPLE}. Skipping shadow b0.`)
    return null
  }

  const offerIds = outcomes
    .map(o => o.offerEventId)
    .filter((id): id is string => id !== null)

  const offers = await prisma.tradeOfferEvent.findMany({
    where: { id: { in: offerIds } },
    select: {
      id: true,
      featuresJson: true,
      acceptProb: true,
    },
  })

  const offerMap = new Map(offers.map(o => [o.id, o]))

  const stats = await prisma.tradeLearningStats.findUnique({
    where: { season: resolvedSeason },
    select: { calibratedB0: true },
  })

  const currentB0 = (stats?.calibratedB0 as number) ?? DEFAULT_B0

  const observedRate = computeObservedAcceptRate(outcomes)
  if (observedRate === null) return null

  let sumPredicted = 0
  let validCount = 0

  for (const outcome of outcomes) {
    if (!outcome.offerEventId) continue
    const offer = offerMap.get(outcome.offerEventId)
    if (!offer) continue

    const prob = offer.acceptProb
    if (prob != null && prob > 0) {
      sumPredicted += prob
      validCount++
    }
  }

  if (validCount < MIN_RECALIBRATION_SAMPLE) {
    const trades = await prisma.leagueTrade.findMany({
      where: {
        analyzed: true,
        season: resolvedSeason,
        valueGiven: { not: null },
        valueReceived: { not: null },
      },
      select: { valueGiven: true, valueReceived: true },
    })

    for (const t of trades) {
      if (t.valueGiven == null || t.valueReceived == null) continue
      sumPredicted += reconstructAcceptProbSimple(t.valueGiven, t.valueReceived, currentB0)
      validCount++
    }
  }

  if (validCount < MIN_RECALIBRATION_SAMPLE) {
    console.log(`[AutoRecal] Only ${validCount} valid predictions, need ${MIN_RECALIBRATION_SAMPLE}. Skipping.`)
    return null
  }

  const predictedMean = sumPredicted / validCount
  const correction = logOddsCorrection(observedRate, predictedMean)

  const clampedCorrection = Math.max(-MAX_B0_SHIFT, Math.min(MAX_B0_SHIFT, correction))
  const rawNewB0 = currentB0 + clampedCorrection
  const newB0 = Math.round(
    Math.max(DEFAULT_B0 - MAX_B0_SHIFT, Math.min(DEFAULT_B0 + MAX_B0_SHIFT, rawNewB0)) * 1000,
  ) / 1000

  const divergence = Math.abs(newB0 - currentB0)

  const metrics: ShadowB0Metrics = {
    computedB0: newB0,
    currentActiveB0: currentB0,
    observedRate: Math.round(observedRate * 1000) / 1000,
    predictedMean: Math.round(predictedMean * 1000) / 1000,
    logOddsCorrection: Math.round(clampedCorrection * 1000) / 1000,
    sampleSize: validCount,
    computedAt: new Date().toISOString(),
    mature: false,
    divergence: Math.round(divergence * 1000) / 1000,
  }

  console.log(`[AutoRecal] Shadow b0 computed: ${newB0} (active=${currentB0}, obs=${observedRate.toFixed(3)}, pred=${predictedMean.toFixed(3)}, correction=${clampedCorrection.toFixed(3)}, n=${validCount})`)

  return metrics
}

export async function promoteShadowB0(
  season?: number,
): Promise<{ promoted: boolean; newB0: number | null; reason: string }> {
  const resolvedSeason = season ?? await resolveCurrentTradeLearningSeason()
  const stats = await prisma.tradeLearningStats.findUnique({
    where: { season: resolvedSeason },
  })

  if (!stats) {
    return { promoted: false, newB0: null, reason: 'No TradeLearningStats record found' }
  }

  const shadowB0 = stats.shadowB0 as number | null
  const shadowComputedAt = stats.shadowB0ComputedAt
  const shadowMetrics = stats.shadowB0Metrics as unknown as ShadowB0Metrics | null

  if (shadowB0 == null || !shadowComputedAt || !shadowMetrics) {
    return { promoted: false, newB0: null, reason: 'No shadow b0 pending' }
  }

  const ageMs = Date.now() - new Date(shadowComputedAt).getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)

  if (ageDays < SHADOW_MATURITY_DAYS) {
    return {
      promoted: false,
      newB0: null,
      reason: `Shadow b0 only ${ageDays.toFixed(1)} days old, needs ${SHADOW_MATURITY_DAYS} days`,
    }
  }

  const currentB0 = (stats.calibratedB0 as number) ?? DEFAULT_B0
  const divergence = Math.abs(shadowB0 - currentB0)

  if (divergence > MAX_SHADOW_DIVERGENCE) {
    return {
      promoted: false,
      newB0: null,
      reason: `Shadow b0 diverges ${divergence.toFixed(3)} from active, exceeds max ${MAX_SHADOW_DIVERGENCE}`,
    }
  }

  const currentHistory = (stats.calibrationHistory as unknown as Array<Record<string, unknown>>) ?? []

  const entry = {
    timestamp: new Date().toISOString(),
    oldB0: currentB0,
    newB0: shadowB0,
    sampleSize: shadowMetrics.sampleSize,
    avgPredicted: shadowMetrics.predictedMean,
    observedRate: shadowMetrics.observedRate,
    source: 'auto-recalibration',
  }

  await prisma.tradeLearningStats.update({
    where: { season: resolvedSeason },
    data: {
      calibratedB0: shadowB0,
      calibrationSampleSize: shadowMetrics.sampleSize,
      calibrationHistory: [...currentHistory.slice(-9), entry] as any,
      shadowB0: null,
      shadowB0SampleSize: null,
      shadowB0ComputedAt: null,
      shadowB0Metrics: Prisma.DbNull,
      lastRecalibrationAt: new Date(),
      lastCalibrated: new Date(),
    },
  })

  invalidateCalibrationCache()

  console.log(`[AutoRecal] Shadow b0 PROMOTED: ${currentB0} → ${shadowB0} (age=${ageDays.toFixed(1)}d, divergence=${divergence.toFixed(3)})`)

  return { promoted: true, newB0: shadowB0, reason: 'Promoted successfully' }
}

export async function computeSegmentB0s(
  season?: number,
): Promise<SegmentB0Entry[]> {
  const resolvedSeason = season ?? await resolveCurrentTradeLearningSeason()
  const outcomes = await prisma.tradeOutcomeEvent.findMany({
    where: {
      season: resolvedSeason,
      offerEventId: { not: null },
    },
    select: { offerEventId: true, outcome: true },
  })

  const offerIds = outcomes
    .map(o => o.offerEventId)
    .filter((id): id is string => id !== null)

  const offers = await prisma.tradeOfferEvent.findMany({
    where: { id: { in: offerIds } },
    select: {
      id: true,
      acceptProb: true,
      isSuperFlex: true,
      leagueFormat: true,
      scoringType: true,
    },
  })

  const offerMap = new Map(offers.map(o => [o.id, o]))

  interface SegmentBucket {
    segment: string
    predictions: number[]
    outcomes: string[]
  }

  const buckets = new Map<string, SegmentBucket>()

  function addToBucket(segment: string, pred: number, outcome: string) {
    let bucket = buckets.get(segment)
    if (!bucket) {
      bucket = { segment, predictions: [], outcomes: [] }
      buckets.set(segment, bucket)
    }
    bucket.predictions.push(pred)
    bucket.outcomes.push(outcome)
  }

  for (const out of outcomes) {
    if (!out.offerEventId) continue
    const offer = offerMap.get(out.offerEventId)
    if (!offer || offer.acceptProb == null) continue

    if (offer.isSuperFlex === true) addToBucket('SF', offer.acceptProb, out.outcome)
    else if (offer.isSuperFlex === false) addToBucket('1QB', offer.acceptProb, out.outcome)

    if (offer.leagueFormat) {
      addToBucket(offer.leagueFormat.toLowerCase(), offer.acceptProb, out.outcome)
    }

    if (offer.scoringType) {
      const scoring = offer.scoringType.toUpperCase()
      if (scoring === 'TEP' || scoring === 'TE_PREMIUM') {
        addToBucket('TEP', offer.acceptProb, out.outcome)
      }
    }
  }

  const stats = await prisma.tradeLearningStats.findUnique({
    where: { season: resolvedSeason },
    select: { calibratedB0: true },
  })
  const globalB0 = (stats?.calibratedB0 as number) ?? DEFAULT_B0

  const entries: SegmentB0Entry[] = []

  for (const [, bucket] of buckets) {
    if (bucket.predictions.length < MIN_SEGMENT_SAMPLE) continue

    const observedRate = computeObservedAcceptRate(
      bucket.outcomes.map(o => ({ outcome: o })),
    )
    if (observedRate === null) continue

    const predictedMean = bucket.predictions.reduce((s, v) => s + v, 0) / bucket.predictions.length

    const correction = logOddsCorrection(observedRate, predictedMean)
    const clampedCorrection = Math.max(-MAX_B0_SHIFT, Math.min(MAX_B0_SHIFT, correction))
    const rawSegB0 = globalB0 + clampedCorrection
    const segB0 = Math.round(
      Math.max(DEFAULT_B0 - MAX_B0_SHIFT, Math.min(DEFAULT_B0 + MAX_B0_SHIFT, rawSegB0)) * 1000,
    ) / 1000

    entries.push({
      segment: bucket.segment,
      b0: segB0,
      sampleSize: bucket.predictions.length,
      observedRate: Math.round(observedRate * 1000) / 1000,
      predictedMean: Math.round(predictedMean * 1000) / 1000,
      lastUpdated: new Date().toISOString(),
    })

    console.log(`[AutoRecal] Segment ${bucket.segment}: b0=${segB0} (obs=${observedRate.toFixed(3)}, pred=${predictedMean.toFixed(3)}, n=${bucket.predictions.length})`)
  }

  return entries
}

export async function runWeeklyRecalibration(
  season?: number,
): Promise<RecalibrationResult> {
  console.log('[AutoRecal] Starting weekly recalibration...')

  // Resolved once, here, and threaded explicitly through every downstream
  // call below — guarantees the entire weekly cycle (promotion, shadow
  // computation, segments, isotonic) operates on exactly one season value,
  // even though resolveCurrentTradeLearningSeason() is itself cached.
  const resolvedSeason = season ?? await resolveCurrentTradeLearningSeason()

  const stats = await prisma.tradeLearningStats.findUnique({
    where: { season: resolvedSeason },
  })

  const lastRecal = stats?.lastRecalibrationAt
  if (lastRecal) {
    const daysSinceRecal = (Date.now() - new Date(lastRecal).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceRecal < RECALIBRATION_CADENCE_DAYS) {
      console.log(`[AutoRecal] Only ${daysSinceRecal.toFixed(1)} days since last recalibration. Skipping (weekly cadence).`)
      return {
        shadow: { computed: false, shadowB0: null, metrics: null, promoted: false, promotedB0: null },
        segments: { computed: false, segmentCount: 0, entries: [] },
        isotonic: { computed: false, sampleSize: 0, eceBefore: null, eceAfter: null },
      }
    }
  }

  let promoted = false
  let promotedB0: number | null = null

  if (stats?.shadowB0 != null && stats.shadowB0ComputedAt) {
    const promoResult = await promoteShadowB0(resolvedSeason)
    promoted = promoResult.promoted
    promotedB0 = promoResult.newB0
    if (!promoted) {
      console.log(`[AutoRecal] Shadow promotion skipped: ${promoResult.reason}`)
    }
  }

  const shadowMetrics = await computeShadowB0(resolvedSeason)

  if (shadowMetrics) {
    await prisma.tradeLearningStats.upsert({
      where: { season: resolvedSeason },
      create: {
        season: resolvedSeason,
        shadowB0: shadowMetrics.computedB0,
        shadowB0SampleSize: shadowMetrics.sampleSize,
        shadowB0ComputedAt: new Date(),
        shadowB0Metrics: shadowMetrics as any,
        lastRecalibrationAt: new Date(),
      },
      update: {
        shadowB0: shadowMetrics.computedB0,
        shadowB0SampleSize: shadowMetrics.sampleSize,
        shadowB0ComputedAt: new Date(),
        shadowB0Metrics: shadowMetrics as any,
        lastRecalibrationAt: new Date(),
      },
    })
  }

  const segmentEntries = await computeSegmentB0s(resolvedSeason)

  if (segmentEntries.length > 0) {
    const segmentMap: SegmentB0Map = {
      segments: segmentEntries,
      lastUpdated: new Date().toISOString(),
    }

    await prisma.tradeLearningStats.upsert({
      where: { season: resolvedSeason },
      create: {
        season: resolvedSeason,
        segmentB0s: segmentMap as any,
        lastRecalibrationAt: new Date(),
      },
      update: {
        segmentB0s: segmentMap as any,
        lastRecalibrationAt: new Date(),
      },
    })
  }

  const isotonicMap = await computeAndStoreIsotonicMap(resolvedSeason)

  if (isotonicMap) {
    invalidateCalibrationCache()
  }

  console.log(`[AutoRecal] Weekly recalibration complete. Shadow=${shadowMetrics?.computedB0 ?? 'none'}, promoted=${promoted}, segments=${segmentEntries.length}, isotonic=${isotonicMap ? `${isotonicMap.points.length}pts` : 'skipped'}`)

  return {
    shadow: {
      computed: shadowMetrics !== null,
      shadowB0: shadowMetrics?.computedB0 ?? null,
      metrics: shadowMetrics,
      promoted,
      promotedB0,
    },
    segments: {
      computed: segmentEntries.length > 0,
      segmentCount: segmentEntries.length,
      entries: segmentEntries,
    },
    isotonic: {
      computed: isotonicMap !== null,
      sampleSize: isotonicMap?.sampleSize ?? 0,
      eceBefore: isotonicMap?.ece ?? null,
      eceAfter: isotonicMap?.eceCalibratedEstimate ?? null,
    },
  }
}

/**
 * Operational kill switch for weekly recalibration, per
 * docs/TRADE_LEARNING_CALIBRATED_B0_OWNERSHIP_ADR.md and
 * docs/DECISION_OS_CLOSED_LOOP_LEARNING_AUDIT.md §7 Step 0. Mirrors the
 * DECISION_OS_*_LIVE convention (lib/decision-os/{lineup,waiver,trade,
 * commissioner-health}/shadow.ts): disabled unless explicitly set to "true".
 * Defaults to disabled — this must not run in production until explicitly
 * enabled by an operator.
 */
export function isWeeklyRecalibrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env['TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED'] ?? '').trim().toLowerCase() === 'true'
}

/**
 * Controlled background entry point for runWeeklyRecalibration(). No-ops
 * cleanly (zero Prisma calls) when the flag is off. This is the only place
 * runWeeklyRecalibration() is invoked from outside its own module and tests.
 */
export async function runScheduledWeeklyRecalibration(
  env: NodeJS.ProcessEnv = process.env,
  season?: number,
): Promise<{ ran: boolean; reason?: string; result?: RecalibrationResult }> {
  const enabled = isWeeklyRecalibrationEnabled(env)
  console.log(`[TradeLearningScheduler] invoked (flag=${enabled ? 'enabled' : 'disabled'})`)

  if (!enabled) {
    const reason = 'disabled (TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED is not "true")'
    console.log(`[TradeLearningScheduler] skipped: ${reason}`)
    return { ran: false, reason }
  }

  const result = season !== undefined ? await runWeeklyRecalibration(season) : await runWeeklyRecalibration()

  console.log(
    `[TradeLearningScheduler] complete — shadowComputed=${result.shadow.computed}, ` +
      `promoted=${result.shadow.promoted}${result.shadow.promoted ? ` (newB0=${result.shadow.promotedB0})` : ''}, ` +
      `segments=${result.segments.segmentCount}, isotonic=${result.isotonic.computed}`,
  )

  return { ran: true, result }
}
