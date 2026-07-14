/**
 * Trade Service — shadow-mode types, Fantasy OS Migration Plan Milestone 4
 * (docs/os/ALLFANTASY_FANTASY_OS_MIGRATION_PLAN.md), first real step of Trade
 * OS consolidation. Shadow-mode only per this phase's brief — nothing here
 * is consumed by any live route yet.
 */

import type { ImportProvider } from '@/lib/league-import/types'
import type { ManagerBehaviorProfile } from '@/lib/shared-services/knowledge-graph/types'

export type LegacyGraderId = 't2' | 'trade_engine'

/** One legacy grader's real, independently-computed result, for divergence comparison. */
export interface LegacyGraderResult {
  graderId: LegacyGraderId
  fairnessScore: number | null
  grade: string | null
  /** Set when the real grader call itself failed — divergence is not computed against a failed call. */
  error: string | null
}

export interface TradeGraderDivergence {
  graderId: LegacyGraderId
  legacyFairnessScore: number | null
  legacyGrade: string | null
  shadowFairnessScore: number
  shadowGrade: string
  /** legacyFairnessScore - shadowFairnessScore; null when the legacy call failed. */
  fairnessScoreDelta: number | null
  gradeMatches: boolean | null
  notes: string[]
}

export interface RosterFitSummary {
  needs: string[]
  surplus: string[]
}

/**
 * Manager tendency context is sourced from the Fantasy Knowledge Graph
 * (Phase 3's getManagerBehaviorProfile), gated by its own privacy cohort
 * check. `status: 'unavailable'` covers both "gated" and "the KG call
 * itself failed" — a shadow evaluation must never fabricate tendency data
 * it doesn't actually have.
 */
export interface ManagerTendencyContext {
  status: 'ok' | 'gated' | 'unavailable'
  reason: string | null
  profile: ManagerBehaviorProfile | null
}

export interface TradeShadowEvaluation {
  evaluationId: string
  leagueId: string
  provider: ImportProvider
  evaluatedAt: string

  fairness: {
    /** Reused directly from the real trade-engine.ts computeTradeDrivers() output — not a new formula. */
    score: number
    grade: string
    valueDifference: number
    leanedTo: 'sideA' | 'sideB' | 'even'
  }

  rosterFit: {
    sideA: RosterFitSummary
    sideB: RosterFitSummary
  }

  managerTendency: {
    sideA: ManagerTendencyContext
    sideB: ManagerTendencyContext
  }

  leagueContext: {
    scoringType: string
    isSF: boolean
    isTEP: boolean
    numTeams: number
  }

  confidence: number
  evidence: string[]
  risk: {
    level: 'low' | 'medium' | 'high'
    flags: string[]
  }
  freshness: {
    contextAssembledAt: string
    managerProfileComputedAt: {
      sideA: string | null
      sideB: string | null
    }
  }
  sourceAttribution: {
    contextProvider: ImportProvider
    managerTendencySource: 'knowledge_graph' | 'unavailable'
  }

  /** Real, independently-computed legacy grader results run alongside this evaluation, for parity comparison. */
  divergence: TradeGraderDivergence[]
}
