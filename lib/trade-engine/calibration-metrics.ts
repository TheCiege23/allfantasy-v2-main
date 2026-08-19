import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { resolveCurrentTradeLearningSeason } from './season-resolver'

export interface CalibrationBucket {
  bucketMin: number
  bucketMax: number
  bucketLabel: string
  predicted: number
  observed: number
  count: number
}

export interface CalibrationHealthMetrics {
  reliabilityCurve: CalibrationBucket[]
  ece: number
  brierScore: number
  predictionDistribution: Array<{ bucket: string; count: number }>
  totalPaired: number
  alerts: Alert[]
  isotonic?: {
    active: boolean
    sampleSize: number
    points: number
    eceBefore: number
    eceAfter: number
    computedAt: string
  }
}

export interface SegmentMetrics {
  segment: string
  value: string
  ece: number
  brierScore: number
  count: number
}

export interface SegmentDriftMetrics {
  heatmap: SegmentMetrics[]
  worstSegments: SegmentMetrics[]
  alerts: Alert[]
}

export interface FeatureStat {
  feature: string
  currentMean: number
  currentStd: number
  previousMean: number
  previousStd: number
  psi: number
  zDrift: number
  drifted: boolean
}

export interface FeatureDriftMetrics {
  features: FeatureStat[]
  alerts: Alert[]
}

export interface RankingMetrics {
  auc: number | null
  topKHitRates: Array<{ k: number; hitRate: number; count: number }>
  liftChart: Array<{ decile: number; lift: number; baseRate: number; decileRate: number }>
  totalPaired: number
  alerts: Alert[]
}

export interface NarrativeMetrics {
  totalValidations: number
  failureRate: number
  incompleteDriverSetRate: number
  illegalNumberRate: number
  invalidDriverRate: number
  bannedPatternRate: number
  dailyFailureRates: Array<{ date: string; rate: number; count: number }>
  alerts: Alert[]
}

export interface Alert {
  severity: 'warning' | 'critical'
  message: string
  metric: string
  value: number
  threshold: number
}

export interface DashboardMetrics {
  calibration: CalibrationHealthMetrics
  segmentDrift: SegmentDriftMetrics
  featureDrift: FeatureDriftMetrics
  ranking: RankingMetrics
  narrative: NarrativeMetrics
  dateRange: { from: string; to: string }
  generatedAt: string
}

type PairedRecord = {
  acceptProb: number
  accepted: boolean
  features: any
  isSuperFlex: boolean | null
  leagueFormat: string | null
  scoringType: string | null
  mode: string
  createdAt: Date
}

async function loadPairedData(daysBack: number): Promise<PairedRecord[]> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)

  const outcomes = await prisma.tradeOutcomeEvent.findMany({
    where: {
      createdAt: { gte: cutoff },
      offerEventId: { not: null },
      outcome: { in: ['ACCEPTED', 'REJECTED'] },
    },
    select: {
      offerEventId: true,
      outcome: true,
    },
  })

  if (outcomes.length === 0) return []

  const outcomeMap = new Map<string, boolean>()
  for (const o of outcomes) {
    if (o.offerEventId) {
      outcomeMap.set(o.offerEventId, o.outcome === 'ACCEPTED')
    }
  }

  const offerIds = Array.from(outcomeMap.keys())
  const offers = await prisma.tradeOfferEvent.findMany({
    where: {
      id: { in: offerIds },
    },
    select: {
      id: true,
      acceptProb: true,
      featuresJson: true,
      isSuperFlex: true,
      leagueFormat: true,
      scoringType: true,
      mode: true,
      createdAt: true,
    },
  })

  return offers
    .filter((o: any) => o.acceptProb != null)
    .map((o: any) => ({
      acceptProb: o.acceptProb!,
      accepted: outcomeMap.get(o.id) ?? false,
      features: o.featuresJson as any,
      isSuperFlex: o.isSuperFlex,
      leagueFormat: o.leagueFormat,
      scoringType: o.scoringType,
      mode: o.mode,
      createdAt: o.createdAt,
    }))
}

function bucketIndex(p: number, B = 10): number {
  if (p >= 1) return B - 1
  if (p <= 0) return 0
  return Math.floor(p * B)
}

