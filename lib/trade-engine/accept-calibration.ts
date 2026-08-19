import { prisma } from '../prisma'
import { Prisma } from '@prisma/client'
import { applyIsotonicMap, type IsotonicBinPoint, type IsotonicMap } from './isotonic-calibrator'
import { resolveCurrentTradeLearningSeason } from './season-resolver'

const DEFAULT_B0 = -1.10
const MIN_CALIBRATION_SAMPLE = 30
const MAX_B0_SHIFT = 0.60
const OBSERVED_ACCEPT_RATE = 0.85
const FEEDBACK_LEARNING_RATE = 0.02
const MAX_FEEDBACK_ADJ = 0.15

const FEATURE_WEIGHTS = {
  w1: 1.25,
  w2: 0.70,
  w3: 0.90,
  w4: 0.15,
  w5: 0.25,
  w6: 0.85,
  w7: 0.20,
}

interface CalibrationHistoryEntry {
  timestamp: string
  oldB0: number
  newB0: number
  sampleSize: number
  avgPredicted: number
  observedRate: number
  // 'outcome' is written only by the now-retired calibrateInterceptFromOutcomes()
  // (kept for history-shape compatibility with any pre-existing rows).
  // 'auto-recalibration' is written by promoteShadowB0() (auto-recalibration.ts),
  // the sole current owner of calibratedB0 per
  // docs/TRADE_LEARNING_CALIBRATED_B0_OWNERSHIP_ADR.md.
  source: 'outcome' | 'feedback' | 'auto-recalibration'
}

interface FeedbackWeightAdj {
  w1Adj: number
  w2Adj: number
  w3Adj: number
  w6Adj: number
  sampleSize: number
  lastUpdated: string
}

