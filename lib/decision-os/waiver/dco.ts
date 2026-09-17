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
  /**
   * How much of the wire carried a price.
   *
   * ⚠ THE DIFFERENCE BETWEEN "NOBODY QUALIFIES" AND "WE COULD NOT PRICE ANYBODY". The scorer drops
   * every candidate under 200 value, so an unpriced wire produces the same empty result as a wire
   * full of waiver junk. Only this tells the decision which one happened.
   */
  pricing: { priced: number; total: number; basis: string | null }
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
  /** Pricing coverage over the available pool. Absent means the caller did not price it. */
  pricing?: { priced: number; total: number; basis: string | null }
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
  /*
   * A caller that priced the wire says so; one that did not is read from the candidates it supplied,
   * because a value on the candidate IS the price. Defaulting to zero instead would tell a caller
   * with its own prices (the legacy route's client-posted pool) that the wire was unpriced.
   */
  const pricing = input.pricing ?? {
    priced: available.filter((p) => Number((p as { value?: number }).value ?? 0) > 0).length,
    total: available.length,
    basis: null,
  }
  if (available.length > 0 && pricing.priced === 0) {
    uncertainty.push(
      pricing.basis
        ? 'No available player carried a market value in this league, so none could be ranked.'
        : 'This league has no market value set, so the wire could not be priced.',
    )
  } else if (pricing.total > 0 && pricing.priced < pricing.total / 2) {
    uncertainty.push(`Only ${pricing.priced} of ${pricing.total} available players carried a value.`)
  }

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
  /* An unpriced wire is the weakest input there is: nothing can be ranked at all. */
  if (available.length > 0 && pricing.priced === 0) data_completeness = Math.min(data_completeness, 30)
  else if (pricing.total > 0 && pricing.priced < pricing.total / 2) data_completeness = Math.min(data_completeness, 75)

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
    pricing,
    provenance: weakest,
    data_completeness,
    uncertainty,
    simulation_available: false, // Slice 2 placeholder
  }
}