function computeReliabilityCurve(data: PairedRecord[]): CalibrationBucket[] {
  const B = 10
  const bins = Array.from({ length: B }, () => ({ n: 0, sumP: 0, sumY: 0 }))

  for (const d of data) {
    const b = bucketIndex(d.acceptProb, B)
    bins[b].n += 1
    bins[b].sumP += d.acceptProb
    bins[b].sumY += d.accepted ? 1 : 0
  }

  return bins.map((b, i) => ({
    bucketMin: i * 0.1,
    bucketMax: (i + 1) * 0.1,
    bucketLabel: `${Math.round(i * 10)}–${Math.round((i + 1) * 10)}%`,
    predicted: b.n > 0 ? b.sumP / b.n : (i * 0.1 + (i + 1) * 0.1) / 2,
    observed: b.n > 0 ? b.sumY / b.n : 0,
    count: b.n,
  }))
}

function computeECE(data: PairedRecord[]): number {
  if (data.length === 0) return 0
  const curve = computeReliabilityCurve(data)
  let ece = 0
  for (const b of curve) {
    ece += (b.count / data.length) * Math.abs(b.observed - b.predicted)
  }
  return Math.round(ece * 10000) / 10000
}

function computeBrierScore(data: PairedRecord[]): number {
  const N = data.length
  if (N === 0) return 0
  let sum = 0
  for (const d of data) {
    const diff = d.acceptProb - (d.accepted ? 1 : 0)
    sum += diff * diff
  }
  return sum / N
}

function computePredictionDistribution(data: PairedRecord[]): Array<{ bucket: string; count: number }> {
  const dist: Array<{ bucket: string; count: number }> = []
  for (let i = 0; i < 10; i++) {
    const min = i * 0.1
    const max = (i + 1) * 0.1
    const count = data.filter((d) => d.acceptProb >= min && (i === 9 ? d.acceptProb <= max : d.acceptProb < max)).length
    dist.push({ bucket: `${Math.round(min * 100)}–${Math.round(max * 100)}%`, count })
  }
  return dist
}

function computePredictionDistributionFromOffers(offers: Array<{ acceptProb: number | null }>): Array<{ bucket: string; count: number }> {
  const valid = offers.filter((o) => o.acceptProb != null).map((o) => o.acceptProb!)
  const dist: Array<{ bucket: string; count: number }> = []
  for (let i = 0; i < 10; i++) {
    const min = i * 0.1
    const max = (i + 1) * 0.1
    const count = valid.filter((p) => p >= min && (i === 9 ? p <= max : p < max)).length
    dist.push({ bucket: `${Math.round(min * 100)}–${Math.round(max * 100)}%`, count })
  }
  return dist
}

