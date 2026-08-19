/**
 * Read-only diagnostics for the trade-learning weekly recalibration system.
 * Built for docs/TRADE_LEARNING_SHADOW_ROLLOUT.md — lets an operator answer
 * "is the scheduler running, would it run right now, has promotion happened,
 * what is the current calibration state" without tailing logs or running SQL.
 *
 * Deliberately reuses lib/trade-engine/calibration-metrics.ts's already-built
 * (previously unwired) computeCalibrationHealth() rather than recomputing
 * ECE/Brier/reliability metrics here. Performs no writes.
 */
import { prisma } from '../prisma'
import {
  isWeeklyRecalibrationEnabled,
  DEFAULT_B0,
  MIN_RECALIBRATION_SAMPLE,
  SHADOW_MATURITY_DAYS,
  MAX_SHADOW_DIVERGENCE,
  RECALIBRATION_CADENCE_DAYS,
} from './auto-recalibration'
import { computeCalibrationHealth, type CalibrationHealthMetrics } from './calibration-metrics'
import { resolveCurrentTradeLearningSeason } from './season-resolver'

const CALIBRATION_HEALTH_WINDOW_DAYS = 30

interface CalibrationHistoryEntryShape {
  timestamp?: string
  oldB0?: number
  newB0?: number
  sampleSize?: number
  source?: string
}

interface DriftReportShape {
  overallSeverity?: string
  alerts?: unknown[]
  timestamp?: string
}

interface SegmentB0EntryShape {
  segment?: string
  b0?: number
  sampleSize?: number
}

export interface TradeLearningDiagnostics {
  generatedAt: string
  season: number
  operational: {
    weeklyRecalibrationEnabled: boolean
    envVar: string
  }
  calibratedB0: {
    current: number
    owner: string
    lastCalibratedAt: string | null
  }
  shadow: {
    pending: boolean
    shadowB0: number | null
    computedAt: string | null
    ageDays: number | null
    maturityThresholdDays: number
    isMature: boolean
    divergenceFromActive: number | null
    maxAllowedDivergence: number
    withinDivergenceCap: boolean | null
    sampleSize: number | null
    minRequiredSample: number
  }
  promotion: {
    hasEverBeenPromoted: boolean
    lastPromotedAt: string | null
    lastPromotedB0: number | null
  }
  scheduler: {
    lastRecalibrationAt: string | null
    daysSinceLastRecalibration: number | null
    cadenceThresholdDays: number
    wouldRunIfInvokedNow: boolean
    skipReasonIfAny: string | null
  }
  segments: { count: number; entries: SegmentB0EntryShape[] } | null
  calibrationHealth: CalibrationHealthMetrics | null
  drift: { overallSeverity: string; alertCount: number; lastComputedAt: string | null } | null
  recentHistory: CalibrationHistoryEntryShape[]
}

