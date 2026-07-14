/**
 * Draft Service — shadow-mode types, Fantasy OS Migration Plan, Draft OS
 * foundation, Phase 8. Mirrors lib/shared-services/waiver/types.ts's
 * architecture. SHADOW MODE ONLY — nothing here is consumed by any live route.
 */

import type { RecommendationInput, RecommendationPlayer, RecommendationResult } from '@/lib/draft-helper/RecommendationEngine'
import type { ManagerBehaviorProfile, PlayerExposure } from '@/lib/shared-services/knowledge-graph/types'

export type { RecommendationInput, RecommendationPlayer, RecommendationResult }

/**
 * The one real, independently-computed comparison-only draft engine found
 * during the Phase 8 audit: lib/ai/opponents/draft/aiOpponentDraft.ts's
 * decideDraftPickWithScores(). It normally requires a BotProfile (a full
 * personality-weight object); this module always compares against the real,
 * already-defined 'balanced_builder' archetype (lib/ai/opponents/botProfiles.ts)
 * as a neutral baseline — never a fabricated or invented personality.
 */
export type LegacyDraftGraderId = 'ai_opponent_draft'

export interface LegacyDraftGraderResult {
  graderId: LegacyDraftGraderId
  topPlayerId: string | null
  topPlayerName: string | null
  confidence: number | null
  reason: string | null
  /** Set when the real legacy call itself failed — divergence is not computed against a failed call. */
  error: string | null
}

export interface DraftGraderDivergence {
  graderId: LegacyDraftGraderId
  legacyTopPlayerId: string | null
  legacyTopPlayerName: string | null
  legacyConfidence: number | null
  shadowTopPlayerId: string | null
  shadowTopPlayerName: string | null
  shadowConfidence: number | null
  /** null when the legacy call failed (no comparison possible), not a false "false". */
  sameTopPlayer: boolean | null
  notes: string[]
}

/** Same honesty contract as Trade OS/Waiver OS — never fabricates tendency data it doesn't have. */
export interface ManagerTendencyContext {
  status: 'ok' | 'gated' | 'unavailable'
  reason: string | null
  profile: ManagerBehaviorProfile | null
}

/** Phase 3's PlayerExposure aggregate, consumed for the top candidate only (resolving a player id from an ADP-only name/position key is a real, honest best-effort step — see DraftContextAssembler.ts). */
export interface PlayerExposureContext {
  status: 'ok' | 'gated' | 'unavailable'
  reason: string | null
  exposure: PlayerExposure | null
}

export interface DraftEvaluation {
  evaluationId: string
  leagueId: string
  rosterId: string
  sessionId: string | null
  /** League.platform — 'native' or a real ImportProvider value. Like Waiver OS (and unlike Trade OS), no live external re-fetch is needed, so native leagues are fully assemblable. */
  platform: string
  evaluatedAt: string

  draftState: {
    round: number
    pick: number
    totalTeams: number
    status: string | null
  }

  topCandidate: {
    playerId: string | null
    playerName: string
    position: string
    team: string | null
  } | null

  recommendation: {
    /** Reused directly from the real RecommendationEngine.computeDraftRecommendation() confidence — not a new formula. */
    score: number
    reason: string
    needScore: number
    adpEdge: number
  }

  alternatives: Array<{ playerName: string; position: string; reason: string; confidence: number }>

  positionalImpact: {
    reachWarning: string | null
    valueWarning: string | null
    scarcityInsight: string | null
    formatInsight: string | null
  }

  draftValue: {
    adp: number | null
    overallPickAtEvaluation: number
  }

  scarcityImpact: {
    insight: string | null
  }

  /** What you'd give up by not taking the top candidate now — the next-best alternatives. */
  opportunityCost: {
    alternativesForegone: string[]
  }

  managerTendency: ManagerTendencyContext
  playerExposure: PlayerExposureContext

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
    playerExposureComputedAt: string | null
  }
  sourceAttribution: {
    contextProvider: string
    managerTendencySource: 'knowledge_graph' | 'unavailable'
    playerExposureSource: 'knowledge_graph' | 'unavailable'
  }

  /** Real, independently-computed legacy grader results run alongside this evaluation, for parity comparison. */
  divergence: DraftGraderDivergence[]
}