interface AnalysisResult {
  percentDiff?: number
  marketContext?: {
    isConsolidation?: boolean
    involvesPicks?: boolean
    involvesEliteAsset?: boolean
  }
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

function reconstructAcceptProb(
  valueGiven: number,
  valueReceived: number,
  analysisResult: AnalysisResult | null,
  b0: number,
): number {
  const totalValue = Math.max(valueGiven + valueReceived, 1)
  const marketDeltaPct = ((valueReceived - valueGiven) / totalValue) * 100

  const marketDeltaOppPct = -marketDeltaPct
  const x3 = Math.max(-2, Math.min(2, -marketDeltaOppPct / 12))

  const percentDiff = analysisResult?.percentDiff ?? Math.abs(marketDeltaPct)
  const isConsolidation = analysisResult?.marketContext?.isConsolidation ?? false

  let x4 = 0
  if (isConsolidation) {
    x4 = Math.max(-2, Math.min(2, -0.3))
  }

  const x1Proxy = percentDiff < 15 ? 0.3 : percentDiff < 25 ? 0.1 : -0.2
  const x2Proxy = percentDiff < 20 ? 0.2 : 0

  const z = b0
    + FEATURE_WEIGHTS.w1 * x1Proxy
    + FEATURE_WEIGHTS.w2 * x2Proxy
    + FEATURE_WEIGHTS.w3 * x3
    + FEATURE_WEIGHTS.w4 * x4
    + FEATURE_WEIGHTS.w5 * 0
    + FEATURE_WEIGHTS.w6 * 0
    + FEATURE_WEIGHTS.w7 * 0

  return Math.max(0.02, Math.min(0.95, sigmoid(z)))
}

export async function calibrateInterceptFromOutcomes(
  season?: number,
): Promise<{ newB0: number; sampleSize: number; avgPredicted: number; adjusted: boolean }> {
  const resolvedSeason = season ?? await resolveCurrentTradeLearningSeason()
  const trades = await prisma.leagueTrade.findMany({
    where: {
      analyzed: true,
      season: resolvedSeason,
      valueGiven: { not: null },
      valueReceived: { not: null },
      analysisResult: { not: Prisma.DbNull },
    },
    select: {
      valueGiven: true,
      valueReceived: true,
      analysisResult: true,
    },
  })

  const stats = await prisma.tradeLearningStats.findUnique({
    where: { season: resolvedSeason },
  })

  const currentB0 = (stats?.calibratedB0 as number) ?? DEFAULT_B0
  const currentHistory = (stats?.calibrationHistory as unknown as CalibrationHistoryEntry[]) ?? []

  if (trades.length < MIN_CALIBRATION_SAMPLE) {
    console.log(`[Calibration] Only ${trades.length} trades, need ${MIN_CALIBRATION_SAMPLE}. Skipping.`)
    return { newB0: currentB0, sampleSize: trades.length, avgPredicted: 0, adjusted: false }
  }

  let sumPredicted = 0
  let validCount = 0

  for (const trade of trades) {
    if (trade.valueGiven == null || trade.valueReceived == null) continue

    const pred = reconstructAcceptProb(
      trade.valueGiven,
      trade.valueReceived,
      trade.analysisResult as AnalysisResult | null,
      currentB0,
    )
    sumPredicted += pred
    validCount++
  }

  if (validCount < MIN_CALIBRATION_SAMPLE) {
    return { newB0: currentB0, sampleSize: validCount, avgPredicted: 0, adjusted: false }
  }

  const avgPredicted = sumPredicted / validCount
  const obs = OBSERVED_ACCEPT_RATE

  const safeObs = Math.max(0.01, Math.min(0.99, obs))
  const safePred = Math.max(0.01, Math.min(0.99, avgPredicted))

  const logitObs = Math.log(safeObs / (1 - safeObs))
  const logitPred = Math.log(safePred / (1 - safePred))
  const rawShift = logitObs - logitPred

  const clampedShift = Math.max(-MAX_B0_SHIFT, Math.min(MAX_B0_SHIFT, rawShift))
  const newB0Unclamped = currentB0 + clampedShift
  const newB0Raw = Math.max(DEFAULT_B0 - MAX_B0_SHIFT, Math.min(DEFAULT_B0 + MAX_B0_SHIFT, newB0Unclamped))
  const newB0 = Math.round(newB0Raw * 1000) / 1000

  const entry: CalibrationHistoryEntry = {
    timestamp: new Date().toISOString(),
    oldB0: currentB0,
    newB0,
    sampleSize: validCount,
    avgPredicted: Math.round(avgPredicted * 1000) / 1000,
    observedRate: obs,
    source: 'outcome',
  }

  const updatedHistory = [...currentHistory.slice(-9), entry]

  await prisma.tradeLearningStats.upsert({
    where: { season: resolvedSeason },
    create: {
      season: resolvedSeason,
      calibratedB0: newB0,
      calibrationSampleSize: validCount,
      calibrationHistory: updatedHistory as any,
      lastCalibrated: new Date(),
    },
    update: {
      calibratedB0: newB0,
      calibrationSampleSize: validCount,
      calibrationHistory: updatedHistory as any,
      lastCalibrated: new Date(),
    },
  })

  console.log(`[Calibration] Intercept adjusted: ${currentB0} → ${newB0} (sample=${validCount}, avgPred=${avgPredicted.toFixed(3)}, obs=${obs})`)

  return { newB0, sampleSize: validCount, avgPredicted, adjusted: true }
}

export async function calibrateFromFeedback(
  season?: number,
): Promise<{ adjusted: boolean; feedbackAdj: FeedbackWeightAdj | null }> {
  const resolvedSeason = season ?? await resolveCurrentTradeLearningSeason()
  const feedback = await prisma.tradeFeedback.findMany({
    where: {
      createdAt: {
        gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      },
    },
    select: {
      rating: true,
      aiGrade: true,
      youGive: true,
      youReceive: true,
    },
  })

  if (feedback.length < 10) {
    console.log(`[Calibration] Only ${feedback.length} feedback entries, need 10. Skipping feedback calibration.`)
    return { adjusted: false, feedbackAdj: null }
  }

  const stats = await prisma.tradeLearningStats.findUnique({
    where: { season: resolvedSeason },
  })

  const currentAdj = (stats?.feedbackWeightAdj as unknown as FeedbackWeightAdj) ?? {
    w1Adj: 0,
    w2Adj: 0,
    w3Adj: 0,
    w6Adj: 0,
    sampleSize: 0,
    lastUpdated: new Date().toISOString(),
  }

  let w1Signal = 0
  let w3Signal = 0
  let w6Signal = 0
  let signalCount = 0

  for (const fb of feedback) {
    const aiGrade = fb.aiGrade?.toLowerCase() ?? ''
    const userRating = fb.rating

    const isHighAcceptGrade = aiGrade.includes('accept') || aiGrade.includes('likely') || aiGrade.includes('strong')
    const isLowAcceptGrade = aiGrade.includes('reject') || aiGrade.includes('unlikely') || aiGrade.includes('weak')

    if (isHighAcceptGrade && userRating <= 2) {
      w1Signal -= FEEDBACK_LEARNING_RATE
      w3Signal += FEEDBACK_LEARNING_RATE
      signalCount++
    } else if (isLowAcceptGrade && userRating >= 4) {
      w1Signal += FEEDBACK_LEARNING_RATE
      w3Signal -= FEEDBACK_LEARNING_RATE
      signalCount++
    }

    if (userRating <= 2) {
      w6Signal -= FEEDBACK_LEARNING_RATE * 0.5
      signalCount++
    } else if (userRating >= 4) {
      w6Signal += FEEDBACK_LEARNING_RATE * 0.5
      signalCount++
    }
  }

  if (signalCount === 0) {
    return { adjusted: false, feedbackAdj: currentAdj }
  }

  const newAdj: FeedbackWeightAdj = {
    w1Adj: clampAdj(currentAdj.w1Adj + w1Signal),
    w2Adj: currentAdj.w2Adj,
    w3Adj: clampAdj(currentAdj.w3Adj + w3Signal),
    w6Adj: clampAdj(currentAdj.w6Adj + w6Signal),
    sampleSize: currentAdj.sampleSize + feedback.length,
    lastUpdated: new Date().toISOString(),
  }

  await prisma.tradeLearningStats.upsert({
    where: { season: resolvedSeason },
    create: {
      season: resolvedSeason,
      feedbackWeightAdj: newAdj as any,
      lastCalibrated: new Date(),
    },
    update: {
      feedbackWeightAdj: newAdj as any,
      lastCalibrated: new Date(),
    },
  })

  console.log(`[Calibration] Feedback weight adjustments updated: w1=${newAdj.w1Adj.toFixed(3)}, w3=${newAdj.w3Adj.toFixed(3)}, w6=${newAdj.w6Adj.toFixed(3)} (signals=${signalCount})`)

  return { adjusted: true, feedbackAdj: newAdj }
}

function clampAdj(val: number): number {
  return Math.max(-MAX_FEEDBACK_ADJ, Math.min(MAX_FEEDBACK_ADJ, val))
}

export interface CalibratedWeights {
  b0: number
  w1: number
  w2: number
  w3: number
  w4: number
  w5: number
  w6: number
  w7: number
  segmentUsed?: string | null
}

export interface SegmentContext {
  isSuperFlex?: boolean | null
  scoringType?: string | null
}

interface SegmentB0Entry {
  segment: string
  b0: number
  sampleSize: number
}

interface SegmentB0Map {
  segments: SegmentB0Entry[]
}

let cachedWeights: CalibratedWeights | null = null
let cachedSegmentB0s: SegmentB0Map | null = null
let cachedIsotonicPoints: IsotonicBinPoint[] | null = null
let cachedAt = 0
const CACHE_TTL_MS = 60 * 60 * 1000

function resolveSegmentB0(
  segmentMap: SegmentB0Map | null,
  globalB0: number,
  segment?: SegmentContext,
): { b0: number; segmentUsed: string | null } {
  if (!segmentMap || !segment) return { b0: globalB0, segmentUsed: null }

  const candidates: SegmentB0Entry[] = []

  if (segment.scoringType) {
    const scoring = segment.scoringType.toUpperCase()
    if (scoring === 'TEP' || scoring === 'TE_PREMIUM') {
      const tepEntry = segmentMap.segments.find(s => s.segment === 'TEP')
      if (tepEntry && tepEntry.sampleSize >= 50) candidates.push(tepEntry)
    }
  }

  if (segment.isSuperFlex === true) {
    const sfEntry = segmentMap.segments.find(s => s.segment === 'SF')
    if (sfEntry && sfEntry.sampleSize >= 50) candidates.push(sfEntry)
  } else if (segment.isSuperFlex === false) {
    const qbEntry = segmentMap.segments.find(s => s.segment === '1QB')
    if (qbEntry && qbEntry.sampleSize >= 50) candidates.push(qbEntry)
  }

  if (candidates.length === 0) return { b0: globalB0, segmentUsed: null }

  const best = candidates.reduce((a, b) => a.sampleSize >= b.sampleSize ? a : b)
  return { b0: best.b0, segmentUsed: best.segment }
}

export async function getCalibratedWeights(
  season?: number,
  segment?: SegmentContext,
): Promise<CalibratedWeights> {
  const now = Date.now()
  const cacheValid = cachedWeights && (now - cachedAt) < CACHE_TTL_MS

  if (!cacheValid) {
    try {
      const resolvedSeason = season ?? await resolveCurrentTradeLearningSeason()
      const stats = await prisma.tradeLearningStats.findUnique({
        where: { season: resolvedSeason },
      })

      const rawStats = stats as Record<string, unknown> | null
      const b0 = (rawStats?.calibratedB0 as number) ?? DEFAULT_B0
      const feedbackAdj = (rawStats?.feedbackWeightAdj as unknown as FeedbackWeightAdj) ?? null
      const segB0s = (rawStats?.segmentB0s as unknown as SegmentB0Map) ?? null

      cachedWeights = {
        b0,
        w1: FEATURE_WEIGHTS.w1 + (feedbackAdj?.w1Adj ?? 0),
        w2: FEATURE_WEIGHTS.w2 + (feedbackAdj?.w2Adj ?? 0),
        w3: FEATURE_WEIGHTS.w3 + (feedbackAdj?.w3Adj ?? 0),
        w4: FEATURE_WEIGHTS.w4,
        w5: FEATURE_WEIGHTS.w5,
        w6: FEATURE_WEIGHTS.w6 + (feedbackAdj?.w6Adj ?? 0),
        w7: FEATURE_WEIGHTS.w7,
      }

      const isotonicData = rawStats?.isotonicMapJson as unknown as IsotonicMap | null
      cachedIsotonicPoints = isotonicData?.points ?? null

      cachedSegmentB0s = segB0s
      cachedAt = now
    } catch (err) {
      console.error('[Calibration] Failed to load calibrated weights, using defaults:', err)
      return {
        b0: DEFAULT_B0,
        ...FEATURE_WEIGHTS,
        segmentUsed: null,
      }
    }
  }

  const base = { ...cachedWeights! }

  if (segment && cachedSegmentB0s) {
    const resolved = resolveSegmentB0(cachedSegmentB0s, base.b0, segment)
    base.b0 = resolved.b0
    base.segmentUsed = resolved.segmentUsed
  } else {
    base.segmentUsed = null
  }

  return base
}

export function invalidateCalibrationCache(): void {
  cachedWeights = null
  cachedIsotonicPoints = null
  cachedAt = 0
}

export async function calibrateAcceptProbability(
  rawProbability: number,
  season?: number,
): Promise<{ calibrated: number; raw: number; isotonicApplied: boolean }> {
  await getCalibratedWeights(season)

  if (cachedIsotonicPoints && cachedIsotonicPoints.length >= 3) {
    const calibrated = applyIsotonicMap(rawProbability, cachedIsotonicPoints)
    return { calibrated, raw: rawProbability, isotonicApplied: true }
  }

  return { calibrated: rawProbability, raw: rawProbability, isotonicApplied: false }
}

export function getIsotonicPoints(): IsotonicBinPoint[] | null {
  return cachedIsotonicPoints
}

/**
 * Reads the current calibratedB0 without changing it. Per
 * docs/TRADE_LEARNING_CALIBRATED_B0_OWNERSHIP_ADR.md, intercept calibration
 * is now owned exclusively by promoteShadowB0() (auto-recalibration.ts),
 * which calibrates against real TradeOutcomeEvent data. This function no
 * longer shifts calibratedB0 toward the hardcoded OBSERVED_ACCEPT_RATE
 * constant that calibrateInterceptFromOutcomes() targets.
 */
async function readCurrentB0Unchanged(
  season: number,
): Promise<{ newB0: number; sampleSize: number; avgPredicted: number; adjusted: boolean }> {
  const stats = await prisma.tradeLearningStats.findUnique({
    where: { season },
    select: { calibratedB0: true },
  })
  const currentB0 = (stats?.calibratedB0 as number) ?? DEFAULT_B0
  return { newB0: currentB0, sampleSize: 0, avgPredicted: 0, adjusted: false }
}

export async function runFullCalibration(
  season?: number,
): Promise<{
  intercept: { newB0: number; sampleSize: number; adjusted: boolean }
  feedback: { adjusted: boolean }
}> {
  console.log('[Calibration] Starting full calibration cycle...')

  const resolvedSeason = season ?? await resolveCurrentTradeLearningSeason()

  // Intercept calibration is retired from this orchestration per
  // docs/TRADE_LEARNING_CALIBRATED_B0_OWNERSHIP_ADR.md — calibratedB0 is now
  // written only by promoteShadowB0() (auto-recalibration.ts). This function
  // still exists, is still exported, and remains independently callable/testable;
  // it is simply no longer invoked by this default sequence.
  const intercept = await readCurrentB0Unchanged(resolvedSeason)
  const feedback = await calibrateFromFeedback(resolvedSeason)

  invalidateCalibrationCache()

  console.log(`[Calibration] Complete. b0=${intercept.newB0} (intercept calibration retired — owned by promoteShadowB0), feedbackAdj=${feedback.adjusted}`)

  return {
    intercept: {
      newB0: intercept.newB0,
      sampleSize: intercept.sampleSize,
      adjusted: intercept.adjusted,
    },
    feedback: { adjusted: feedback.adjusted },
  }
}
