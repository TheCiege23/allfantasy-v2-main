import { prisma } from '../prisma'
import { Prisma } from '@prisma/client'
import { fetchFantasyCalcValues, FantasyCalcPlayer } from '../fantasycalc'
import { resolveCurrentTradeLearningSeason } from './season-resolver'

export type DriftSeverity = 'ok' | 'info' | 'warn' | 'critical'

export interface DriftAlert {
  type: 'calibration' | 'rank_order' | 'segment' | 'input'
  severity: DriftSeverity
  metric: string
  value: number
  threshold: number
  message: string
  sampleSize: number
  timestamp: string
}

export interface CalibrationDriftMetrics {
  avgPredicted: number
  observedRate: number
  absoluteGap: number
  brierProxy: number
  sampleSize: number
  severity: DriftSeverity
}

export interface RankOrderDriftMetrics {
  spearmanRho: number
  feedbackConcordance: number | null
  sampleSize: number
  feedbackSampleSize: number
  severity: DriftSeverity
}

export interface SegmentKey {
  isSuperFlex: boolean | null
  leagueFormat: string | null
  scoringType: string | null
}

export interface SegmentDriftMetrics {
  segmentLabel: string
  avgPredicted: number
  absoluteGap: number
  sampleSize: number
  severity: DriftSeverity
}

export interface InputDriftSnapshot {
  settings: string
  totalPlayers: number
  meanValue: number
  medianValue: number
  stdDev: number
  p10: number
  p90: number
  top10Avg: number
  positionMix: Record<string, number>
}

export interface InputDriftMetrics {
  snapshots: InputDriftSnapshot[]
  shifts: InputDriftShift[]
  severity: DriftSeverity
}

export interface InputDriftShift {
  settings: string
  metric: string
  previousValue: number
  currentValue: number
  pctChange: number
  severity: DriftSeverity
}

export interface DriftReport {
  timestamp: string
  season: number
  overallSeverity: DriftSeverity
  calibration: CalibrationDriftMetrics
  rankOrder: RankOrderDriftMetrics
  segments: SegmentDriftMetrics[]
  input: InputDriftMetrics
  alerts: DriftAlert[]
  history: DriftReportSummary[]
}

export interface DriftReportSummary {
  timestamp: string
  overallSeverity: DriftSeverity
  alertCount: number
  calibrationGap: number
  rankRho: number
}

const OBSERVED_ACCEPT_RATE = 0.85

const CALIBRATION_THRESHOLDS = {
  warn: { gap: 0.15, minSample: 50 },
  critical: { gap: 0.25, minSample: 100 },
}

const RANK_THRESHOLDS = {
  warn: { rho: 0.50, minSample: 50 },
  critical: { rho: 0.30, minSample: 100 },
}

const SEGMENT_THRESHOLDS = {
  warn: { gap: 0.20, minSample: 25 },
  critical: { gap: 0.35, minSample: 50 },
}