export async function buildTradeLearningDiagnostics(
  season?: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TradeLearningDiagnostics> {
  const resolvedSeason = season ?? await resolveCurrentTradeLearningSeason()
  const stats = await prisma.tradeLearningStats.findUnique({ where: { season: resolvedSeason } })
  const now = Date.now()

  const calibratedB0 = (stats?.calibratedB0 as number | null | undefined) ?? DEFAULT_B0
  const shadowB0 = (stats?.shadowB0 as number | null | undefined) ?? null
  const shadowComputedAt = stats?.shadowB0ComputedAt ?? null
  const shadowSampleSize = (stats?.shadowB0SampleSize as number | null | undefined) ?? null
  const lastRecalibrationAt = stats?.lastRecalibrationAt ?? null
  const calibrationHistory = ((stats?.calibrationHistory as unknown as CalibrationHistoryEntryShape[]) ?? [])
  const segmentMap = stats?.segmentB0s as { segments?: SegmentB0EntryShape[] } | null | undefined
  const driftReport = stats?.driftReport as DriftReportShape | null | undefined

  const ageDays = shadowComputedAt
    ? (now - new Date(shadowComputedAt).getTime()) / (1000 * 60 * 60 * 24)
    : null
  const isMature = ageDays !== null && ageDays >= SHADOW_MATURITY_DAYS
  const divergenceFromActive = shadowB0 !== null ? Math.abs(shadowB0 - calibratedB0) : null
  const withinDivergenceCap = divergenceFromActive !== null ? divergenceFromActive <= MAX_SHADOW_DIVERGENCE : null

  const daysSinceLastRecalibration = lastRecalibrationAt
    ? (now - new Date(lastRecalibrationAt).getTime()) / (1000 * 60 * 60 * 24)
    : null
  const wouldRunIfInvokedNow =
    daysSinceLastRecalibration === null || daysSinceLastRecalibration >= RECALIBRATION_CADENCE_DAYS
  const skipReasonIfAny = wouldRunIfInvokedNow
    ? null
    : `last recalibration ran ${daysSinceLastRecalibration!.toFixed(1)} days ago, needs ${RECALIBRATION_CADENCE_DAYS}`

  const lastPromotionEntry = [...calibrationHistory].reverse().find((e) => e.source === 'auto-recalibration') ?? null

  let calibrationHealth: CalibrationHealthMetrics | null = null
  try {
    calibrationHealth = await computeCalibrationHealth(CALIBRATION_HEALTH_WINDOW_DAYS, resolvedSeason)
  } catch {
    calibrationHealth = null
  }

  return {
    generatedAt: new Date().toISOString(),
    season: resolvedSeason,
    operational: {
      weeklyRecalibrationEnabled: isWeeklyRecalibrationEnabled(env),
      envVar: 'TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED',
    },
    calibratedB0: {
      current: calibratedB0,
      owner: 'promoteShadowB0 (lib/trade-engine/auto-recalibration.ts) — see docs/TRADE_LEARNING_CALIBRATED_B0_OWNERSHIP_ADR.md',
      lastCalibratedAt: stats?.lastCalibrated ? new Date(stats.lastCalibrated).toISOString() : null,
    },
    shadow: {
      pending: shadowB0 !== null,
      shadowB0,
      computedAt: shadowComputedAt ? new Date(shadowComputedAt).toISOString() : null,
      ageDays: ageDays !== null ? Math.round(ageDays * 10) / 10 : null,
      maturityThresholdDays: SHADOW_MATURITY_DAYS,
      isMature,
      divergenceFromActive: divergenceFromActive !== null ? Math.round(divergenceFromActive * 1000) / 1000 : null,
      maxAllowedDivergence: MAX_SHADOW_DIVERGENCE,
      withinDivergenceCap,
      sampleSize: shadowSampleSize,
      minRequiredSample: MIN_RECALIBRATION_SAMPLE,
    },
    promotion: {
      hasEverBeenPromoted: lastPromotionEntry !== null,
      lastPromotedAt: lastPromotionEntry?.timestamp ?? null,
      lastPromotedB0: lastPromotionEntry?.newB0 ?? null,
    },
    scheduler: {
      lastRecalibrationAt: lastRecalibrationAt ? new Date(lastRecalibrationAt).toISOString() : null,
      daysSinceLastRecalibration:
        daysSinceLastRecalibration !== null ? Math.round(daysSinceLastRecalibration * 10) / 10 : null,
      cadenceThresholdDays: RECALIBRATION_CADENCE_DAYS,
      wouldRunIfInvokedNow,
      skipReasonIfAny,
    },
    segments: segmentMap?.segments ? { count: segmentMap.segments.length, entries: segmentMap.segments } : null,
    calibrationHealth,
    drift: driftReport
      ? {
          overallSeverity: driftReport.overallSeverity ?? 'unknown',
          alertCount: driftReport.alerts?.length ?? 0,
          lastComputedAt: driftReport.timestamp ?? null,
        }
      : null,
    recentHistory: calibrationHistory.slice(-10),
  }
}
