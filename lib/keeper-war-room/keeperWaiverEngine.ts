/**
 * KEEPER WAIVER / ADD-DROP ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Only relevant when the keeper league's season is ACTIVE. Ranks free-agent adds by
 * season value + roster need; drop side ranks the weakest rosterable assets. When the
 * season is not active or the pool is unavailable, returns no invented adds and a clear
 * flag. (Mirrors the redraft waiver engine; keeper-cost is not relevant to in-season adds.)
 */

import { playerSeasonValue, type SeasonValueSource } from './keeperValueEngine'
import { evaluateKeeperRosterNeeds } from './keeperRosterNeedsEngine'
import type { KeeperPlayerFact, KeeperWarRoomContext } from './types'

interface KeeperWaiverAdd {
  playerId: string
  playerName: string
  position: string
  value: number | null
  valueSource: SeasonValueSource
  adp: number | null
  reason: string
}

interface KeeperWaiverDrop {
  playerId: string
  playerName: string
  position: string
  value: number | null
  reason: string
}

export interface KeeperWaiverResult {
  rosterId: string
  recommendedAdds: KeeperWaiverAdd[]
  recommendedDrops: KeeperWaiverDrop[]
  targetPositions: string[]
  riskFlags: string[]
  missingDataFlags: string[]
  needsProviderIntegration: boolean
}

function valueOf(p: KeeperPlayerFact): { value: number | null; source: SeasonValueSource } {
  const v = playerSeasonValue(p)
  return { value: v.source === 'none' ? null : v.value, source: v.source }
}

export function buildKeeperWaiverRecommendations(context: KeeperWarRoomContext, rosterId: string): KeeperWaiverResult {
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
      missingDataFlags: ['Roster not found in this season.'],
      needsProviderIntegration: true,
    }
  }

  if (!context.seasonActive) {
    missingDataFlags.push('Season is not active — waiver/free-agent moves are not in play yet (focus on keeper declarations + draft plan).')
    return { rosterId, recommendedAdds: [], recommendedDrops: [], targetPositions: [], riskFlags, missingDataFlags: [...new Set(missingDataFlags)], needsProviderIntegration: true }
  }

  const needs = evaluateKeeperRosterNeeds(context, rosterId)
  const targetPositions = needs.draftTargetPositions
  const targetSet = new Set(targetPositions)

  const dropCandidates = team.players
    .filter((p) => !p.isStarterSlot || team.players.length > context.roster.totalStarterSlots)
    .map((p) => ({ p, ...valueOf(p) }))
    .sort((a, b) => (a.value ?? -1) - (b.value ?? -1))
  const recommendedDrops: KeeperWaiverDrop[] = dropCandidates.slice(0, 3).map(({ p, value }) => ({
    playerId: p.playerId,
    playerName: p.playerName,
    position: p.position,
    value: value == null ? null : Math.round(value * 100) / 100,
    reason: value == null ? `Lowest-confidence asset${p.injuryStatus ? `, listed ${p.injuryStatus}` : ''}.` : `Among the weakest rosterable values (${value.toFixed(1)}).`,
  }))

  const needsProviderIntegration = context.availability.freeAgentPool !== 'available'
  let recommendedAdds: KeeperWaiverAdd[] = []
  if (needsProviderIntegration) {
    missingDataFlags.push('Free-agent pool unavailable — specific add targets cannot be listed.')
  } else {
    recommendedAdds = context.freeAgents
      .map((p) => ({ p, ...valueOf(p), atNeed: targetSet.has(p.position) }))
      .sort((a, b) => {
        if (a.atNeed !== b.atNeed) return a.atNeed ? -1 : 1
        return (b.value ?? -1) - (a.value ?? -1)
      })
      .slice(0, 5)
      .map(({ p, value, source, atNeed }) => ({
        playerId: p.playerId,
        playerName: p.playerName,
        position: p.position,
        value: value == null ? null : Math.round(value * 100) / 100,
        valueSource: source,
        adp: p.adp,
        reason: `${atNeed ? `Fills ${p.position} need` : `Best available ${p.position}`}${p.adp != null ? ` (ADP ${p.adp.toFixed(1)})` : ''}.`,
      }))
  }

  if (needs.needs.some((n) => n.severity === 'critical')) riskFlags.push('Critical post-keeper starting hole — prioritize a startable add.')

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
