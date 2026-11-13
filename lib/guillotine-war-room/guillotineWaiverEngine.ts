/**
 * GUILLOTINE WAIVER ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Survival-first add/drop. Urgency scales with elimination risk: a chop-zone team should act
 * on floor/upside upgrades now; a safe team should mostly stand pat. Targets the roster's
 * weakest starting positions; drop candidates are the lowest-floor rosterable assets. Add
 * candidates come from the eliminated-team dropped pool when available (else target positions
 * only — never invents a free-agent list).
 */

import { playerValue } from './guillotineValue'
import { evaluateSurvivalRisk } from './guillotineSurvivalRiskEngine'
import { evaluateRosterRisk } from './guillotineRosterRiskEngine'
import type { GuillotinePlayerFact, GuillotineWarRoomContext } from './types'

interface GuillotineWaiverAdd {
  playerId: string
  playerName: string
  position: string
  adp: number | null
  fromEliminatedRoster: boolean
  reason: string
}

export interface GuillotineWaiverResult {
  rosterId: string
  urgency: 'high' | 'medium' | 'low'
  targetPositions: string[]
  recommendedAdds: GuillotineWaiverAdd[]
  dropCandidates: Array<{ playerId: string; playerName: string; position: string; value: number | null; reason: string }>
  needsPoolData: boolean
  explanationFacts: string[]
  missingDataFlags: string[]
}

export function buildWaiverRecommendations(context: GuillotineWarRoomContext, rosterId: string): GuillotineWaiverResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  if (!team) {
    return { rosterId, urgency: 'low', targetPositions: [], recommendedAdds: [], dropCandidates: [], needsPoolData: true, explanationFacts: ['Roster not found in this league.'], missingDataFlags }
  }

  const survival = evaluateSurvivalRisk(context, rosterId)
  const roster = evaluateRosterRisk(context, rosterId)
  const urgency: GuillotineWaiverResult['urgency'] =
    survival.riskLevel === 'critical' || survival.riskLevel === 'high' ? 'high' : survival.riskLevel === 'moderate' ? 'medium' : 'low'

  const targetPositions = [...new Set(roster.weaknesses.map((w) => w.position))]
  const targetSet = new Set(targetPositions)

  // Add candidates from the eliminated-team dropped pool (real), need positions first.
  const needsPoolData = context.availability.droppedPlayerPool !== 'available'
  let recommendedAdds: GuillotineWaiverAdd[] = []
  if (!needsPoolData) {
    recommendedAdds = context.droppedPlayers
      .map((d) => ({ d, atNeed: targetSet.has(d.position) }))
      .sort((a, b) => {
        if (a.atNeed !== b.atNeed) return a.atNeed ? -1 : 1
        return (a.d.adp ?? 999) - (b.d.adp ?? 999)
      })
      .slice(0, 6)
      .map(({ d, atNeed }) => ({
        playerId: d.playerId,
        playerName: d.playerName,
        position: d.position,
        adp: d.adp,
        fromEliminatedRoster: d.fromEliminatedRosterId != null,
        reason: `${atNeed ? `Fills ${d.position} need` : `Best available ${d.position}`}${d.adp != null ? ` (ADP ${d.adp.toFixed(1)})` : ''} from an eliminated team's pool.`,
      }))
  } else {
    missingDataFlags.push('No eliminated-team dropped-player pool — specific add targets cannot be listed (target positions still apply).')
  }

  // Drop candidates: lowest-floor rosterable assets.
  const dropCandidates = team.players
    .filter((p) => !p.isStarterSlot || team.players.length > context.roster.totalStarterSlots)
    .map((p: GuillotinePlayerFact) => ({ p, v: playerValue(p) }))
    .sort((a, b) => (a.v.source === 'none' ? -1 : a.v.value) - (b.v.source === 'none' ? -1 : b.v.value))
    .slice(0, 3)
    .map(({ p, v }) => ({
      playerId: p.playerId,
      playerName: p.playerName,
      position: p.position,
      value: v.source === 'none' ? null : Math.round(v.value * 100) / 100,
      reason: v.source === 'none' ? 'Lowest-confidence asset (no value signal).' : `Lowest floor on the roster (${v.value.toFixed(1)}).`,
    }))

  const facts: string[] = []
  if (urgency === 'high') facts.push('High elimination risk — prioritize a survival-relevant add this period.')
  else if (urgency === 'low') facts.push('Safe — stand pat unless an obvious floor upgrade appears; conserve FAAB.')
  if (targetPositions.length) facts.push(`Target positions: ${targetPositions.join(', ')}.`)

  return {
    rosterId,
    urgency,
    targetPositions,
    recommendedAdds,
    dropCandidates,
    needsPoolData,
    explanationFacts: facts,
    missingDataFlags: [...new Set([...missingDataFlags, ...roster.missingDataFlags])],
  }
}
