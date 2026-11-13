/**
 * BEST BALL DRAFT-PLAN ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Pre-draft / mid-draft: which positions to TARGET to reach a sound best-ball build
 * (auto-start needs + recommended depth buffer). Post-draft: a construction summary with
 * the positions that ended up thin. Best ball is draft-centric — this is the core planning
 * surface. No future picks, no manual lineup.
 */

import { evaluateRosterConstruction } from './bestBallRosterConstructionEngine'
import type { BestBallWarRoomContext } from './types'

interface BestBallDraftTarget {
  position: string
  priority: 'high' | 'medium' | 'low'
  have: number
  target: number
  reason: string
}

export interface BestBallDraftPlanResult {
  rosterId: string
  draftComplete: boolean
  rosterSize: number
  recommendedRosterSize: number
  picksRemaining: number
  targets: BestBallDraftTarget[]
  explanationFacts: string[]
  missingDataFlags: string[]
}

export function buildBestBallDraftPlan(context: BestBallWarRoomContext, rosterId: string): BestBallDraftPlanResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  const recommendedRosterSize = context.roster.recommendedRosterSize
  if (!team) {
    return {
      rosterId,
      draftComplete: context.draftComplete,
      rosterSize: 0,
      recommendedRosterSize,
      picksRemaining: recommendedRosterSize,
      targets: [],
      explanationFacts: ['Roster not found in this league.'],
      missingDataFlags,
    }
  }

  const construction = evaluateRosterConstruction(context, rosterId)
  const rosterSize = team.players.length
  const picksRemaining = Math.max(0, recommendedRosterSize - rosterSize)

  // Target depth = auto-start need + a best-ball buffer (≈1.5x, min +2) per position.
  const counts: Record<string, number> = {}
  for (const p of team.players) counts[p.position] = (counts[p.position] ?? 0) + 1
  const targets: BestBallDraftTarget[] = []
  for (const build of construction.byPosition) {
    const targetDepth = Math.max(build.startingNeed + 2, Math.ceil(build.startingNeed * 1.5))
    const have = counts[build.position] ?? 0
    if (have >= targetDepth) continue
    const gap = targetDepth - have
    const priority: BestBallDraftTarget['priority'] = build.state === 'thin' ? 'high' : gap >= 2 ? 'medium' : 'low'
    targets.push({
      position: build.position,
      priority,
      have,
      target: targetDepth,
      reason:
        build.state === 'thin'
          ? `Thin at ${build.position} (${have}) — prioritize to protect the auto lineup.`
          : `Add ${gap} more ${build.position} to reach a best-ball depth buffer (${targetDepth}).`,
    })
  }
  const rank = (p: BestBallDraftTarget['priority']) => (p === 'high' ? 0 : p === 'medium' ? 1 : 2)
  targets.sort((a, b) => rank(a.priority) - rank(b.priority))

  const facts: string[] = []
  if (context.draftComplete) facts.push('Draft complete — plan reflects post-draft construction gaps, not live picks.')
  else facts.push(`~${picksRemaining} pick(s) remaining to reach the recommended ${recommendedRosterSize}-man roster.`)
  if (targets.length === 0) facts.push('Positional depth targets are met across the board.')

  return {
    rosterId,
    draftComplete: context.draftComplete,
    rosterSize,
    recommendedRosterSize,
    picksRemaining,
    targets,
    explanationFacts: facts,
    missingDataFlags: [...new Set([...missingDataFlags, ...construction.missingDataFlags])],
  }
}
