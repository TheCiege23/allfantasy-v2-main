/**
 * BEST BALL DEPTH ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Best ball wins on DEPTH: enough bodies at each position to cover byes, injuries, and
 * spike-week rotation in the AUTO lineup. Flags FRAGILE positions (so few players that a
 * single injury/bye compromises the auto lineup) and reports a depth score per position.
 */

import type { BestBallPlayerFact, BestBallWarRoomContext } from './types'

export interface PositionDepth {
  position: string
  count: number
  startingNeed: number
  /** Bodies beyond the auto-start need. */
  surplus: number
  fragile: boolean
  injuredCount: number
}

export interface BestBallDepthResult {
  rosterId: string
  byPosition: PositionDepth[]
  fragilePositions: string[]
  riskFlags: string[]
  missingDataFlags: string[]
}

export function evaluateDepth(context: BestBallWarRoomContext, rosterId: string): BestBallDepthResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  if (!team) {
    return { rosterId, byPosition: [], fragilePositions: [], riskFlags: [], missingDataFlags: ['Roster not found in this league.'] }
  }

  const counts: Record<string, BestBallPlayerFact[]> = {}
  for (const p of team.players) (counts[p.position] ??= []).push(p)

  const required = context.roster.requiredByPosition
  const flexDemand: Record<string, number> = {}
  for (const flex of context.roster.flexSlots) {
    const per = flex.count / Math.max(1, flex.allowedPositions.length)
    for (const pos of flex.allowedPositions) flexDemand[pos] = (flexDemand[pos] ?? 0) + per
  }

  const positions = new Set<string>([...Object.keys(required), ...Object.keys(counts), ...Object.keys(flexDemand)])
  const byPosition: PositionDepth[] = []
  const fragilePositions: string[] = []
  const riskFlags: string[] = []

  for (const pos of positions) {
    const players = counts[pos] ?? []
    const count = players.length
    const startingNeed = Math.max(1, Math.round((required[pos] ?? 0) + (flexDemand[pos] ?? 0)))
    if ((required[pos] ?? 0) === 0 && (flexDemand[pos] ?? 0) === 0 && count === 0) continue
    const surplus = count - startingNeed
    const injuredCount = players.filter((p) => p.injuryStatus && !/^(healthy|active|ok)$/i.test(p.injuryStatus)).length
    // Fragile: at most one body beyond the auto-start need (no buffer for bye/injury).
    const fragile = surplus <= 1 && startingNeed > 0
    byPosition.push({ position: pos, count, startingNeed, surplus, fragile, injuredCount })
    if (fragile) {
      fragilePositions.push(pos)
      riskFlags.push(`${pos}: ${count} on the roster for about ${Math.ceil(startingNeed)} lineup spot${Math.ceil(startingNeed) === 1 ? '' : 's'} a week — one bye or injury leaves the lineup short.`)
    }
    if (injuredCount > 0 && count - injuredCount < startingNeed) {
      riskFlags.push(`${pos} has ${injuredCount} non-healthy player(s), dropping healthy depth below the start need.`)
    }
  }

  return {
    rosterId,
    byPosition: byPosition.sort((a, b) => a.position.localeCompare(b.position)),
    fragilePositions: [...new Set(fragilePositions)],
    riskFlags: [...new Set(riskFlags)],
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}