const INPUT_THRESHOLDS = {
  warn: { pctChange: 15 },
  critical: { pctChange: 25 },
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

function computeSpearmanRho(x: number[], y: number[]): number {
  const n = x.length
  if (n < 3) return 0

  function rankWithTies(arr: number[]): number[] {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
    const ranks = new Array(n).fill(0)
    let i = 0
    while (i < n) {
      let j = i
      while (j < n - 1 && sorted[j + 1].v === sorted[j].v) j++
      const avgRank = (i + 1 + j + 1) / 2
      for (let k = i; k <= j; k++) {
        ranks[sorted[k].i] = avgRank
      }
      i = j + 1
    }
    return ranks
  }

  const rx = rankWithTies(x)
  const ry = rankWithTies(y)

  const meanRx = rx.reduce((s, v) => s + v, 0) / n
  const meanRy = ry.reduce((s, v) => s + v, 0) / n

  let num = 0, denX = 0, denY = 0
  for (let i = 0; i < n; i++) {
    const dx = rx[i] - meanRx
    const dy = ry[i] - meanRy
    num += dx * dy
    denX += dx * dx
    denY += dy * dy
  }

  const den = Math.sqrt(denX * denY)
  if (den === 0) return 0

  return num / den
}

function computeDistributionStats(values: number[]): {
  mean: number
  median: number
  stdDev: number
  p10: number
  p90: number
  top10Avg: number
} {
  if (values.length === 0) {
    return { mean: 0, median: 0, stdDev: 0, p10: 0, p90: 0, top10Avg: 0 }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const mean = sorted.reduce((s, v) => s + v, 0) / n
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)]

  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n
  const stdDev = Math.sqrt(variance)

  const p10 = sorted[Math.floor(n * 0.1)] ?? sorted[0]
  const p90 = sorted[Math.floor(n * 0.9)] ?? sorted[n - 1]

  const top10 = sorted.slice(-Math.max(1, Math.floor(n * 0.02)))
  const top10Avg = top10.reduce((s, v) => s + v, 0) / top10.length

  return { mean, median, stdDev, p10, p90, top10Avg }
}

function severityMax(...levels: DriftSeverity[]): DriftSeverity {
  const order: DriftSeverity[] = ['ok', 'info', 'warn', 'critical']
  let max = 0
  for (const l of levels) {
    const idx = order.indexOf(l)
    if (idx > max) max = idx
  }
  return order[max]
}

async function computeCalibrationDrift(
  trades: Array<{ valueGiven: number | null; valueReceived: number | null }>,
  currentB0: number,
): Promise<{ metrics: CalibrationDriftMetrics; alerts: DriftAlert[] }> {
  const alerts: DriftAlert[] = []

  let sumPred = 0
  let sumBrier = 0
  let validCount = 0

  for (const t of trades) {
    if (t.valueGiven == null || t.valueReceived == null) continue
    const pred = reconstructAcceptProbSimple(t.valueGiven, t.valueReceived, currentB0)
    sumPred += pred
    sumBrier += (pred - OBSERVED_ACCEPT_RATE) ** 2
    validCount++
  }

  if (validCount === 0) {
    return {
      metrics: {
        avgPredicted: 0,
        observedRate: OBSERVED_ACCEPT_RATE,
        absoluteGap: 0,
        brierProxy: 0,
        sampleSize: 0,
        severity: 'ok',
      },
      alerts: [],
    }
  }

  const avgPredicted = sumPred / validCount
  const absoluteGap = Math.abs(avgPredicted - OBSERVED_ACCEPT_RATE)
  const brierProxy = sumBrier / validCount

  let severity: DriftSeverity = 'ok'

  if (absoluteGap >= CALIBRATION_THRESHOLDS.critical.gap && validCount >= CALIBRATION_THRESHOLDS.critical.minSample) {
    severity = 'critical'
    alerts.push({
      type: 'calibration',
      severity: 'critical',
      metric: 'absoluteGap',
      value: absoluteGap,
      threshold: CALIBRATION_THRESHOLDS.critical.gap,
      message: `Calibration critically drifted: avg predicted ${(avgPredicted * 100).toFixed(1)}% vs observed ${(OBSERVED_ACCEPT_RATE * 100).toFixed(1)}% (gap ${(absoluteGap * 100).toFixed(1)}pp)`,
      sampleSize: validCount,
      timestamp: new Date().toISOString(),
    })
  } else if (absoluteGap >= CALIBRATION_THRESHOLDS.warn.gap && validCount >= CALIBRATION_THRESHOLDS.warn.minSample) {
    severity = 'warn'
    alerts.push({
      type: 'calibration',
      severity: 'warn',
      metric: 'absoluteGap',
      value: absoluteGap,
      threshold: CALIBRATION_THRESHOLDS.warn.gap,
      message: `Calibration drifting: avg predicted ${(avgPredicted * 100).toFixed(1)}% vs observed ${(OBSERVED_ACCEPT_RATE * 100).toFixed(1)}% (gap ${(absoluteGap * 100).toFixed(1)}pp)`,
      sampleSize: validCount,
      timestamp: new Date().toISOString(),
    })
  } else if (absoluteGap >= 0.08 && validCount >= 30) {
    severity = 'info'
  }

  return {
    metrics: {
      avgPredicted: Math.round(avgPredicted * 1000) / 1000,
      observedRate: OBSERVED_ACCEPT_RATE,
      absoluteGap: Math.round(absoluteGap * 1000) / 1000,
      brierProxy: Math.round(brierProxy * 10000) / 10000,
      sampleSize: validCount,
      severity,
    },
    alerts,
  }
}