export async function computeCalibrationHealth(daysBack: number, season?: number): Promise<CalibrationHealthMetrics> {
  const paired = await loadPairedData(daysBack)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)
  const allOffers = await prisma.tradeOfferEvent.findMany({
    where: { createdAt: { gte: cutoff } },
    select: { acceptProb: true },
  })

  const reliabilityCurve = computeReliabilityCurve(paired)
  const ece = computeECE(paired)
  const brierScore = computeBrierScore(paired)
  const predictionDistribution = computePredictionDistributionFromOffers(allOffers)

  const alerts: Alert[] = []
  if (ece > 0.12) {
    alerts.push({ severity: 'critical', message: 'ECE exceeds critical threshold', metric: 'ece', value: ece, threshold: 0.12 })
  } else if (ece > 0.08) {
    alerts.push({ severity: 'warning', message: 'ECE exceeds warning threshold', metric: 'ece', value: ece, threshold: 0.08 })
  }

  const highBucket = predictionDistribution.find((b) => b.bucket === '90–100%')
  const lowBucket = predictionDistribution.find((b) => b.bucket === '0–10%')
  const total = predictionDistribution.reduce((s, b) => s + b.count, 0)
  if (total > 0) {
    const highPct = (highBucket?.count ?? 0) / total
    const lowPct = (lowBucket?.count ?? 0) / total
    if (highPct > 0.3) {
      alerts.push({ severity: 'warning', message: 'Over 30% of predictions in 90-100% bucket — possible overconfidence', metric: 'highBucketPct', value: highPct, threshold: 0.3 })
    }
    if (lowPct > 0.3) {
      alerts.push({ severity: 'warning', message: 'Over 30% of predictions in 0-10% bucket — possible underconfidence', metric: 'lowBucketPct', value: lowPct, threshold: 0.3 })
    }
  }

  let isotonicStatus: CalibrationHealthMetrics['isotonic'] = undefined
  try {
    const resolvedSeason = season ?? await resolveCurrentTradeLearningSeason()
    const stats = await prisma.tradeLearningStats.findUnique({
      where: { season: resolvedSeason },
      select: { isotonicMapJson: true, isotonicComputedAt: true, isotonicSampleSize: true },
    })
    const rawStats = stats as Record<string, unknown> | null
    const isoMap = rawStats?.isotonicMapJson as { points?: Array<unknown>; ece?: number; eceCalibratedEstimate?: number } | null
    if (isoMap && isoMap.points) {
      isotonicStatus = {
        active: true,
        sampleSize: (rawStats?.isotonicSampleSize as number) ?? 0,
        points: isoMap.points.length,
        eceBefore: isoMap.ece ?? 0,
        eceAfter: isoMap.eceCalibratedEstimate ?? 0,
        computedAt: (rawStats?.isotonicComputedAt as Date)?.toISOString() ?? '',
      }
    }
  } catch {}

  return { reliabilityCurve, ece, brierScore, predictionDistribution, totalPaired: paired.length, alerts, isotonic: isotonicStatus }
}

export async function computeSegmentDrift(daysBack: number): Promise<SegmentDriftMetrics> {
  const paired = await loadPairedData(daysBack)
  const segments: Array<{ key: string; fn: (d: PairedRecord) => string }> = [
    { key: 'format', fn: (d) => d.isSuperFlex ? 'SuperFlex' : '1QB' },
    { key: 'leagueFormat', fn: (d) => d.leagueFormat || 'unknown' },
    { key: 'scoringType', fn: (d) => d.scoringType || 'unknown' },
    { key: 'mode', fn: (d) => d.mode },
  ]

  const heatmap: SegmentMetrics[] = []
  const alerts: Alert[] = []

  for (const seg of segments) {
    const groups = new Map<string, PairedRecord[]>()
    for (const d of paired) {
      const val = seg.fn(d)
      if (!groups.has(val)) groups.set(val, [])
      groups.get(val)!.push(d)
    }
    for (const [val, records] of groups) {
      const ece = computeECE(records)
      const brierScore = computeBrierScore(records)
      heatmap.push({ segment: seg.key, value: val, ece, brierScore, count: records.length })
      if (ece > 0.15 && records.length >= 200) {
        alerts.push({
          severity: 'critical',
          message: `Segment ${seg.key}=${val} has ECE ${ece.toFixed(3)} with ${records.length} samples`,
          metric: `segment_ece_${seg.key}_${val}`,
          value: ece,
          threshold: 0.15,
        })
      }
    }
  }

  const worstSegments = [...heatmap].sort((a, b) => b.ece - a.ece).slice(0, 10)

  return { heatmap, worstSegments, alerts }
}

function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1))
}

const PSI_DEFAULT_EDGES = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]

function psiBinCount(value: number, edges: number[]): number {
  const v = Math.max(edges[0], Math.min(edges[edges.length - 1], value))
  for (let i = 0; i < edges.length - 1; i++) {
    const left = edges[i]
    const right = edges[i + 1]
    const isLast = i === edges.length - 2
    if ((v >= left && v < right) || (isLast && v === right)) return i
  }
  return edges.length - 2
}

function computePSI(current: number[], previous: number[], edges: number[] = PSI_DEFAULT_EDGES): number {
  if (current.length === 0 || previous.length === 0) return 0

  const m = edges.length - 1
  const aCounts = Array(m).fill(0)
  const eCounts = Array(m).fill(0)

  for (const v of current) aCounts[psiBinCount(v, edges)]++
  for (const v of previous) eCounts[psiBinCount(v, edges)]++

  const aN = current.length || 1
  const eN = previous.length || 1

  let psi = 0
  for (let i = 0; i < m; i++) {
    const a = Math.max(aCounts[i] / aN, 1e-6)
    const e = Math.max(eCounts[i] / eN, 1e-6)
    psi += (a - e) * Math.log(a / e)
  }
  return psi
}

