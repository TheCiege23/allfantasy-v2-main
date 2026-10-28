/**
 * Decision OS — Decision Context Object for `manager.draft.pick`.
 *
 * The only thing the draft decision consumes. The engine input arrives already assembled by
 * Draft OS (`buildDraftDecisionContext`, the same assembly `/api/draft/recommend`'s engine and
 * Chimmy's draft grounding use), so there is exactly one way a draft room's pool, roster and ADP
 * become a recommendation. This module only shapes it and scores how complete it is. No prisma.
 */
import type { DecisionProvenance } from '@/lib/decision-os/core/decision'
import type { RecommendationInput } from '@/lib/draft-helper/RecommendationEngine'
import type { DraftWorld } from './world'

/** What Draft OS reports about its own assembly (`DraftDecisionContext.dataCompleteness`). */
export interface DraftAssemblyCoverage {
  availablePoolSize: number
  /** Drafts in this league's AllFantasy ADP sample; 0 means ranks fall back to market/AI boards. */
  adpSampleTotal: number
  rosterPickCount: number
  unresolvedPlayerIdCount: number
}

export interface DraftDCO {
  decision_type: 'manager.draft.pick'
  world: DraftWorld
  user: { userId: string }
  league: { leagueId: string; sport: string }
  roster: { rosterId: string }
  engineInput: RecommendationInput
  coverage: DraftAssemblyCoverage
  provenance: DecisionProvenance
  /** 0–100: how complete the inputs were. Separate from confidence. */
  data_completeness: number
  uncertainty: string[]
}

export interface DraftDCOInput {
  world: DraftWorld
  userId: string
  leagueId: string
  sport: string
  engineInput: RecommendationInput
  coverage: DraftAssemblyCoverage
}

/** A pool this small cannot support a ranking worth calling a decision. */
export const THIN_POOL_SIZE = 20

export function buildDraftDCO(input: DraftDCOInput): DraftDCO {
  const { coverage, engineInput } = input
  const uncertainty: string[] = []
  let completeness = 100
  let weakest: DecisionProvenance = { weakest_source: 'draft_session', weakest_trust: 'authoritative' }

  if (coverage.availablePoolSize === 0) {
    completeness -= 60
    uncertainty.push('No available players could be loaded for this draft.')
    weakest = { weakest_source: 'player_pool', weakest_trust: 'unverified' }
  } else if (coverage.availablePoolSize < THIN_POOL_SIZE) {
    completeness -= 30
    uncertainty.push(`Only ${coverage.availablePoolSize} available players could be ranked.`)
    weakest = { weakest_source: 'player_pool', weakest_trust: 'low' }
  }

  if (coverage.adpSampleTotal === 0) {
    completeness -= 20
    uncertainty.push('This league has no AllFantasy ADP sample yet, so ranks lean on market ADP.')
    if (weakest.weakest_trust === 'authoritative') weakest = { weakest_source: 'adp', weakest_trust: 'medium' }
  }

  const available = engineInput.available ?? []
  const projected = available.filter((p) => typeof p.projectedPoints === 'number').length
  if (available.length > 0 && projected / available.length < 0.25) {
    completeness -= 15
    uncertainty.push('Few available players carry projections, so value leans on ADP gaps.')
    if (weakest.weakest_trust === 'authoritative') weakest = { weakest_source: 'projections', weakest_trust: 'medium' }
  }

  if (coverage.availablePoolSize > 0 && coverage.unresolvedPlayerIdCount / coverage.availablePoolSize > 0.5) {
    completeness -= 10
    uncertainty.push('Most ranked players could not be matched to a player record.')
  }

  return {
    decision_type: 'manager.draft.pick',
    world: input.world,
    user: { userId: input.userId },
    league: { leagueId: input.leagueId, sport: input.sport },
    roster: { rosterId: input.world.rosterId },
    engineInput,
    coverage,
    provenance: weakest,
    data_completeness: Math.max(0, Math.min(100, completeness)),
    uncertainty,
  }
}