async function computeRankOrderDrift(
  trades: Array<{ valueGiven: number | null; valueReceived: number | null; valueDifferential: number | null }>,
  currentB0: number,
  feedback: Array<{ rating: number; aiGrade: string | null }>,
): Promise<{ metrics: RankOrderDriftMetrics; alerts: DriftAlert[] }> {
  const alerts: DriftAlert[] = []

  const acceptProbs: number[] = []
  const marketDeltas: number[] = []

  for (const t of trades) {
    if (t.valueGiven == null || t.valueReceived == null) continue
    const pred = reconstructAcceptProbSimple(t.valueGiven, t.valueReceived, currentB0)
    const totalValue = Math.max(t.valueGiven + t.valueReceived, 1)
    const marketDelta = ((t.valueReceived - t.valueGiven) / totalValue) * 100
    acceptProbs.push(pred)
    marketDeltas.push(marketDelta)
  }

  const n = acceptProbs.length
  let spearmanRho = 0
  if (n >= 10) {
    spearmanRho = computeSpearmanRho(acceptProbs, marketDeltas)
  }

  let feedbackConcordance: number | null = null
  if (feedback.length >= 10) {
    let concordant = 0
    let discordant = 0
    for (const fb of feedback) {
      const grade = fb.aiGrade?.toLowerCase() ?? ''
      const isHighGrade = grade.includes('accept') || grade.includes('likely') || grade.includes('strong') || grade.includes('fair')
      const isLowGrade = grade.includes('reject') || grade.includes('unlikely') || grade.includes('overpay')
      if (isHighGrade && fb.rating >= 4) concordant++
      else if (isLowGrade && fb.rating <= 2) concordant++
      else if (isHighGrade && fb.rating <= 2) discordant++
      else if (isLowGrade && fb.rating >= 4) discordant++
    }
    const total = concordant + discordant
    feedbackConcordance = total > 0 ? concordant / total : null
  }

  let severity: DriftSeverity = 'ok'

  if (n >= RANK_THRESHOLDS.critical.minSample && spearmanRho < RANK_THRESHOLDS.critical.rho) {
    severity = 'critical'
    alerts.push({
      type: 'rank_order',
      severity: 'critical',
      metric: 'spearmanRho',
      value: spearmanRho,
      threshold: RANK_THRESHOLDS.critical.rho,
      message: `Rank ordering critically broken: Spearman ρ=${spearmanRho.toFixed(3)} (deals ranked inconsistently with market deltas)`,
      sampleSize: n,
      timestamp: new Date().toISOString(),
    })
  } else if (n >= RANK_THRESHOLDS.warn.minSample && spearmanRho < RANK_THRESHOLDS.warn.rho) {
    severity = 'warn'
    alerts.push({
      type: 'rank_order',
      severity: 'warn',
      metric: 'spearmanRho',
      value: spearmanRho,
      threshold: RANK_THRESHOLDS.warn.rho,
      message: `Rank ordering degrading: Spearman ρ=${spearmanRho.toFixed(3)} (relative deal ordering weakening)`,
      sampleSize: n,
      timestamp: new Date().toISOString(),
    })
  }

  if (feedbackConcordance !== null && feedbackConcordance < 0.40 && feedback.length >= 20) {
    severity = severityMax(severity, 'warn')
    alerts.push({
      type: 'rank_order',
      severity: 'warn',
      metric: 'feedbackConcordance',
      value: feedbackConcordance,
      threshold: 0.40,
      message: `User feedback disagrees with AI grades: concordance=${(feedbackConcordance * 100).toFixed(1)}%`,
      sampleSize: feedback.length,
      timestamp: new Date().toISOString(),
    })
  }

  return {
    metrics: {
      spearmanRho: Math.round(spearmanRho * 1000) / 1000,
      feedbackConcordance: feedbackConcordance !== null ? Math.round(feedbackConcordance * 1000) / 1000 : null,
      sampleSize: n,
      feedbackSampleSize: feedback.length,
      severity,
    },
    alerts,
  }
}