export async function computeFeatureDrift(daysBack: number): Promise<FeatureDriftMetrics> {
  const halfWay = Math.floor(daysBack / 2)
  const now = new Date()
  const cutoffRecent = new Date(now)
  cutoffRecent.setDate(cutoffRecent.getDate() - halfWay)
  const cutoffOlder = new Date(now)
  cutoffOlder.setDate(cutoffOlder.getDate() - daysBack)

  const [recentOffers, olderOffers] = await Promise.all([
    prisma.tradeOfferEvent.findMany({
      where: { createdAt: { gte: cutoffRecent }, featuresJson: { not: Prisma.DbNull } },
      select: { featuresJson: true },
    }),
    prisma.tradeOfferEvent.findMany({
      where: { createdAt: { gte: cutoffOlder, lt: cutoffRecent }, featuresJson: { not: Prisma.DbNull } },
      select: { featuresJson: true },
    }),
  ])

  const featureNames = ['lineupImpact', 'vorp', 'market', 'behavior']
  const extractFeature = (offers: any[], name: string): number[] => {
    return offers
      .map((o) => {
        const f = (o as any).featuresJson as any
        return f?.[name]
      })
      .filter((v): v is number => typeof v === 'number')
  }

  const features: FeatureStat[] = []
  const alerts: Alert[] = []

  for (const name of featureNames) {
    const current = extractFeature(recentOffers, name)
    const previous = extractFeature(olderOffers, name)
    const currentMean = mean(current)
    const currentStd = stdDev(current)
    const previousMean = mean(previous)
    const previousStd = stdDev(previous)
    const psi = computePSI(current, previous)
    const pooledStd = Math.sqrt((currentStd ** 2 + previousStd ** 2) / 2) || 1
    const zDrift = Math.abs(currentMean - previousMean) / pooledStd
    const drifted = psi > 0.25 || zDrift > 3

    features.push({ feature: name, currentMean, currentStd, previousMean, previousStd, psi, zDrift, drifted })

    if (drifted) {
      alerts.push({
        severity: psi > 0.5 || zDrift > 5 ? 'critical' : 'warning',
        message: `Feature ${name} shows drift: PSI=${psi.toFixed(3)}, z=${zDrift.toFixed(2)}`,
        metric: `feature_drift_${name}`,
        value: psi,
        threshold: 0.25,
      })
    }
  }

  return { features, alerts }
}

export async function computeRankingQuality(daysBack: number): Promise<RankingMetrics> {
  const paired = await loadPairedData(daysBack)
  const alerts: Alert[] = []

  const auc = computeAUC(paired)
  const topKHitRates = computeTopKHitRates(paired)
  const liftChart = computeLiftChart(paired)

  if (auc !== null && auc < 0.62 && paired.length >= 50) {
    alerts.push({ severity: 'critical', message: `AUC dropped to ${auc.toFixed(3)}`, metric: 'auc', value: auc, threshold: 0.62 })
  }

  return { auc, topKHitRates, liftChart, totalPaired: paired.length, alerts }
}

function computeAUC(data: PairedRecord[]): number | null {
  const pos = data.filter(d => d.accepted).map(d => d.acceptProb).sort((a, b) => a - b)
  const neg = data.filter(d => !d.accepted).map(d => d.acceptProb).sort((a, b) => a - b)
  const nPos = pos.length
  const nNeg = neg.length
  if (nPos < 30 || nNeg < 30) return null

  let j = 0
  let wins = 0
  let ties = 0

  for (const p of pos) {
    while (j < nNeg && neg[j] < p) j++
    wins += j
    let k = j
    while (k < nNeg && neg[k] === p) k++
    ties += (k - j)
  }

  const denom = nPos * nNeg
  return (wins + 0.5 * ties) / denom
}

