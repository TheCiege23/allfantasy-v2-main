/**
 * BEST BALL ROSTER CONSTRUCTION ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Grades how a best-ball roster is BUILT: positional counts vs the auto-lineup slot needs
 * (dedicated + flex), total roster size vs the recommended size, and over/under-investment
 * by position. Best ball is draft-only — this is about construction, not start/sit.
 */

import type { BestBallPlayerFact, BestBallWarRoomContext } from './types'

export interface PositionBuild {
  position: string
  count: number
  startingNeed: number
  /** 'thin' (≤need), 'balanced', or 'heavy' (≥need+3). */
  state: 'thin' | 'balanced' | 'heavy'
}

export interface BestBallConstructionResult {
  rosterId: string
  rosterSize: number
  recommendedRosterSize: number
  startingSlots: number
  byPosition: PositionBuild[]
  /** Coarse construction grade A–D from balance + size. */
  grade: string
  strengths: string[]
  weaknesses: string[]
  overInvested: string[]
  underInvested: string[]
  explanationFacts: string[]
  missingDataFlags: string[]
}

function countByPosition(players: BestBallPlayerFact[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const p of players) m[p.position] = (m[p.position] ?? 0) + 1
  return m
}

export function evaluateRosterConstruction(context: BestBallWarRoomContext, rosterId: string): BestBallConstructionResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  if (!team) {
    return {
      rosterId,
      rosterSize: 0,
      recommendedRosterSize: context.roster.recommendedRosterSize,
      startingSlots: context.roster.startingSlots,
      byPosition: [],
      grade: 'N/A',
      strengths: [],
      weaknesses: [],
      overInvested: [],
      underInvested: [],
      explanationFacts: ['Roster not found in this league.'],
      missingDataFlags,
    }
  }

  const counts = countByPosition(team.players)
  const required = context.roster.requiredByPosition
  // FLEX demand spread across eligible positions (best-ball flex is auto-filled).
  const flexDemand: Record<string, number> = {}
  for (const flex of context.roster.flexSlots) {
    const per = flex.count / Math.max(1, flex.allowedPositions.length)
    for (const pos of flex.allowedPositions) flexDemand[pos] = (flexDemand[pos] ?? 0) + per
  }

  const positions = new Set<string>([...Object.keys(required), ...Object.keys(counts), ...Object.keys(flexDemand)])
  const byPosition: PositionBuild[] = []
  const strengths: string[] = []
  const weaknesses: string[] = []
  const overInvested: string[] = []
  const underInvested: string[] = []
  const facts: string[] = []

  for (const pos of positions) {
    const count = counts[pos] ?? 0
    const startingNeed = Math.round(((required[pos] ?? 0) + (flexDemand[pos] ?? 0)) * 10) / 10
    if (startingNeed <= 0 && count === 0) continue
    let state: PositionBuild['state']
    if (count <= startingNeed) state = 'thin'
    else if (count >= startingNeed + 3) state = 'heavy'
    else state = 'balanced'
    byPosition.push({ position: pos, count, startingNeed, state })
    if (state === 'thin') {
      // Plain words (2026-11-23): this read "TE: 1 rostered for ~1.3 auto-start slot(s) — thin for spike-week coverage".
      weaknesses.push(`${pos}: ${count} on the roster for about ${Math.ceil(startingNeed)} lineup spot${Math.ceil(startingNeed) === 1 ? '' : 's'} a week — too few to cover a bye or a quiet week.`)
      underInvested.push(pos)
      facts.push(`${pos} thin (${count} vs ~${startingNeed}).`)
    } else if (state === 'heavy') {
      overInvested.push(pos)
      facts.push(`${pos} heavy (${count} vs ~${startingNeed}).`)
    } else {
      strengths.push(`${pos} balanced (${count} for ~${startingNeed} slot(s)).`)
    }
  }

  // Grade: penalize thin positions; mild penalty for size deficit.
  const rosterSize = team.players.length
  let score = 100
  score -= underInvested.length * 14
  score -= overInvested.length * 4
  if (rosterSize < context.roster.recommendedRosterSize) score -= Math.min(20, (context.roster.recommendedRosterSize - rosterSize) * 4)
  const grade = score >= 90 ? 'A' : score >= 80 ? 'A-' : score >= 72 ? 'B' : score >= 62 ? 'C' : score >= 50 ? 'D' : 'F'

  if (rosterSize < context.roster.recommendedRosterSize)
    facts.push(`Roster size ${rosterSize} vs recommended ${context.roster.recommendedRosterSize}.`)

  return {
    rosterId,
    rosterSize,
    recommendedRosterSize: context.roster.recommendedRosterSize,
    startingSlots: context.roster.startingSlots,
    byPosition: byPosition.sort((a, b) => a.position.localeCompare(b.position)),
    grade,
    strengths: [...new Set(strengths)],
    weaknesses: [...new Set(weaknesses)],
    overInvested: [...new Set(overInvested)],
    underInvested: [...new Set(underInvested)],
    explanationFacts: facts,
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}

export function evaluateUserRosterConstruction(context: BestBallWarRoomContext): BestBallConstructionResult | null {
  if (!context.userRosterId) return null
  return evaluateRosterConstruction(context, context.userRosterId)
}
