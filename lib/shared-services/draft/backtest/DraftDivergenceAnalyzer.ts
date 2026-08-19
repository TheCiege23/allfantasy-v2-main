/**
 * Draft Divergence Analyzer — Phase 8. Pure functions only, mirroring Waiver
 * OS's WaiverDivergenceAnalyzer.ts. Turns a batch of real DraftEvaluation
 * results into parity statistics by grader/league/provider/round, plus a
 * real-outcome alignment check against the historical pick's actual player.
 */

import type { DraftGraderDivergence, DraftEvaluation } from '@/lib/shared-services/draft/types'
import type {
  DraftBacktestDivergenceSummary,
  DraftDivergenceCategory,
  DraftGraderParitySummary,
  DraftRealOutcomeAlignment,
  EvaluatedDraftPickSample,
  GroupedDraftCounts,
} from './types'

export function classifyDraftDivergence(d: DraftGraderDivergence): DraftDivergenceCategory {
  if (d.sameTopPlayer === null) return 'legacy_grader_failed'
  return d.sameTopPlayer ? 'aligned' : 'diverged'
}

function emptyCategoryCounts(): Record<DraftDivergenceCategory, number> {
  return { aligned: 0, diverged: 0, legacy_grader_failed: 0 }
}

function bumpGroup(map: Record<string, GroupedDraftCounts>, key: string, isDiverged: boolean): void {
  const existing = map[key] ?? { totalEvaluations: 0, divergedCount: 0 }
  existing.totalEvaluations += 1
  if (isDiverged) existing.divergedCount += 1
  map[key] = existing
}

export function summarizeDraftDivergence(evaluations: DraftEvaluation[]): Omit<DraftBacktestDivergenceSummary, 'realOutcomeAlignment'> {
  const graderTotals = new Map<
    string,
    { totalEntries: number; totalComparable: number; sameTopPlayerCount: number; byCategory: Record<DraftDivergenceCategory, number> }
  >()
  const byLeague: Record<string, GroupedDraftCounts> = {}
  const byProvider: Record<string, GroupedDraftCounts> = {}
  const byRound: Record<number, GroupedDraftCounts> = {}

  for (const evaluation of evaluations) {
    let evaluationHasDivergence = false
    for (const d of evaluation.divergence) {
      const category = classifyDraftDivergence(d)
      const totals = graderTotals.get(d.graderId) ?? {
        totalEntries: 0,
        totalComparable: 0,
        sameTopPlayerCount: 0,
        byCategory: emptyCategoryCounts(),
      }
      totals.totalEntries += 1
      totals.byCategory[category] += 1
      if (category === 'diverged') evaluationHasDivergence = true
      if (d.sameTopPlayer !== null) {
        totals.totalComparable += 1
        if (d.sameTopPlayer) totals.sameTopPlayerCount += 1
      }
      graderTotals.set(d.graderId, totals)
    }

    bumpGroup(byLeague, evaluation.leagueId, evaluationHasDivergence)
    bumpGroup(byProvider, evaluation.platform, evaluationHasDivergence)
    const roundKey = evaluation.draftState.round
    const existing = byRound[roundKey] ?? { totalEvaluations: 0, divergedCount: 0 }
    existing.totalEvaluations += 1
    if (evaluationHasDivergence) existing.divergedCount += 1
    byRound[roundKey] = existing
  }

  const byGrader: DraftGraderParitySummary[] = []
  const thresholdFindings: string[] = []

  for (const [graderId, totals] of graderTotals.entries()) {
    const sameTopPlayerRate = totals.totalComparable > 0 ? totals.sameTopPlayerCount / totals.totalComparable : null
    byGrader.push({
      graderId: graderId as DraftGraderParitySummary['graderId'],
      totalComparable: totals.totalComparable,
      sameTopPlayerCount: totals.sameTopPlayerCount,
      sameTopPlayerRate,
      legacyGraderFailedCount: totals.byCategory.legacy_grader_failed,
      byCategory: totals.byCategory,
    })
    const pct = sameTopPlayerRate !== null ? `${(sameTopPlayerRate * 100).toFixed(1)}%` : 'n/a (no comparable data)'
    thresholdFindings.push(`${graderId}: ${pct} same-top-player rate across ${totals.totalEntries} evaluation(s).`)
  }

  if (graderTotals.size === 0) {
    thresholdFindings.push('No divergence data collected.')
  }

  return { totalEvaluations: evaluations.length, byGrader, byLeague, byProvider, byRound, thresholdFindings }
}

export function summarizeDraftRealOutcomeAlignment(pairs: EvaluatedDraftPickSample[]): DraftRealOutcomeAlignment {
  let matchedCount = 0

  for (const { sample, evaluation } of pairs) {
    const top = evaluation.topCandidate
    if (!top) continue
    const matchesById = sample.realPlayerId != null && top.playerId != null && sample.realPlayerId === top.playerId
    const matchesByNamePosition =
      top.playerName.trim().toLowerCase() === sample.realPlayerName.trim().toLowerCase() &&
      top.position.trim().toLowerCase() === sample.realPosition.trim().toLowerCase()
    if (matchesById || matchesByNamePosition) matchedCount += 1
  }

  return { matchedCount, totalSamples: pairs.length }
}

export function summarizeDraftBacktest(pairs: EvaluatedDraftPickSample[]): DraftBacktestDivergenceSummary {
  const evaluations = pairs.map((p) => p.evaluation)
  const base = summarizeDraftDivergence(evaluations)
  const realOutcomeAlignment = summarizeDraftRealOutcomeAlignment(pairs)
  return { ...base, realOutcomeAlignment }
}