function computeTopKHitRates(data: PairedRecord[]): Array<{ k: number; hitRate: number; count: number }> {
  if (data.length === 0) return []
  const sorted = [...data].sort((a, b) => b.acceptProb - a.acceptProb)
  const ks = [5, 10, 20]
  return ks.map((kPct) => {
    const n = Math.max(1, Math.floor(data.length * kPct / 100))
    const topK = sorted.slice(0, n)
    const hits = topK.filter((d) => d.accepted).length
    return { k: kPct, hitRate: Math.round((hits / topK.length) * 10000) / 10000, count: topK.length }
  })
}

function computeLiftChart(data: PairedRecord[]): Array<{ decile: number; lift: number; baseRate: number; decileRate: number }> {
  if (data.length < 10) return []
  const sorted = [...data].sort((a, b) => b.acceptProb - a.acceptProb)
  const baseRate = data.filter((d) => d.accepted).length / data.length
  const chart: Array<{ decile: number; lift: number; baseRate: number; decileRate: number }> = []

  for (let i = 0; i < 10; i++) {
    const start = Math.floor((i * data.length) / 10)
    const end = Math.floor(((i + 1) * data.length) / 10)
    const slice = sorted.slice(start, end)
    const decileRate = slice.length > 0 ? slice.filter((d) => d.accepted).length / slice.length : 0
    const lift = baseRate > 0 ? decileRate / baseRate : 0
    chart.push({ decile: i + 1, lift: Math.round(lift * 100) / 100, baseRate: Math.round(baseRate * 10000) / 10000, decileRate: Math.round(decileRate * 10000) / 10000 })
  }

  return chart
}

export async function computeNarrativeIntegrity(daysBack: number): Promise<NarrativeMetrics> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)

  const logs = await prisma.narrativeValidationLog.findMany({
    where: { createdAt: { gte: cutoff } },
    select: { valid: true, violations: true, createdAt: true },
  })

  const totalValidations = logs.length
  const failures = logs.filter((l) => !l.valid)
  const failureRate = totalValidations > 0 ? failures.length / totalValidations : 0

  const violationArrays = failures.map((l: { violations: unknown }) => l.violations as string[])
  const allViolations = violationArrays.flat()

  const incompleteCount = allViolations.filter((v: string) => v === 'INCOMPLETE_DRIVER_SET').length
  const illegalNumberCount = allViolations.filter((v: string) => v.includes('illegal_number')).length
  const invalidDriverCount = allViolations.filter((v: string) => v.includes('invalid_driver')).length
  const bannedPatternCount = allViolations.filter((v: string) => v.includes('banned_pattern')).length

  const incompleteDriverSetRate = totalValidations > 0 ? incompleteCount / totalValidations : 0
  const illegalNumberRate = totalValidations > 0 ? illegalNumberCount / totalValidations : 0
  const invalidDriverRate = totalValidations > 0 ? invalidDriverCount / totalValidations : 0
  const bannedPatternRate = totalValidations > 0 ? bannedPatternCount / totalValidations : 0

  const dailyMap = new Map<string, { total: number; failed: number }>()
  for (const l of logs) {
    const day = l.createdAt.toISOString().split('T')[0]
    if (!dailyMap.has(day)) dailyMap.set(day, { total: 0, failed: 0 })
    const entry = dailyMap.get(day)!
    entry.total++
    if (!l.valid) entry.failed++
  }
  const dailyFailureRates = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { total, failed }]) => ({
      date,
      rate: Math.round((failed / total) * 10000) / 10000,
      count: total,
    }))

  const alerts: Alert[] = []
  if (failureRate > 0.03) {
    alerts.push({ severity: 'critical', message: `Narrative failure rate ${(failureRate * 100).toFixed(1)}% exceeds 3% — consider falling back to templates`, metric: 'failureRate', value: failureRate, threshold: 0.03 })
  } else if (failureRate > 0.01) {
    alerts.push({ severity: 'warning', message: `Narrative failure rate ${(failureRate * 100).toFixed(1)}% exceeds 1%`, metric: 'failureRate', value: failureRate, threshold: 0.01 })
  }

  return {
    totalValidations,
    failureRate: Math.round(failureRate * 10000) / 10000,
    incompleteDriverSetRate: Math.round(incompleteDriverSetRate * 10000) / 10000,
    illegalNumberRate: Math.round(illegalNumberRate * 10000) / 10000,
    invalidDriverRate: Math.round(invalidDriverRate * 10000) / 10000,
    bannedPatternRate: Math.round(bannedPatternRate * 10000) / 10000,
    dailyFailureRates,
    alerts,
  }
}

