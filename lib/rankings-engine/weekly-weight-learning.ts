import { prisma } from '@/lib/prisma'
import { TradeOutcome } from '@prisma/client'
import { getBaselineWeights, type ComponentWeights } from './adaptive-weight-learning'

type WeightStatus = 'APPLIED' | 'REJECTED' | 'INSUFFICIENT_DATA' | 'ROLLED_BACK'

const SEGMENT_KEYS = ['DYN_SF', 'DYN_1QB', 'RED_SF', 'RED_1QB', 'SPC'] as const
export type SegmentKey = (typeof SEGMENT_KEYS)[number]

const MIN_SAMPLES = 200
const MAX_WEEKLY_MOVEMENT = 0.05
const LAMBDA_L2 = 0.1
const LR_ITERATIONS = 200
const LR_STEP = 0.01
const QUALITY_AUC_IMPROVEMENT = 0.01
const QUALITY_BRIER_IMPROVEMENT = 0.002
const QUALITY_ECE_IMPROVEMENT = 0.01
const ROLLBACK_HISTORY = 6

interface Sample {
  market: number
  impact: number
  vorp: number
  demand: number
  y: 0 | 1
}

interface LRResult {
  betas: number[]
  intercept: number
}

interface QualityMetrics {
  auc: number
  brier: number
  eceMid: number
}

