/**
 * Divergence Analyzer — Trade Shadow Backtest, Phase 6.
 *
 * Pure functions only: turns a batch of real TradeShadowEvaluation results
 * (Phase 5) into parity statistics broken down by grader/league/
 * provider/confidence/divergence-category, and checks them against the
 * migration-readiness thresholds from the Phase 6 brief. Nothing here reads
 * or writes any store — callers pass in whatever evaluations they collected
 * (e.g. from BacktestRunSummary.evaluations or a ShadowResultStore).
 */

import type { LegacyGraderId, TradeGraderDivergence, TradeShadowEvaluation } from '@/lib/shared-services/trade/types'
import {
  DEFAULT_BACKTEST_THRESHOLDS,
  type BacktestDivergenceSummary,
  type BacktestThresholds,
  type DivergenceCategory,
  type GraderParitySummary,
  type GroupedDivergenceCounts,
} from './types'

export function classifyDivergence(d: TradeGraderDivergence, thresholds: BacktestThresholds): DivergenceCategory {
  if (d.legacyFairnessScore === null || d.fairnessScoreDelta === null) return 'legacy_grader_failed'
  if (Math.abs(d.fairnessScoreDelta) >= thresholds.criticalDivergenceAbsFairnessDelta) return 'critical_divergence'
  if (d.fairnessScoreDelta !== 0 || d.gradeMatches === false) return 'minor_divergence'
  return 'aligned'
}

function emptyCategoryCounts(): Record<DivergenceCategory, number> {
  return { aligned: 0, minor_divergence: 0, critical_divergence: 0, legacy_grader_failed: 0 }
}

function confidenceBucket(confidence: number, thresholds: BacktestThresholds): 'low' | 'medium' | 'high' {
  if (confidence >= thresholds.highConfidenceMinScore) return 'high'
  if (confidence >= 0.4) return 'medium'
  return 'low'
}

function bumpGroup(map: Record<string, GroupedDivergenceCounts>, key: string, isCritical: boolean): void {
  const existing = map[key] ?? { totalEvaluations: 0, criticalDivergenceCount: 0 }
  existing.totalEvaluations += 1
  if (isCritical) existing.criticalDivergenceCount += 1
  map[key] = existing
}

export function summarizeDivergence(
  evaluations: TradeShadowEvaluation[],
  thresholds: BacktestThresholds = DEFAULT_BACKTEST_THRESHOLDS
): BacktestDivergenceSummary {
  const graderTotals = new Map<
    LegacyGraderId,
    {
      totalEntries: number
      totalComparable: number
      gradeMatchCount: number
      absDeltaSum: number
      criticalCount: number
      criticalInHighConfidenceCount: number
      byCategory: Record<DivergenceCategory, number>
    }
  >()

  const byLeague: Record<string, GroupedDivergenceCounts> = {}
  const byProvider: Record<string, GroupedDivergenceCounts> = {}
  const byConfidenceBucket: Record<'low' | 'medium' | 'high', GroupedDivergenceCounts> = {
    low: { totalEvaluations: 0, criticalDivergenceCount: 0 },
    medium: { totalEvaluations: 0, criticalDivergenceCount: 0 },
    high: { totalEvaluations: 0, criticalDivergenceCount: 0 },
  }

  for (const evaluation of evaluations) {
    const isHighConfidence = evaluation.confidence >= thresholds.highConfidenceMinScore
    let evaluationHasCriticalDivergence = false

    for (const d of evaluation.divergence) {
      const category = classifyDivergence(d, thresholds)
      const totals = graderTotals.get(d.graderId) ?? {
        totalEntries: 0,
        totalComparable: 0,
        gradeMatchCount: 0,
        absDeltaSum: 0,
        criticalCount: 0,
        criticalInHighConfidenceCount: 0,
        byCategory: emptyCategoryCounts(),
      }

      totals.totalEntries += 1
      totals.byCategory[category] += 1
      if (category === 'critical_divergence') {
        totals.criticalCount += 1
        evaluationHasCriticalDivergence = true
        if (isHighConfidence) totals.criticalInHighConfidenceCount += 1
      }
      if (d.legacyFairnessScore !== null && d.fairnessScoreDelta !== null) {
        totals.totalComparable += 1
        totals.absDeltaSum += Math.abs(d.fairnessScoreDelta)
        if (d.gradeMatches === true) totals.gradeMatchCount += 1
      }

      graderTotals.set(d.graderId, totals)
    }

    bumpGroup(byLeague, evaluation.leagueId, evaluationHasCriticalDivergence)
    bumpGroup(byProvider, evaluation.provider, evaluationHasCriticalDivergence)
    const bucket = confidenceBucket(evaluation.confidence, thresholds)
    byConfidenceBucket[bucket].totalEvaluations += 1
    if (evaluationHasCriticalDivergence) byConfidenceBucket[bucket].criticalDivergenceCount += 1
  }

  const byGrader: GraderParitySummary[] = []
  const thresholdFindings: string[] = []
  let passesMigrationThreshold = graderTotals.size > 0

  for (const [graderId, totals] of graderTotals.entries()) {
    const nonCriticalParityRate = totals.totalEntries > 0 ? (totals.totalEntries - totals.criticalCount) / totals.totalEntries : null
    const meanAbsFairnessScoreDelta = totals.totalComparable > 0 ? totals.absDeltaSum / totals.totalComparable : null
    const gradeMatchRate = totals.totalComparable > 0 ? totals.gradeMatchCount / totals.totalComparable : null

    byGrader.push({
      graderId,
      totalComparable: totals.totalComparable,
      gradeMatchCount: totals.gradeMatchCount,
      gradeMatchRate,
      meanAbsFairnessScoreDelta,
      nonCriticalParityRate,
      criticalDivergenceCount: totals.criticalCount,
      criticalDivergenceInHighConfidenceCount: totals.criticalInHighConfidenceCount,
      legacyGraderFailedCount: totals.byCategory.legacy_grader_failed,
      byCategory: totals.byCategory,
    })

    const parityOk = nonCriticalParityRate !== null && nonCriticalParityRate >= thresholds.minNonCriticalParityRate
    const criticalOk = totals.criticalInHighConfidenceCount <= thresholds.maxCriticalDivergencesInHighConfidence
    if (!parityOk || !criticalOk) passesMigrationThreshold = false

    const parityPct = nonCriticalParityRate !== null ? `${(nonCriticalParityRate * 100).toFixed(1)}%` : 'n/a (no comparable data)'
    thresholdFindings.push(
      `${graderId}: ${parityPct} non-critical parity across ${totals.totalEntries} evaluation(s) ` +
        `(threshold ${(thresholds.minNonCriticalParityRate * 100).toFixed(0)}%) — ${parityOk ? 'PASSES' : 'FAILS'}; ` +
        `${totals.criticalInHighConfidenceCount} critical divergence(s) in high-confidence trades ` +
        `(threshold ${thresholds.maxCriticalDivergencesInHighConfidence}) — ${criticalOk ? 'PASSES' : 'FAILS'}`
    )
  }

  if (graderTotals.size === 0) {
    thresholdFindings.push('No divergence data collected — cannot evaluate migration threshold.')
  }

  return {
    totalEvaluations: evaluations.length,
    byGrader,
    byLeague,
    byProvider,
    byConfidenceBucket,
    thresholds,
    passesMigrationThreshold,
    thresholdFindings,
  }
}