function computeSegmentDrift(
  trades: Array<{
    valueGiven: number | null
    valueReceived: number | null
    isSuperFlex: boolean | null
    leagueFormat: string | null
    scoringType: string | null
  }>,
  currentB0: number,
): { segments: SegmentDriftMetrics[]; alerts: DriftAlert[] } {
  const alerts: DriftAlert[] = []

  interface SegmentBucket {
    label: string
    preds: number[]
  }

  const buckets = new Map<string, SegmentBucket>()

  function addToBucket(label: string, pred: number) {
    let bucket = buckets.get(label)
    if (!bucket) {
      bucket = { label, preds: [] }
      buckets.set(label, bucket)
    }
    bucket.preds.push(pred)
  }

  for (const t of trades) {
    if (t.valueGiven == null || t.valueReceived == null) continue
    const pred = reconstructAcceptProbSimple(t.valueGiven, t.valueReceived, currentB0)

    if (t.isSuperFlex === true) addToBucket('SuperFlex', pred)
    else if (t.isSuperFlex === false) addToBucket('1QB', pred)

    if (t.leagueFormat) {
      addToBucket(t.leagueFormat.charAt(0).toUpperCase() + t.leagueFormat.slice(1), pred)
    }

    if (t.scoringType) {
      addToBucket(t.scoringType.toUpperCase(), pred)
    }
  }

  const segments: SegmentDriftMetrics[] = []

  for (const [, bucket] of buckets) {
    if (bucket.preds.length < 10) continue

    const avg = bucket.preds.reduce((s, v) => s + v, 0) / bucket.preds.length
    const gap = Math.abs(avg - OBSERVED_ACCEPT_RATE)

    let severity: DriftSeverity = 'ok'

    if (gap >= SEGMENT_THRESHOLDS.critical.gap && bucket.preds.length >= SEGMENT_THRESHOLDS.critical.minSample) {
      severity = 'critical'
      alerts.push({
        type: 'segment',
        severity: 'critical',
        metric: `segment_${bucket.label}_gap`,
        value: gap,
        threshold: SEGMENT_THRESHOLDS.critical.gap,
        message: `Segment "${bucket.label}" critically drifted: avg predicted ${(avg * 100).toFixed(1)}% (gap ${(gap * 100).toFixed(1)}pp, n=${bucket.preds.length})`,
        sampleSize: bucket.preds.length,
        timestamp: new Date().toISOString(),
      })
    } else if (gap >= SEGMENT_THRESHOLDS.warn.gap && bucket.preds.length >= SEGMENT_THRESHOLDS.warn.minSample) {
      severity = 'warn'
      alerts.push({
        type: 'segment',
        severity: 'warn',
        metric: `segment_${bucket.label}_gap`,
        value: gap,
        threshold: SEGMENT_THRESHOLDS.warn.gap,
        message: `Segment "${bucket.label}" drifting: avg predicted ${(avg * 100).toFixed(1)}% (gap ${(gap * 100).toFixed(1)}pp, n=${bucket.preds.length})`,
        sampleSize: bucket.preds.length,
        timestamp: new Date().toISOString(),
      })
    }

    segments.push({
      segmentLabel: bucket.label,
      avgPredicted: Math.round(avg * 1000) / 1000,
      absoluteGap: Math.round(gap * 1000) / 1000,
      sampleSize: bucket.preds.length,
      severity,
    })
  }

  segments.sort((a, b) => b.absoluteGap - a.absoluteGap)

  return { segments, alerts }
}