export async function computeFullDashboard(daysBack: number = 30): Promise<DashboardMetrics> {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - daysBack)

  const [calibration, segmentDrift, featureDrift, ranking, narrative] = await Promise.all([
    computeCalibrationHealth(daysBack),
    computeSegmentDrift(daysBack),
    computeFeatureDrift(daysBack),
    computeRankingQuality(daysBack),
    computeNarrativeIntegrity(daysBack),
  ])

  return {
    calibration,
    segmentDrift,
    featureDrift,
    ranking,
    narrative,
    dateRange: { from: from.toISOString().split('T')[0], to: now.toISOString().split('T')[0] },
    generatedAt: now.toISOString(),
  }
}

export interface DashboardFilters {
  mode?: string
  segment?: string
}

export interface SummaryCard {
  id: string
  label: string
  status: 'good' | 'watch' | 'critical'
  detail: string
}

export interface DrilldownOffer {
  id: string
  acceptProb: number
  accepted: boolean
  mode: string
  isSuperFlex: boolean | null
  leagueFormat: string | null
  scoringType: string | null
  drivers: Array<{ id: string; direction: string; strength: string; value: number }>
  createdAt: string
}

export interface DrilldownData {
  segmentKey: string
  segmentValue: string
  reliabilityCurve: CalibrationBucket[]
  ece: number
  featureDrift: FeatureStat[]
  sampleOffers: DrilldownOffer[]
  sampleSize: number
}

function filterPairedData(
  data: PairedRecord[],
  filters: DashboardFilters,
): PairedRecord[] {
  let filtered = data
  if (filters.mode) {
    filtered = filtered.filter(d => d.mode === filters.mode)
  }
  if (filters.segment) {
    const seg = filters.segment.toLowerCase()
    filtered = filtered.filter(d => {
      if (seg === 'sf') return d.isSuperFlex === true
      if (seg === '1qb') return d.isSuperFlex === false
      if (seg === 'dynasty') return d.leagueFormat?.toLowerCase() === 'dynasty'
      if (seg === 'redraft') return d.leagueFormat?.toLowerCase() === 'redraft'
      if (seg === 'tep') return d.scoringType?.toUpperCase() === 'TEP' || d.scoringType?.toUpperCase() === 'TE_PREMIUM'
      if (seg === 'ppr') return d.scoringType?.toUpperCase() === 'PPR'
      return true
    })
  }
  return filtered
}

function filterPairedDataByKeyValue(
  data: PairedRecord[],
  segmentKey: string,
  segmentValue: string,
): PairedRecord[] {
  const key = segmentKey.toLowerCase()
  if (key === 'format') {
    return data.filter(d => segmentValue === 'SuperFlex' ? d.isSuperFlex === true : d.isSuperFlex === false)
  }
  if (key === 'leagueformat') {
    return data.filter(d => d.leagueFormat?.toLowerCase() === segmentValue.toLowerCase())
  }
  if (key === 'scoringtype') {
    return data.filter(d => d.scoringType?.toLowerCase() === segmentValue.toLowerCase())
  }
  if (key === 'mode') {
    return data.filter(d => d.mode === segmentValue)
  }
  return data
}

function computeECEFromCurve(curve: CalibrationBucket[], totalCount: number): number {
  if (totalCount === 0) return 0
  let ece = 0
  for (const b of curve) {
    if (b.count > 0) {
      ece += (b.count / totalCount) * Math.abs(b.observed - b.predicted)
    }
  }
  return ece
}

