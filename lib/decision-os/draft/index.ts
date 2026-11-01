/**
 * Decision OS — `manager.draft.pick` orchestrator + barrel.
 *
 * World (from the live session snapshot) → DCO (with Draft OS's assembled engine input) →
 * Decision. Prisma reads happen at the route seam, never here, so this runs without a DB.
 *
 * No shadow/parity yet: the room's current helper calls the same engine with its own client-side
 * pool, so a parity gate would compare two pools, not two decisions. See DECISION_REGISTRY.md.
 */
import type { Decision } from '@/lib/decision-os/core/decision'
import type { RecommendationInput } from '@/lib/draft-helper/RecommendationEngine'
import { resolveDraftWorld, type DraftWorld, type DraftWorldInput } from './world'
import { buildDraftDCO, type DraftAssemblyCoverage } from './dco'
import { decideDraftPick, type DraftDecisionDeps, type DraftPickRecommendation } from './decision'

export * from './world'
export * from './dco'
export * from './rules'
export * from './decision'

export interface RunDraftPickInput {
  worldInput: DraftWorldInput
  userId: string
  leagueId: string
  sport: string
  engineInput: RecommendationInput
  coverage: DraftAssemblyCoverage
}

export interface RunDraftPickResult {
  world: DraftWorld
  decision: Decision<DraftPickRecommendation>
}

export async function runDraftPickDecision(input: RunDraftPickInput, deps: DraftDecisionDeps): Promise<RunDraftPickResult> {
  const world = resolveDraftWorld(input.worldInput)
  const dco = buildDraftDCO({
    world,
    userId: input.userId,
    leagueId: input.leagueId,
    sport: input.sport,
    engineInput: input.engineInput,
    coverage: input.coverage,
  })
  const decision = await decideDraftPick(dco, deps)
  return { world, decision }
}
