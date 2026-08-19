/**
 * Decision OS Core — result envelopes (Phase 1).
 *
 * Pairs the lightweight primitive shapes (`Recommendation`, `Insight`, `Simulation`
 * in `../primitives/types.ts`) with Decision OS's existing evidence/confidence
 * contracts. Every type referenced from `lib/decision-os/core` here is the
 * existing, frozen public type — nothing is redefined or duplicated.
 */

import type { Decision } from '@/lib/decision-os/core/decision'
import type { DecisionOSEvidenceSourceType, DecisionOSInsight } from '@/lib/decision-os/core/integrationContract'
import type { LeagueStateGraph } from '../context/types'

export interface RecommendationResult<TAction = unknown> {
  decision: Decision<TAction>
  insight: DecisionOSInsight<TAction>
}

export interface InsightResult {
  evidence: DecisionOSEvidenceSourceType[]
  summary: string
  confidence: 'low' | 'medium' | 'high'
}

/**
 * Net new — today `lib/simulation-engine` and `lib/monte-carlo.ts` exist entirely
 * outside Decision OS. This is the seam for eventually wrapping them with the
 * same wrap-fidelity pattern already proven for lineup/waiver/trade.
 */
export interface SimulationResult {
  simulationType: string
  inputs: LeagueStateGraph
  outcomes: { scenario: string; probability: number }[]
  confidence: 'low' | 'medium' | 'high'
}
