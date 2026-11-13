/**
 * GUILLOTINE DROPPED-PLAYER ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * When teams are chopped, their rosters are RELEASED to the pool — often the strongest
 * waiver value in a guillotine league. This engine ranks the real eliminated-team pool
 * (`GuillotineWaiverRelease`) by ADP value, flagging which entries address the user's weak
 * positions. Returns a truthful limited state when no dropped pool exists yet.
 */

import { evaluateRosterRisk } from './guillotineRosterRiskEngine'
import type { GuillotineWarRoomContext } from './types'

interface GuillotineDroppedRanking {
  playerId: string
  playerName: string
  position: string
  team: string | null
  adp: number | null
  atNeed: boolean
  availableAt: string | null
  note: string
}

export interface GuillotineDroppedPlayerResult {
  rosterId: string
  available: boolean
  poolSize: number
  targets: GuillotineDroppedRanking[]
  explanationFacts: string[]
  missingDataFlags: string[]
}

export function evaluateDroppedPlayers(context: GuillotineWarRoomContext, rosterId: string): GuillotineDroppedPlayerResult {
  const missingDataFlags = [...context.missingDataFlags]
  if (context.availability.droppedPlayerPool !== 'available') {
    return {
      rosterId,
      available: false,
      poolSize: 0,
      targets: [],
      explanationFacts: ['No eliminated-team dropped-player pool is available yet — once a team is chopped, its players release here.'],
      missingDataFlags: [...new Set(missingDataFlags)],
    }
  }

  const targetPositions = new Set(evaluateRosterRisk(context, rosterId).weaknesses.map((w) => w.position))
  const targets: GuillotineDroppedRanking[] = context.droppedPlayers
    .map((d) => ({ d, atNeed: targetPositions.has(d.position) }))
    .sort((a, b) => {
      if (a.atNeed !== b.atNeed) return a.atNeed ? -1 : 1
      return (a.d.adp ?? 999) - (b.d.adp ?? 999)
    })
    .slice(0, 12)
    .map(({ d, atNeed }) => ({
      playerId: d.playerId,
      playerName: d.playerName,
      position: d.position,
      team: d.team,
      adp: d.adp,
      atNeed,
      availableAt: d.availableAt,
      note: `${atNeed ? `Addresses your ${d.position} weakness` : `${d.position} depth`}${d.adp != null ? ` (ADP ${d.adp.toFixed(1)})` : ''}.`,
    }))

  const facts: string[] = [`${context.droppedPlayers.length} player(s) in the eliminated-team pool.`]
  const atNeedCount = targets.filter((t) => t.atNeed).length
  if (atNeedCount) facts.push(`${atNeedCount} address a current weakness — strong survival-relevant adds.`)

  return {
    rosterId,
    available: true,
    poolSize: context.droppedPlayers.length,
    targets,
    explanationFacts: facts,
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}