export function computeSummaryCards(dashboard: DashboardMetrics): SummaryCard[] {
  const cards: SummaryCard[] = []

  const calStatus = dashboard.calibration.ece >= 0.12 ? 'critical'
    : dashboard.calibration.ece >= 0.08 ? 'watch' : 'good'
  cards.push({
    id: 'calibration',
    label: 'Calibration',
    status: calStatus,
    detail: `ECE: ${(dashboard.calibration.ece * 100).toFixed(1)}% | Brier: ${dashboard.calibration.brierScore.toFixed(3)}`,
  })

  const worst = dashboard.segmentDrift.worstSegments[0]
  const worstStatus = worst && worst.ece >= 0.15 ? 'critical'
    : worst && worst.ece >= 0.10 ? 'watch' : 'good'
  cards.push({
    id: 'worstSegment',
    label: 'Worst Segment',
    status: worstStatus,
    detail: worst ? `${worst.segment} ${worst.value}: ECE ${(worst.ece * 100).toFixed(1)}% (n=${worst.count})` : 'All segments healthy',
  })

  const hasDrift = dashboard.featureDrift.features.some(f => f.drifted)
  const driftedFeatures = dashboard.featureDrift.features.filter(f => f.drifted)
  cards.push({
    id: 'featureDrift',
    label: 'Feature Drift',
    status: hasDrift ? (driftedFeatures.some(f => f.psi > 0.5 || Math.abs(f.zDrift) > 5) ? 'critical' : 'watch') : 'good',
    detail: hasDrift ? `Unstable: ${driftedFeatures.map(f => f.feature).join(', ')}` : 'All features stable',
  })

  const narStatus = dashboard.narrative.failureRate >= 0.03 ? 'critical'
    : dashboard.narrative.failureRate >= 0.01 ? 'watch' : 'good'
  cards.push({
    id: 'narrative',
    label: 'Narrative Integrity',
    status: narStatus,
    detail: narStatus === 'good' ? 'OK' : `Failure rate: ${(dashboard.narrative.failureRate * 100).toFixed(1)}%`,
  })

  return cards
}

