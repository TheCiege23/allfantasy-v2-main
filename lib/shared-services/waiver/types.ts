/**
 * Waiver Service — shadow-mode types, Fantasy OS Migration Plan Milestone 4
 * successor (Waiver OS), Phase 7. Mirrors lib/shared-services/trade/types.ts's
 * architecture. SHADOW MODE ONLY — nothing here is consumed by any live route.
 */

import type { WaiverRosterPlayer, ScoredWaiverTarget } from '@/lib/waiver-engine/waiver-scoring'
import type { WaiverAIEngineInput, UserGoal } from '@/lib/waiver-ai-engine/types'
import type { ManagerBehaviorProfile } from '@/lib/shared-services/knowledge-graph/types'

export type { WaiverRosterPlayer, ScoredWaiverTarget, WaiverAIEngineInput, UserGoal }

/** The one real, independently-computed comparison-only engine found during the Phase 7 audit (lib/ai/waivers/waiverRecommendationService.ts). Format-specific "War Room" engines are a legitimate separate family (per-format tuning), not duplicates, and are out of scope here — see the README. */
export type LegacyWaiverGraderId = 'waiver_recommendation_service'

export interface LegacyWaiverGraderResult {
  graderId: LegacyWaiverGraderId
  topAddPlayerId: string | null
  topAddPlayerName: string | null
  faabBid: number | null
  priority: number | null
  confidence: 'high' | 'medium' | 'low' | null
  /** Set when the real legacy call itself failed — divergence is not computed against a failed call. */
  error: string | null
}

export interface WaiverGraderDivergence {
  graderId: LegacyWaiverGraderId
  legacyTopAddPlayerId: string | null
  legacyTopAddPlayerName: string | null
  legacyFaabBid: number | null
  legacyPriority: number | null
  shadowTopAddPlayerId: string | null
  shadowTopAddPlayerName: string | null
  shadowFaabBid: number | null
  shadowPriority: number | null
  /** null when the legacy call failed (no comparison possible), not a false "false". */
  sameTopAdd: boolean | null
  faabBidDelta: number | null
  notes: string[]
}

/**
 * Manager tendency context, same honesty contract as Trade OS's — sourced from
 * the Fantasy Knowledge Graph (Phase 3's getManagerBehaviorProfile), gated by
 * its own privacy cohort check. Never fabricates tendency data it doesn't have.
 */
export interface ManagerTendencyContext {
  status: 'ok' | 'gated' | 'unavailable'
  reason: string | null
  profile: ManagerBehaviorProfile | null
}

export type WaiverUrgency = 'critical' | 'high' | 'medium' | 'low' | 'none'

export interface WaiverEvaluation {
  evaluationId: string
  leagueId: string
  rosterId: string
  /** League.platform — 'native' or a real ImportProvider value. Unlike Trade OS, Waiver OS never
   *  needs a live external re-fetch (it reads Roster/League rows we already persisted), so natively
   *  created leagues ARE backtestable here — a real capability Trade OS's Phase 6 backtest lacked. */
  platform: string
  evaluatedAt: string

  topCandidate: {
    playerId: string
    playerName: string
    position: string
    team: string | null
  } | null

  recommendation: {
    /** Reused directly from the real waiver-scoring.ts scoreWaiverCandidates() composite score — not a new formula. */
    score: number
    tier: ScoredWaiverTarget['recommendation'] | null
    dropCandidate: { name: string; position: string; reason: string } | null
  }

  faab: {
    recommendedBid: number | null
    faabRemaining: number | null
    faabBudget: number | null
  }

  priority: {
    rank: number | null
    waiverType: string
  }

  rosterImpact: {
    needs: string[]
    surplus: string[]
  }

  managerTendency: ManagerTendencyContext

  urgency: WaiverUrgency
  confidence: number
  evidence: string[]
  risk: {
    level: 'low' | 'medium' | 'high'
    flags: string[]
  }
  uncertainty: string[]
  freshness: {
    contextAssembledAt: string
    managerProfileComputedAt: string | null
  }
  sourceAttribution: {
    contextProvider: string
    managerTendencySource: 'knowledge_graph' | 'unavailable'
  }

  /** Real, independently-computed legacy grader results run alongside this evaluation, for parity comparison. */
  divergence: WaiverGraderDivergence[]
}
