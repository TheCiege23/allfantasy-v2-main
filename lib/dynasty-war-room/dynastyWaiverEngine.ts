/**
 * DYNASTY WAIVER / ADD-DROP ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Dynasty horizon: ranks free-agent ADDS by long-term value AND age trajectory
 * (young upside is weighted), prioritizing roster needs. DROP side ranks the
 * roster's weakest assets (lowest value, aging/cliff). When the free-agent pool is
 * unavailable, returns NO invented adds — only the grounded drop-side analysis and
 * a clear `needsProviderIntegration` flag.
 */

import { dynastyValue, ageTrajectory, type AgeTrajectory } from './dynastyPlayerValue'
import { evaluateDynastyTeamNeeds } from './dynastyRosterNeedsEngine'
import type { DynastyPlayerFact, DynastyWarRoomContext } from './types'

export interface DynastyWaiverAdd {
  playerId: string
  playerName: string
  position: string
  value: number | null
  age: number | null
  trajectory: AgeTrajectory
  adp: number | null
  reason: string
}

export interface DynastyWaiverDrop {
  playerId: string
  playerName: string
  position: string
  value: number | null
  reason: string
}

export interface DynastyWaiverResult {
  rosterId: string
  recommendedAdds: DynastyWaiverAdd[]
  recommendedDrops: DynastyWaiverDrop[]
  targetPositions: string[]
  riskFlags: string[]
  missingDataFlags: string[]
  needsProviderIntegration: boolean
}

function valueOf(p: DynastyPlayerFact): number | null {
  const v = dynastyValue(p)
  return v.source === 'none' ? null : v.value
}

/** Age-weighted value used to rank stashable young free agents above older ones at equal ADP. */
function stashValue(p: DynastyPlayerFact, sport: string): number | null {
  const v = valueOf(p)
  if (v == null) return null
  const traj = ageTrajectory(p.position, p.age, sport)
  const mult = traj === 'ascending' ? 1.2 : traj === 'prime' ? 1.0 : traj === 'aging' ? 0.85 : traj === 'cliff' ? 0.7 : 1.0
  return v * mult
}

export function buildDynastyWaiverRecommendations(
  context: DynastyWarRoomContext,
  rosterId: string,
): DynastyWaiverResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  const riskFlags: string[] = []
  if (!team) {
    return {
      rosterId,
      recommendedAdds: [],
      recommendedDrops: [],
      targetPositions: [],
      riskFlags: [],
      missingDataFlags: ['Roster not found in this league.'],
      needsProviderIntegration: context.availability.freeAgentPool !== 'available',
    }
  }

  const needs = evaluateDynastyTeamNeeds(context, rosterId)
  const targetPositions = needs.tradeTargetPositions
  const targetSet = new Set(targetPositions)

  // DROP side — weakest, oldest rosterable assets (works without a pool).
  const dropCandidates = team.players
    .filter((p) => !p.isStarterSlot || team.players.length > context.roster.totalStarterSlots)
    .map((p) => ({ p, sv: stashValue(p, context.sport), traj: ageTrajectory(p.position, p.age, context.sport) }))
    .sort((a, b) => (a.sv ?? -1) - (b.sv ?? -1))

  const recommendedDrops: DynastyWaiverDrop[] = dropCandidates.slice(0, 3).map(({ p, traj }) => {
    const v = valueOf(p)
    const ageFrag = traj === 'aging' || traj === 'cliff' ? `, ${traj}${p.age != null ? ` at ${p.age}` : ''}` : ''
    return {
      playerId: p.playerId,
      playerName: p.playerName,
      position: p.position,
      value: v == null ? null : Math.round(v * 100) / 100,
      reason:
        v == null
          ? `Lowest-confidence asset (no value signal)${ageFrag}${p.injuryStatus ? `, listed ${p.injuryStatus}` : ''}.`
          : `Among the weakest dynasty assets (value ${v.toFixed(1)})${ageFrag}.`,
    }
  })

  const needsProviderIntegration = context.availability.freeAgentPool !== 'available'
  let recommendedAdds: DynastyWaiverAdd[] = []
  if (needsProviderIntegration) {
    missingDataFlags.push(
      'Waiver add targets unavailable: free-agent pool not available for this sport/season. Drop-side analysis and target positions are still grounded in your roster.',
    )
  } else {
    recommendedAdds = context.freeAgents
      .map((p) => ({ p, sv: stashValue(p, context.sport), atNeed: targetSet.has(p.position), traj: ageTrajectory(p.position, p.age, context.sport) }))
      .sort((a, b) => {
        if (a.atNeed !== b.atNeed) return a.atNeed ? -1 : 1
        return (b.sv ?? -1) - (a.sv ?? -1)
      })
      .slice(0, 6)
      .map(({ p, atNeed, traj }) => {
        const v = valueOf(p)
        const needFrag = atNeed ? `Fills ${p.position} need` : `Best available ${p.position}`
        const ageFrag = traj === 'ascending' ? ', ascending age curve' : traj === 'cliff' ? ', past prime' : ''
        return {
          playerId: p.playerId,
          playerName: p.playerName,
          position: p.position,
          value: v == null ? null : Math.round(v * 100) / 100,
          age: p.age,
          trajectory: traj,
          adp: p.adp ?? null,
          reason: `${needFrag}${p.adp != null ? ` (ADP ${p.adp.toFixed(1)})` : ''}${ageFrag}.`,
        }
      })
  }

  if (needs.needs.some((n) => n.severity === 'critical')) {
    riskFlags.push('Critical starting-slot hole — prioritize a startable add over a stash.')
  }

  return {
    rosterId,
    recommendedAdds,
    recommendedDrops,
    targetPositions,
    riskFlags,
    missingDataFlags: [...new Set(missingDataFlags)],
    needsProviderIntegration,
  }
}
