/**
 * Decision OS — Decision Context Object for `manager.waiver.claim` (Slice 2).
 *
 * READ-ONLY assembly. The DCO is the ONLY thing the Waiver Intelligence decision may consume — no
 * decision engine resolves league/settings/FAAB directly. Facts (World) arrive already loaded (the
 * read happens in an injected loader, Context Resolution's data-loading seam); the recommender input
 * (roster/availablePlayers/teamNeeds) arrives from the caller. This module only shapes them. No
 * prisma, no writes.
 */
import type { DecisionProvenance } from '@/lib/decision-os/core/decision'
import type { WaiverAIServiceInput } from '@/lib/waiver-ai-engine'
import type { WaiverWorld } from './world'

export interface WaiverDCO {
  decision_type: 'manager.waiver.claim'
  world: WaiverWorld
  user: { userId: string }
  league: { leagueId: string; sport: string }
  roster: { rosterId: string | null }
  /** The recommender input the wrapped engine consumes (assembled at the route seam). */
  engineInput: WaiverAIServiceInput
  /** Interpreted resource context (mirrors world.resources for decision convenience). */
  claim_context: {
    faabRemaining: number | null
    waiverPriority: number | null
    availableCandidateCount: number
    rosterSize: number
  }
  confidence_inputs: { topCompositeScore: number | null; lowConfidencePool: boolean }
  provenance: DecisionProvenance
  /** 0–100. */
  data_completeness: number
  uncertainty: string[]
  simulation_available: boolean
}

export interface WaiverDCOInput {
  world: WaiverWorld
  userId: string
  leagueId: string
  sport: string
  rosterId: string | null
  engineInput: WaiverAIServiceInput
  /** When the available-pool / provider data was incomplete. */
  poolIncomplete?: boolean
}

/** Pure, read-only DCO assembly with honest provenance + completeness. */
export function buildWaiverDCO(input: WaiverDCOInput): WaiverDCO {
  const available = input.engineInput.availablePlayers ?? []
  const roster = input.engineInput.roster ?? []
  const lowConfidencePool = available.some((p) => p.lowConfidence === true)

  const uncertainty: string[] = []
  if (input.world.submission.uncertainty) uncertainty.push(input.world.submission.uncertainty)
  if (!input.world.facts.settingsKnown) uncertainty.push('League waiver settings fell back to sport/variant defaults.')
  if (input.world.resources.faabRemaining == null && input.world.facts.waiverType === 'faab') {
    uncertainty.push('FAAB remaining could not be verified.')
  }
  if (lowConfidencePool) uncertainty.push('Some available players have low-confidence provider data.')
  if (available.length === 0) uncertainty.push('No available players were supplied to evaluate.')

  // Weakest required input drives completeness/provenance (honesty contract).
  const weakest: DecisionProvenance =
    !input.world.facts.settingsKnown || input.poolIncomplete
      ? { weakest_source: 'provider', weakest_trust: 'low' }
      : lowConfidencePool
        ? { weakest_source: 'provider', weakest_trust: 'medium' }
        : { weakest_source: 'derived', weakest_trust: 'high' }
  let data_completeness = 100
  if (!input.world.facts.settingsKnown) data_completeness = Math.min(data_completeness, 70)
  if (input.poolIncomplete) data_completeness = Math.min(data_completeness, 60)
  if (lowConfidencePool) data_completeness = Math.min(data_completeness, 85)
  if (available.length === 0) data_completeness = Math.min(data_completeness, 40)

  return {
    decision_type: 'manager.waiver.claim',
    world: input.world,
    user: { userId: input.userId },
    league: { leagueId: input.leagueId, sport: input.sport },
    roster: { rosterId: input.rosterId },
    engineInput: input.engineInput,
    claim_context: {
      faabRemaining: input.world.resources.faabRemaining,
      waiverPriority: input.world.resources.waiverPriority,
      availableCandidateCount: available.length,
      rosterSize: roster.length,
    },
    confidence_inputs: { topCompositeScore: null, lowConfidencePool },
    provenance: weakest,
    data_completeness,
    uncertainty,
    simulation_available: false, // Slice 2 placeholder
  }
}