interface WeeklyLearningResult {
  segmentKey: string
  weekStart: Date
  status: WeightStatus
  prior: ComponentWeights
  learned: ComponentWeights | null
  final: ComponentWeights
  metrics: {
    nSamples: number
    aucDelta: number
    brierDelta: number
    eceDelta: number
    priorAuc: number
    learnedAuc: number
  }
  version: string
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function sigmoid(z: number): number {
  if (z > 20) return 1
  if (z < -20) return 0
  return 1 / (1 + Math.exp(-z))
}

function predict(x: number[], betas: number[], intercept: number): number {
  let z = intercept
  for (let i = 0; i < x.length; i++) z += betas[i] * x[i]
  return sigmoid(z)
}

function fitLogisticRegression(samples: Sample[], lambda: number): LRResult {
  const n = samples.length
  const features = samples.map(s => [s.market, s.impact, s.vorp, s.demand])
  const labels = samples.map(s => s.y)

  let betas = [0, 0, 0, 0]
  let intercept = 0

  for (let iter = 0; iter < LR_ITERATIONS; iter++) {
    const gradB = [0, 0, 0, 0]
    let gradInt = 0

    for (let i = 0; i < n; i++) {
      const p = predict(features[i], betas, intercept)
      const err = p - labels[i]
      gradInt += err
      for (let j = 0; j < 4; j++) {
        gradB[j] += err * features[i][j]
      }
    }

    intercept -= LR_STEP * (gradInt / n)
    for (let j = 0; j < 4; j++) {
      betas[j] -= LR_STEP * (gradB[j] / n + lambda * betas[j])
    }
  }

  return { betas, intercept }
}

function betasToWeights(betas: number[]): ComponentWeights {
  const raw = betas.map(b => Math.max(b, 0))
  const sum = raw.reduce((s, v) => s + v, 0)
  if (sum === 0) return { market: 0.25, impact: 0.25, scarcity: 0.25, demand: 0.25 }
  return {
    market: raw[0] / sum,
    impact: raw[1] / sum,
    scarcity: raw[2] / sum,
    demand: raw[3] / sum,
  }
}

function computeAUC(samples: Sample[], betas: number[], intercept: number): number {
  const scored = samples.map(s => ({
    p: predict([s.market, s.impact, s.vorp, s.demand], betas, intercept),
    y: s.y,
  }))
  scored.sort((a, b) => b.p - a.p)

  let tp = 0, fp = 0
  const totalP = scored.filter(s => s.y === 1).length
  const totalN = scored.length - totalP
  if (totalP === 0 || totalN === 0) return 0.5

  let auc = 0
  let prevFPR = 0
  let prevTPR = 0

  for (const s of scored) {
    if (s.y === 1) tp++
    else fp++
    const tpr = tp / totalP
    const fpr = fp / totalN
    auc += (fpr - prevFPR) * (tpr + prevTPR) / 2
    prevFPR = fpr
    prevTPR = tpr
  }

  return auc
}

function computeBrier(samples: Sample[], betas: number[], intercept: number): number {
  let sum = 0
  for (const s of samples) {
    const p = predict([s.market, s.impact, s.vorp, s.demand], betas, intercept)
    sum += (p - s.y) ** 2
  }
  return sum / samples.length
}

function computeECEMid(samples: Sample[], betas: number[], intercept: number, nBuckets = 10): number {
  const predictions = samples.map(s => ({
    p: predict([s.market, s.impact, s.vorp, s.demand], betas, intercept),
    y: s.y,
  }))

  const buckets: { sumP: number; sumY: number; count: number }[] = Array.from(
    { length: nBuckets },
    () => ({ sumP: 0, sumY: 0, count: 0 })
  )

  for (const { p, y } of predictions) {
    const idx = Math.min(Math.floor(p * nBuckets), nBuckets - 1)
    buckets[idx].sumP += p
    buckets[idx].sumY += y
    buckets[idx].count++
  }

  let ece = 0
  const n = predictions.length
  for (const b of buckets) {
    if (b.count === 0) continue
    const avgP = b.sumP / b.count
    const avgY = b.sumY / b.count
    ece += (b.count / n) * Math.abs(avgP - avgY)
  }
  return ece
}

function computeMetrics(samples: Sample[], betas: number[], intercept: number): QualityMetrics {
  return {
    auc: computeAUC(samples, betas, intercept),
    brier: computeBrier(samples, betas, intercept),
    eceMid: computeECEMid(samples, betas, intercept),
  }
}

function getSeasonAlpha(): number {
  const now = new Date()
  const month = now.getMonth()
  if (month >= 8 && month <= 9) return 0.6
  if (month >= 10 && month <= 11) return 0.4
  return 0.3
}

function clampMovement(
  newW: ComponentWeights,
  prevW: ComponentWeights,
  maxDelta: number,
): ComponentWeights {
  return {
    market: clamp(newW.market, prevW.market - maxDelta, prevW.market + maxDelta),
    impact: clamp(newW.impact, prevW.impact - maxDelta, prevW.impact + maxDelta),
    scarcity: clamp(newW.scarcity, prevW.scarcity - maxDelta, prevW.scarcity + maxDelta),
    demand: clamp(newW.demand, prevW.demand - maxDelta, prevW.demand + maxDelta),
  }
}

function normalizeWeights(w: ComponentWeights): ComponentWeights {
  const sum = w.market + w.impact + w.scarcity + w.demand
  if (sum === 0) return { market: 0.25, impact: 0.25, scarcity: 0.25, demand: 0.25 }
  return {
    market: w.market / sum,
    impact: w.impact / sum,
    scarcity: w.scarcity / sum,
    demand: w.demand / sum,
  }
}

function blendWithPrior(
  prior: ComponentWeights,
  learned: ComponentWeights,
  alpha: number,
): ComponentWeights {
  return normalizeWeights({
    market: alpha * prior.market + (1 - alpha) * learned.market,
    impact: alpha * prior.impact + (1 - alpha) * learned.impact,
    scarcity: alpha * prior.scarcity + (1 - alpha) * learned.scarcity,
    demand: alpha * prior.demand + (1 - alpha) * learned.demand,
  })
}

function getMonday(d: Date): Date {
  const dt = new Date(d)
  dt.setUTCHours(0, 0, 0, 0)
  const day = dt.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  dt.setUTCDate(dt.getUTCDate() + diff)
  return dt
}

function makeVersion(weekStart: Date, segmentKey: string): string {
  const y = weekStart.getUTCFullYear()
  const oneJan = new Date(Date.UTC(y, 0, 1))
  const weekNum = Math.ceil(((weekStart.getTime() - oneJan.getTime()) / 86400000 + oneJan.getUTCDay() + 1) / 7)
  return `rw_${y}w${String(weekNum).padStart(2, '0')}_${segmentKey}`
}

async function fetchLdiCache(): Promise<Map<string, Record<string, { ldi: number }>>> {
  const snapshots = await prisma.leagueDemandWeekly.findMany({
    orderBy: { weekStart: 'desc' },
    distinct: ['leagueId'],
    select: { leagueId: true, demandByPosition: true },
    take: 500,
  })
  const m = new Map<string, Record<string, { ldi: number }>>()
  for (const s of snapshots) {
    const dj = s.demandByPosition as any
    if (dj && typeof dj === 'object' && dj.QB && typeof dj.QB === 'object') {
      m.set(s.leagueId, dj)
    }
  }
  return m
}

function computeLdiDemandFromAssets(
  assetsReceived: any[],
  demandJson: Record<string, { ldi: number }>,
): number | null {
  if (!assetsReceived || !Array.isArray(assetsReceived) || assetsReceived.length === 0) return null
  let weightedSum = 0
  let totalValue = 0
  for (const a of assetsReceived) {
    const pos = String(a?.position || a?.type || '').toUpperCase()
    const v = Number(a?.value || 0)
    if (v <= 0) continue
    const posLdi = demandJson[pos]?.ldi ?? demandJson[pos.includes('PICK') ? 'PICK' : pos]?.ldi ?? 50
    weightedSum += (v * posLdi) / 100
    totalValue += v
  }
  if (totalValue <= 0) return null
  return weightedSum / totalValue
}

async function fetchSamples(
  segmentKey: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<Sample[]> {
  const offers = await prisma.tradeOfferEvent.findMany({
    where: {
      createdAt: { gte: windowStart, lt: windowEnd },
    },
    select: {
      id: true,
      featuresJson: true,
      leagueFormat: true,
      leagueId: true,
      assetsReceived: true,
    },
    take: 10000,
  })

  const relevantOffers = offers.filter(o => {
    const fmt = (o.leagueFormat ?? '').toUpperCase()
    if (segmentKey === 'DYN_SF') return fmt.includes('DYN') && fmt.includes('SF')
    if (segmentKey === 'DYN_1QB') return fmt.includes('DYN') && fmt.includes('1QB')
    if (segmentKey === 'RED_SF') return fmt.includes('RED') && fmt.includes('SF')
    if (segmentKey === 'RED_1QB') return fmt.includes('RED') && fmt.includes('1QB')
    if (segmentKey === 'SPC') return fmt.includes('SPC')
    return true
  })

  if (relevantOffers.length === 0) return []

  const offerIds = relevantOffers.map(o => o.id)
  const outcomes = await prisma.tradeOutcomeEvent.findMany({
    where: { offerEventId: { in: offerIds } },
    select: { offerEventId: true, outcome: true },
  })
  const outcomeMap = new Map(outcomes.map(o => [o.offerEventId, o.outcome]))

  const ldiCache = await fetchLdiCache()

  const samples: Sample[] = []
  for (const offer of relevantOffers) {
    const out = outcomeMap.get(offer.id)
    if (out !== TradeOutcome.ACCEPTED && out !== TradeOutcome.REJECTED && out !== TradeOutcome.EXPIRED) continue

    const f = (offer.featuresJson ?? {}) as Record<string, any>

    let demandScore = Number(f.demand ?? f.behavior ?? 0.5)
    if (offer.leagueId && ldiCache.has(offer.leagueId)) {
      const ldiDemand = computeLdiDemandFromAssets(
        offer.assetsReceived as any[],
        ldiCache.get(offer.leagueId)!,
      )
      if (ldiDemand !== null) {
        demandScore = ldiDemand
      }
    }

    samples.push({
      market: clamp(Number(f.market ?? 0.5), 0, 1),
      impact: clamp(Number(f.lineupImpact ?? 0.5), 0, 1),
      vorp: clamp(Number(f.vorp ?? 0.5), 0, 1),
      demand: clamp(demandScore, 0, 1),
      y: out === TradeOutcome.ACCEPTED ? 1 : 0,
    })
  }

  return samples
}

async function getPreviousWeights(segmentKey: string): Promise<ComponentWeights | null> {
  const prev = await prisma.rankingWeightsWeekly.findFirst({
    where: { segmentKey, status: 'APPLIED' },
    orderBy: { weekStart: 'desc' },
  })
  if (!prev) return null
  const f = prev.finalJson as Record<string, number>
  return {
    market: f.market ?? 0.25,
    impact: f.impact ?? 0.25,
    scarcity: f.scarcity ?? 0.25,
    demand: f.demand ?? 0.25,
  }
}

function passesQualityGate(
  priorMetrics: QualityMetrics,
  learnedMetrics: QualityMetrics,
): boolean {
  const aucUp = learnedMetrics.auc - priorMetrics.auc >= QUALITY_AUC_IMPROVEMENT
  const brierDown = priorMetrics.brier - learnedMetrics.brier >= QUALITY_BRIER_IMPROVEMENT
  const eceDown = priorMetrics.eceMid - learnedMetrics.eceMid >= QUALITY_ECE_IMPROVEMENT
  return aucUp || brierDown || eceDown
}

export async function runWeeklyLearningForSegment(
  segmentKey: string,
  forceDate?: Date,
): Promise<WeeklyLearningResult> {
  const now = forceDate ?? new Date()
  const weekStart = getMonday(now)
  const version = makeVersion(weekStart, segmentKey)

  const prior = getBaselineWeights(segmentKey)
  const prevApplied = await getPreviousWeights(segmentKey)
  const effectivePrior = prevApplied ?? prior

  const windowEnd = now
  const windowStart = new Date(windowEnd.getTime() - 28 * 24 * 60 * 60 * 1000)

  const allSamples = await fetchSamples(segmentKey, windowStart, windowEnd)

  if (allSamples.length < MIN_SAMPLES) {
    const result: WeeklyLearningResult = {
      segmentKey,
      weekStart,
      status: 'INSUFFICIENT_DATA',
      prior: effectivePrior,
      learned: null,
      final: effectivePrior,
      metrics: { nSamples: allSamples.length, aucDelta: 0, brierDelta: 0, eceDelta: 0, priorAuc: 0, learnedAuc: 0 },
      version,
    }
    await writeRecord(result)
    return result
  }

  const splitIdx = Math.floor(allSamples.length * 0.5)
  const trainSamples = allSamples.slice(0, splitIdx)
  const holdoutSamples = allSamples.slice(splitIdx)

  const lr = fitLogisticRegression(trainSamples, LAMBDA_L2)
  const rawLearned = betasToWeights(lr.betas)

  const alpha = getSeasonAlpha()
  let blended = blendWithPrior(effectivePrior, rawLearned, alpha)
  blended = clampMovement(blended, effectivePrior, MAX_WEEKLY_MOVEMENT)
  blended = normalizeWeights(blended)

  const priorBetas = [effectivePrior.market, effectivePrior.impact, effectivePrior.scarcity, effectivePrior.demand]
  const learnedBetas = [blended.market, blended.impact, blended.scarcity, blended.demand]

  const priorMetrics = computeMetrics(holdoutSamples, priorBetas, 0)
  const learnedMetrics = computeMetrics(holdoutSamples, learnedBetas, lr.intercept)

  const aucDelta = learnedMetrics.auc - priorMetrics.auc
  const brierDelta = priorMetrics.brier - learnedMetrics.brier
  const eceDelta = priorMetrics.eceMid - learnedMetrics.eceMid

  const passes = passesQualityGate(priorMetrics, learnedMetrics)

  const status: WeightStatus = passes ? 'APPLIED' : 'REJECTED'

  const result: WeeklyLearningResult = {
    segmentKey,
    weekStart,
    status,
    prior: effectivePrior,
    learned: rawLearned,
    final: passes ? blended : effectivePrior,
    metrics: {
      nSamples: allSamples.length,
      aucDelta: Math.round(aucDelta * 10000) / 10000,
      brierDelta: Math.round(brierDelta * 10000) / 10000,
      eceDelta: Math.round(eceDelta * 10000) / 10000,
      priorAuc: Math.round(priorMetrics.auc * 10000) / 10000,
      learnedAuc: Math.round(learnedMetrics.auc * 10000) / 10000,
    },
    version,
  }

  await writeRecord(result)

  if (passes) {
    await checkRollbackNeeded(segmentKey)
  }

  return result
}

async function writeRecord(result: WeeklyLearningResult): Promise<void> {
  await prisma.rankingWeightsWeekly.upsert({
    where: {
      segmentKey_weekStart: {
        segmentKey: result.segmentKey,
        weekStart: result.weekStart,
      },
    },
    create: {
      weekStart: result.weekStart,
      segmentKey: result.segmentKey,
      priorJson: result.prior as any,
      learnedJson: (result.learned ?? result.prior) as any,
      finalJson: result.final as any,
      metricsJson: result.metrics as any,
      status: result.status,
      version: result.version,
      nSamples: result.metrics.nSamples,
    },
    update: {
      priorJson: result.prior as any,
      learnedJson: (result.learned ?? result.prior) as any,
      finalJson: result.final as any,
      metricsJson: result.metrics as any,
      status: result.status,
      nSamples: result.metrics.nSamples,
    },
  })

  const oldRecords = await prisma.rankingWeightsWeekly.findMany({
    where: { segmentKey: result.segmentKey },
    orderBy: { weekStart: 'desc' },
    skip: ROLLBACK_HISTORY,
    select: { id: true },
  })
  if (oldRecords.length > 0) {
    await prisma.rankingWeightsWeekly.deleteMany({
      where: { id: { in: oldRecords.map(r => r.id) } },
    })
  }
}

async function checkRollbackNeeded(segmentKey: string): Promise<void> {
  const recent = await prisma.rankingWeightsWeekly.findMany({
    where: { segmentKey, status: 'APPLIED' },
    orderBy: { weekStart: 'desc' },
    take: 2,
  })

  if (recent.length < 2) return

  const current = recent[0]
  const previous = recent[1]
  const currentMetrics = current.metricsJson as any
  const previousMetrics = previous.metricsJson as any

  if (
    currentMetrics.eceDelta !== undefined &&
    previousMetrics.eceDelta !== undefined &&
    currentMetrics.eceDelta < -0.02
  ) {
    await prisma.rankingWeightsWeekly.update({
      where: { id: current.id },
      data: { status: 'ROLLED_BACK' },
    })
    console.log(`[WeeklyWeights] Rolled back ${segmentKey} week ${current.weekStart.toISOString()} due to ECE spike`)
  }
}

export async function getActiveWeightsForSegment(segmentKey: string): Promise<ComponentWeights> {
  const row = await prisma.rankingWeightsWeekly.findFirst({
    where: { segmentKey, status: 'APPLIED' },
    orderBy: { weekStart: 'desc' },
  })

  if (!row) return getBaselineWeights(segmentKey)
  const f = row.finalJson as Record<string, number>
  return {
    market: f.market ?? 0.25,
    impact: f.impact ?? 0.25,
    scarcity: f.scarcity ?? 0.25,
    demand: f.demand ?? 0.25,
  }
}

