/**
 * Waiver Divergence Analyzer — Phase 7. Pure functions only, mirroring Trade
 * OS's DivergenceAnalyzer.ts. Turns a batch of real WaiverEvaluation results
 * into parity statistics broken down by grader/league/provider, plus a real-
 * outcome alignment check against the historical claim's actual result.
 *
 * Real-outcome alignment is reported SEPARATELY from grader parity, and is
 * explicitly not a "prediction accuracy" claim — see HistoricalWaiverLoader.ts's
 * docstring on why no point-in-time roster snapshot exists for waivers.
 */

import type { WaiverGraderDivergence, WaiverEvaluation } from '@/lib/shared-services/waiver/types'
import type {
  EvaluatedWaiverSample,
  GroupedWaiverCounts,
  WaiverBacktestDivergenceSummary,
  WaiverDivergenceCategory,
  WaiverGraderParitySummary,
  WaiverRealOutcomeAlignment,
} from './types'

export function classifyWaiverDivergence(d: WaiverGraderDivergence): WaiverDivergenceCategory {
  if (d.sameTopAdd === null) return 'legacy_grader_failed'
  return d.sameTopAdd ? 'aligned' : 'diverged'
}

function emptyCategoryCounts(): Record<WaiverDivergenceCategory, number> {
  return { aligned: 0, diverged: 0, legacy_grader_failed: 0 }
}

function bumpGroup(map: Record<string, GroupedWaiverCounts>, key: string, isDiverged: boolean): void {
  const existing = map[key] ?? { totalEvaluations: 0, divergedCount: 0 }
  existing.totalEvaluations += 1
  if (isDiverged) existing.divergedCount += 1
  map[key] = existing
}

export function summarizeWaiverDivergence(evaluations: WaiverEvaluation[]): Omit<WaiverBacktestDivergenceSummary, 'realOutcomeAlignment'> {
  const graderTotals = new Map<
    string,
    { totalEntries: number; totalComparable: number; sameTopAddCount: number; byCategory: Record<WaiverDivergenceCategory, number> }
  >()
  const byLeague: Record<string, GroupedWaiverCounts> = {}
  const byProvider: Record<string, GroupedWaiverCounts> = {}

  for (const evaluation of evaluations) {
    let evaluationHasDivergence = false
    for (const d of evaluation.divergence) {
      const category = classifyWaiverDivergence(d)
      const totals = graderTotals.get(d.graderId) ?? {
        totalEntries: 0,
        totalComparable: 0,
        sameTopAddCount: 0,
        byCategory: emptyCategoryCounts(),
      }
      totals.totalEntries += 1
      totals.byCategory[category] += 1
      if (category === 'diverged') evaluationHasDivergence = true
      if (d.sameTopAdd !== null) {
        totals.totalComparable += 1
        if (d.sameTopAdd) totals.sameTopAddCount += 1
      }
      graderTotals.set(d.graderId, totals)
    }

    bumpGroup(byLeague, evaluation.leagueId, evaluationHasDivergence)
    bumpGroup(byProvider, evaluation.platform, evaluationHasDivergence)
  }

  const byGrader: WaiverGraderParitySummary[] = []
  const thresholdFindings: string[] = []

  for (const [graderId, totals] of graderTotals.entries()) {
    const sameTopAddRate = totals.totalComparable > 0 ? totals.sameTopAddCount / totals.totalComparable : null
    byGrader.push({
      graderId: graderId as WaiverGraderParitySummary['graderId'],
      totalComparable: totals.totalComparable,
      sameTopAddCount: totals.sameTopAddCount,
      sameTopAddRate,
      legacyGraderFailedCount: totals.byCategory.legacy_grader_failed,
      byCategory: totals.byCategory,
    })
    const pct = sameTopAddRate !== null ? `${(sameTopAddRate * 100).toFixed(1)}%` : 'n/a (no comparable data)'
    thresholdFindings.push(`${graderId}: ${pct} same-top-add rate across ${totals.totalEntries} evaluation(s).`)
  }

  if (graderTotals.size === 0) {
    thresholdFindings.push('No divergence data collected.')
  }

  return { totalEvaluations: evaluations.length, byGrader, byLeague, byProvider, thresholdFindings }
}

export function summarizeRealOutcomeAlignment(pairs: EvaluatedWaiverSample[]): WaiverRealOutcomeAlignment {
  let awardedAndShadowAgreed = 0
  let awardedTotal = 0
  let failedAndShadowDisagreed = 0
  let failedTotal = 0

  for (const { sample, evaluation } of pairs) {
    const shadowTopMatchesHistoricalAdd = evaluation.topCandidate?.playerId === sample.addPlayerId
    if (sample.realOutcome === 'awarded') {
      awardedTotal += 1
      if (shadowTopMatchesHistoricalAdd) awardedAndShadowAgreed += 1
    } else {
      failedTotal += 1
      if (!shadowTopMatchesHistoricalAdd) failedAndShadowDisagreed += 1
    }
  }

  return { awardedAndShadowAgreed, awardedTotal, failedAndShadowDisagreed, failedTotal }
}

export function summarizeWaiverBacktest(pairs: EvaluatedWaiverSample[]): WaiverBacktestDivergenceSummary {
  const evaluations = pairs.map((p) => p.evaluation)
  const base = summarizeWaiverDivergence(evaluations)
  const realOutcomeAlignment = summarizeRealOutcomeAlignment(pairs)
  return { ...base, realOutcomeAlignment }
}