async function computeInputDrift(
  previousSnapshots: InputDriftSnapshot[] | null,
): Promise<{ metrics: InputDriftMetrics; alerts: DriftAlert[] }> {
  const alerts: DriftAlert[] = []
  const snapshots: InputDriftSnapshot[] = []
  const shifts: InputDriftShift[] = []

  const settingsConfigs = [
    { isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1, label: 'dynasty_sf_12' },
    { isDynasty: true, numQbs: 1, numTeams: 12, ppr: 1, label: 'dynasty_1qb_12' },
    { isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1, label: 'redraft_1qb_12' },
  ]

  for (const config of settingsConfigs) {
    try {
      const players = await fetchFantasyCalcValues({
        isDynasty: config.isDynasty,
        numQbs: config.numQbs as 1 | 2,
        numTeams: config.numTeams,
        ppr: config.ppr as 0 | 0.5 | 1,
      })

      const values = players.map(p => p.value).filter(v => v > 0)
      const stats = computeDistributionStats(values)

      const positionMix: Record<string, number> = {}
      for (const p of players) {
        const pos = p.player.position || 'UNK'
        positionMix[pos] = (positionMix[pos] || 0) + 1
      }

      const snapshot: InputDriftSnapshot = {
        settings: config.label,
        totalPlayers: players.length,
        meanValue: Math.round(stats.mean),
        medianValue: Math.round(stats.median),
        stdDev: Math.round(stats.stdDev),
        p10: Math.round(stats.p10),
        p90: Math.round(stats.p90),
        top10Avg: Math.round(stats.top10Avg),
        positionMix,
      }
      snapshots.push(snapshot)

      if (previousSnapshots) {
        const prev = previousSnapshots.find(s => s.settings === config.label)
        if (prev && prev.meanValue > 0) {
          const metricsToCompare: Array<{ name: string; curr: number; prev: number }> = [
            { name: 'meanValue', curr: snapshot.meanValue, prev: prev.meanValue },
            { name: 'medianValue', curr: snapshot.medianValue, prev: prev.medianValue },
            { name: 'top10Avg', curr: snapshot.top10Avg, prev: prev.top10Avg },
            { name: 'stdDev', curr: snapshot.stdDev, prev: prev.stdDev },
          ]

          const MIN_BASELINE = 10
          for (const m of metricsToCompare) {
            if (m.prev === 0 || Math.abs(m.prev) < MIN_BASELINE) continue
            const pctChange = Math.abs(((m.curr - m.prev) / m.prev) * 100)

            let shiftSeverity: DriftSeverity = 'ok'
            if (pctChange >= INPUT_THRESHOLDS.critical.pctChange) {
              shiftSeverity = 'critical'
              alerts.push({
                type: 'input',
                severity: 'critical',
                metric: `${config.label}_${m.name}`,
                value: pctChange,
                threshold: INPUT_THRESHOLDS.critical.pctChange,
                message: `Input distribution shift: ${config.label} ${m.name} changed ${pctChange.toFixed(1)}% (${m.prev}→${m.curr})`,
                sampleSize: snapshot.totalPlayers,
                timestamp: new Date().toISOString(),
              })
            } else if (pctChange >= INPUT_THRESHOLDS.warn.pctChange) {
              shiftSeverity = 'warn'
              alerts.push({
                type: 'input',
                severity: 'warn',
                metric: `${config.label}_${m.name}`,
                value: pctChange,
                threshold: INPUT_THRESHOLDS.warn.pctChange,
                message: `Input distribution shifting: ${config.label} ${m.name} changed ${pctChange.toFixed(1)}% (${m.prev}→${m.curr})`,
                sampleSize: snapshot.totalPlayers,
                timestamp: new Date().toISOString(),
              })
            }

            if (pctChange >= 5) {
              shifts.push({
                settings: config.label,
                metric: m.name,
                previousValue: m.prev,
                currentValue: m.curr,
                pctChange: Math.round(pctChange * 10) / 10,
                severity: shiftSeverity,
              })
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[DriftDetection] Failed to snapshot ${config.label}:`, err)
    }
  }

  const severity = alerts.reduce<DriftSeverity>((max, a) => severityMax(max, a.severity), 'ok')

  return {
    metrics: { snapshots, shifts, severity },
    alerts,
  }
}

export async function runDriftDetection(
  season?: number,
): Promise<DriftReport> {
  console.log('[DriftDetection] Starting drift detection cycle...')

  const resolvedSeason = season ?? await resolveCurrentTradeLearningSeason()

  const stats = await prisma.tradeLearningStats.findUnique({
    where: { season: resolvedSeason },
  })

  const rawStats = stats as Record<string, unknown> | null
  const currentB0 = (rawStats?.calibratedB0 as number) ?? -1.10
  const previousReport = rawStats?.driftReport as unknown as DriftReport | null

  const trades = await prisma.leagueTrade.findMany({
    where: {
      analyzed: true,
      season: resolvedSeason,
      valueGiven: { not: null },
      valueReceived: { not: null },
    },
    select: {
      valueGiven: true,
      valueReceived: true,
      valueDifferential: true,
      isSuperFlex: true,
      leagueFormat: true,
      scoringType: true,
    },
  })

  const feedback = await prisma.tradeFeedback.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
    },
    select: {
      rating: true,
      aiGrade: true,
    },
  })

  const [calibrationResult, rankResult, segmentResult, inputResult] = await Promise.all([
    computeCalibrationDrift(trades, currentB0),
    computeRankOrderDrift(trades, currentB0, feedback),
    Promise.resolve(computeSegmentDrift(trades, currentB0)),
    computeInputDrift(previousReport?.input?.snapshots ?? null),
  ])

  const allAlerts = [
    ...calibrationResult.alerts,
    ...rankResult.alerts,
    ...segmentResult.alerts,
    ...inputResult.alerts,
  ]

  const overallSeverity = allAlerts.reduce<DriftSeverity>(
    (max, a) => severityMax(max, a.severity),
    'ok',
  )

  const previousHistory = previousReport?.history ?? []
  const historySummary: DriftReportSummary = {
    timestamp: new Date().toISOString(),
    overallSeverity,
    alertCount: allAlerts.length,
    calibrationGap: calibrationResult.metrics.absoluteGap,
    rankRho: rankResult.metrics.spearmanRho,
  }

  const report: DriftReport = {
    timestamp: new Date().toISOString(),
    season: resolvedSeason,
    overallSeverity,
    calibration: calibrationResult.metrics,
    rankOrder: rankResult.metrics,
    segments: segmentResult.segments,
    input: inputResult.metrics,
    alerts: allAlerts,
    history: [...previousHistory.slice(-19), historySummary],
  }

  await prisma.$executeRaw`
    INSERT INTO "TradeLearningStats" (id, season, "driftReport", "lastUpdated", "createdAt")
    VALUES (gen_random_uuid()::text, ${resolvedSeason}, ${JSON.stringify(report)}::jsonb, NOW(), NOW())
    ON CONFLICT (season) DO UPDATE SET "driftReport" = ${JSON.stringify(report)}::jsonb, "lastUpdated" = NOW()
  `

  const alertSummary = allAlerts.length > 0
    ? allAlerts.map(a => `[${a.severity.toUpperCase()}] ${a.message}`).join('\n  ')
    : 'No alerts'

  console.log(`[DriftDetection] Complete. Overall: ${overallSeverity.toUpperCase()}, ${allAlerts.length} alert(s), ${trades.length} trades, ${feedback.length} feedback`)
  if (allAlerts.length > 0) {
    console.log(`[DriftDetection] Alerts:\n  ${alertSummary}`)
  }

  return report
}