export async function computeDrilldown(
  daysBack: number,
  segmentKey: string,
  segmentValue: string,
): Promise<DrilldownData> {
  const allData = await loadPairedData(daysBack)
  const filtered = filterPairedDataByKeyValue(allData, segmentKey, segmentValue)

  const curve = computeReliabilityCurve(filtered)
  const ece = computeECEFromCurve(curve, filtered.length)

  const featureNames = ['lineupImpact', 'vorp', 'market', 'behavior'] as const
  const halfPoint = Math.floor(filtered.length / 2)
  const recent = filtered.slice(halfPoint)
  const older = filtered.slice(0, halfPoint)
  const featureDrift: FeatureStat[] = featureNames.map(feature => {
    const extract = (records: PairedRecord[]) =>
      records.map(r => {
        const f = r.features as Record<string, number> | null
        if (!f) return 0
        if (feature === 'lineupImpact') return f.lineupImpactScore ?? f.lineupImpact ?? 0
        if (feature === 'vorp') return f.vorpScore ?? f.vorp ?? 0
        if (feature === 'market') return f.marketScore ?? f.market ?? 0
        if (feature === 'behavior') return f.behaviorScore ?? f.behavior ?? 0
        return 0
      })

    const recentVals = extract(recent)
    const olderVals = extract(older)

    const mean = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
    const std = (arr: number[], m: number) => arr.length ? Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length) : 0

    const cMean = mean(recentVals)
    const cStd = std(recentVals, cMean)
    const pMean = mean(olderVals)
    const pStd = std(olderVals, pMean)

    const pooledStd = Math.sqrt((cStd ** 2 + pStd ** 2) / 2) || 1
    const zDrift = (cMean - pMean) / pooledStd
    const psi = computePSI(recentVals, olderVals)

    return {
      feature,
      currentMean: Math.round(cMean * 1000) / 1000,
      currentStd: Math.round(cStd * 1000) / 1000,
      previousMean: Math.round(pMean * 1000) / 1000,
      previousStd: Math.round(pStd * 1000) / 1000,
      psi,
      zDrift: Math.round(zDrift * 100) / 100,
      drifted: psi > 0.25 || Math.abs(zDrift) > 3,
    }
  })

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)

  const segFilter: Record<string, unknown> = {}
  const key = segmentKey.toLowerCase()
  const val = segmentValue
  if (key === 'format') {
    segFilter.isSuperFlex = val === 'SuperFlex'
  } else if (key === 'leagueformat') {
    segFilter.leagueFormat = val
  } else if (key === 'scoringtype') {
    segFilter.scoringType = val
  } else if (key === 'mode') {
    segFilter.mode = val
  }

  const sampleRaw = await prisma.tradeOfferEvent.findMany({
    where: {
      createdAt: { gte: cutoff },
      ...segFilter,
    },
    select: {
      id: true,
      acceptProb: true,
      mode: true,
      isSuperFlex: true,
      leagueFormat: true,
      scoringType: true,
      driversJson: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  const outcomeIds = sampleRaw.map(s => s.id)
  const outcomes = outcomeIds.length > 0
    ? await prisma.tradeOutcomeEvent.findMany({
        where: { offerEventId: { in: outcomeIds } },
        select: { offerEventId: true, outcome: true },
      })
    : []
  const outcomeMap = new Map(outcomes.map((o: any) => [o.offerEventId, o.outcome === 'ACCEPTED']))

  const sampleOffers: DrilldownOffer[] = sampleRaw.map((s: any) => ({
    id: s.id,
    acceptProb: s.acceptProb ?? 0,
    accepted: outcomeMap.get(s.id) ?? false,
    mode: s.mode,
    isSuperFlex: s.isSuperFlex,
    leagueFormat: s.leagueFormat,
    scoringType: s.scoringType,
    drivers: Array.isArray((s as any).driversJson) ? ((s as any).driversJson as any[]).slice(0, 5).map((d: any) => ({
      id: d.id ?? '',
      direction: d.direction ?? '',
      strength: d.strength ?? '',
      value: d.value ?? 0,
    })) : [],
    createdAt: s.createdAt.toISOString(),
  }))

  return {
    segmentKey,
    segmentValue,
    reliabilityCurve: curve,
    ece,
    featureDrift,
    sampleOffers,
    sampleSize: filtered.length,
  }
}

export async function computeFilteredDashboard(
  daysBack: number,
  filters: DashboardFilters,
): Promise<DashboardMetrics> {
  if (!filters.mode && !filters.segment) {
    return computeFullDashboard(daysBack)
  }

  const allData = await loadPairedData(daysBack)
  const filtered = filterPairedData(allData, filters)

  const calibration = computeCalibrationFromData(filtered)
  const [segmentDrift, featureDrift, ranking, narrative] = await Promise.all([
    computeSegmentDrift(daysBack),
    computeFeatureDrift(daysBack),
    computeRankingQuality(daysBack),
    computeNarrativeIntegrity(daysBack),
  ])

  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - daysBack)

  return {
    calibration,
    segmentDrift,
    featureDrift,
    ranking,
    narrative,
    dateRange: { from: from.toISOString().split('T')[0], to: now.toISOString().split('T')[0] },
    generatedAt: now.toISOString(),
  }
}

function computeCalibrationFromData(data: PairedRecord[]): CalibrationHealthMetrics {
  const reliabilityCurve = computeReliabilityCurve(data)
  const ece = computeECEFromCurve(reliabilityCurve, data.length)
  const brierScore = data.length > 0
    ? data.reduce((s, d) => s + (d.acceptProb - (d.accepted ? 1 : 0)) ** 2, 0) / data.length
    : 0

  const distribution: Array<{ bucket: string; count: number }> = []
  for (let i = 0; i < 10; i++) {
    const min = i * 0.1
    const max = (i + 1) * 0.1
    const count = data.filter(d => d.acceptProb >= min && (i === 9 ? d.acceptProb <= max : d.acceptProb < max)).length
    distribution.push({ bucket: `${Math.round(min * 100)}–${Math.round(max * 100)}%`, count })
  }

  const alerts: Alert[] = []
  if (data.length >= 50) {
    if (ece >= 0.12) {
      alerts.push({ severity: 'critical', message: 'ECE exceeds critical threshold', metric: 'ece', value: ece, threshold: 0.12 })
    } else if (ece >= 0.08) {
      alerts.push({ severity: 'warning', message: 'ECE exceeds warning threshold', metric: 'ece', value: ece, threshold: 0.08 })
    }
  }

  return {
    reliabilityCurve,
    ece: Math.round(ece * 10000) / 10000,
    brierScore: Math.round(brierScore * 10000) / 10000,
    predictionDistribution: distribution,
    totalPaired: data.length,
    alerts,
  }
}

