/**
 * Pure computation: assembles the TradeShadowEvaluation shape from already-
 * fetched inputs (league context, legacy grader results, KG tendency
 * lookups). No I/O here — TradeShadowService.ts owns fetching; this module
 * is unit-testable with plain fixtures.
 */

import type { TradeDriverData } from '@/lib/trade-engine/trade-engine'
import type { TradeDecisionContextV1 } from '@/lib/trade-engine/trade-decision-context'
import type { ImportProvider } from '@/lib/league-import/types'
import type {
  LegacyGraderResult,
  ManagerTendencyContext,
  RosterFitSummary,
  TradeGraderDivergence,
  TradeShadowEvaluation,
} from './types'

const RISK_FROM_CONFIDENCE_RATING: Record<TradeDriverData['confidenceRating'], 'low' | 'medium' | 'high'> = {
  HIGH: 'low',
  MEDIUM: 'medium',
  LEARNING: 'high',
}

export function buildDivergence(
  shadowFairnessScore: number,
  shadowGrade: string,
  legacy: LegacyGraderResult
): TradeGraderDivergence {
  if (legacy.error != null || legacy.fairnessScore == null) {
    return {
      graderId: legacy.graderId,
      legacyFairnessScore: null,
      legacyGrade: null,
      shadowFairnessScore,
      shadowGrade,
      fairnessScoreDelta: null,
      gradeMatches: null,
      notes: [legacy.error ?? 'Legacy grader returned no fairness score.'],
    }
  }

  const delta = Math.round((legacy.fairnessScore - shadowFairnessScore) * 100) / 100
  const notes: string[] = []
  if (Math.abs(delta) >= 20) {
    notes.push(`Large divergence (${delta} pts) — this trade is a good candidate for manual review before any consolidation decision.`)
  } else if (Math.abs(delta) <= 5) {
    notes.push('Graders broadly agree on fairness for this trade.')
  }

  return {
    graderId: legacy.graderId,
    legacyFairnessScore: legacy.fairnessScore,
    legacyGrade: legacy.grade,
    shadowFairnessScore,
    shadowGrade,
    fairnessScoreDelta: delta,
    gradeMatches: legacy.grade === shadowGrade,
    notes,
  }
}

export function buildRosterFitSummary(needs: string[], surplus: string[]): RosterFitSummary {
  return { needs, surplus }
}

export function buildRiskFromDrivers(drivers: TradeDriverData): { level: 'low' | 'medium' | 'high'; flags: string[] } {
  return {
    level: RISK_FROM_CONFIDENCE_RATING[drivers.confidenceRating] ?? 'medium',
    flags: drivers.riskFlags ?? [],
  }
}

export function buildEvidence(drivers: TradeDriverData, tradeCtx: TradeDecisionContextV1): string[] {
  const evidence: string[] = []
  evidence.push(`Verdict: ${drivers.verdict} (lean: ${drivers.lean}).`)
  if (drivers.dominantDriver) evidence.push(`Dominant driver: ${drivers.dominantDriver}.`)
  if (drivers.driverNarrative) evidence.push(drivers.driverNarrative)
  evidence.push(
    `League context: ${tradeCtx.leagueConfig.scoringType}, ${tradeCtx.leagueConfig.numTeams} teams, ${tradeCtx.leagueConfig.isSF ? 'Superflex' : '1QB'}${tradeCtx.leagueConfig.isTEP ? ', TEP' : ''}.`
  )
  if (drivers.acceptBullets?.length) evidence.push(...drivers.acceptBullets)
  return evidence
}

export interface AssembleShadowEvaluationInput {
  evaluationId: string
  leagueId: string
  provider: ImportProvider
  contextAssembledAt: string
  tradeCtx: TradeDecisionContextV1
  drivers: TradeDriverData
  t2Result: LegacyGraderResult
  sideATendency: ManagerTendencyContext
  sideBTendency: ManagerTendencyContext
}

export function assembleShadowEvaluation(input: AssembleShadowEvaluationInput): TradeShadowEvaluation {
  const { tradeCtx, drivers } = input
  const shadowGrade = drivers.verdict
  const leanedTo: 'sideA' | 'sideB' | 'even' =
    tradeCtx.valueDelta.favoredSide === 'A' ? 'sideA' : tradeCtx.valueDelta.favoredSide === 'B' ? 'sideB' : 'even'

  const divergence: TradeGraderDivergence[] = [buildDivergence(drivers.fairnessScore, shadowGrade, input.t2Result)]

  const managerProfileComputedAt = {
    sideA: input.sideATendency.profile ? input.sideATendency.profile.computedAt.toISOString() : null,
    sideB: input.sideBTendency.profile ? input.sideBTendency.profile.computedAt.toISOString() : null,
  }

  return {
    evaluationId: input.evaluationId,
    leagueId: input.leagueId,
    provider: input.provider,
    evaluatedAt: new Date().toISOString(),

    fairness: {
      score: drivers.fairnessScore,
      grade: shadowGrade,
      valueDifference: tradeCtx.valueDelta.absoluteDiff,
      leanedTo,
    },

    rosterFit: {
      sideA: buildRosterFitSummary(tradeCtx.sideA.needs, tradeCtx.sideA.surplus),
      sideB: buildRosterFitSummary(tradeCtx.sideB.needs, tradeCtx.sideB.surplus),
    },

    managerTendency: {
      sideA: input.sideATendency,
      sideB: input.sideBTendency,
    },

    leagueContext: {
      scoringType: tradeCtx.leagueConfig.scoringType,
      isSF: tradeCtx.leagueConfig.isSF,
      isTEP: tradeCtx.leagueConfig.isTEP,
      numTeams: tradeCtx.leagueConfig.numTeams,
    },

    confidence: drivers.confidenceScore,
    evidence: buildEvidence(drivers, tradeCtx),
    risk: buildRiskFromDrivers(drivers),
    freshness: {
      contextAssembledAt: input.contextAssembledAt,
      managerProfileComputedAt,
    },
    sourceAttribution: {
      contextProvider: input.provider,
      managerTendencySource:
        input.sideATendency.status === 'ok' || input.sideBTendency.status === 'ok' ? 'knowledge_graph' : 'unavailable',
    },

    divergence,
  }
}
