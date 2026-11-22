/**
 * REDRAFT TEAM NEEDS ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Evaluates a single roster against the league's required starting slots and
 * surfaces needs/strengths/weaknesses with explanation facts and missing-data flags.
 * Redraft-only: season-horizon framing, no dynasty/age/asset logic.
 */

import { playerValue as sharedPlayerValue } from './playerValue'
import type { RedraftPlayerFact, RedraftWarRoomContext } from './types'

interface TeamNeed {
  position: string
  severity: 'critical' | 'high' | 'moderate'
  reason: string
}

export interface TeamNeedsResult {
  rosterId: string
  needs: TeamNeed[]
  strengths: string[]
  weaknesses: string[]
  /** 0-100; higher = more urgent roster action needed. */
  urgencyScore: number
  tradeTargetPositions: string[]
  explanationFacts: string[]
  missingDataFlags: string[]
}

function countByPosition(players: RedraftPlayerFact[]): Record<string, RedraftPlayerFact[]> {
  const map: Record<string, RedraftPlayerFact[]> = {}
  for (const p of players) {
    ;(map[p.position] ??= []).push(p)
  }
  return map
}

export function evaluateTeamNeeds(
  context: RedraftWarRoomContext,
  rosterId: string,
): TeamNeedsResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  if (!team) {
    return {
      rosterId,
      needs: [],
      strengths: [],
      weaknesses: [],
      urgencyScore: 0,
      tradeTargetPositions: [],
      explanationFacts: ['Roster not found in this season.'],
      missingDataFlags,
    }
  }

  const facts: string[] = []
  const needs: TeamNeed[] = []
  const strengths: string[] = []
  const weaknesses: string[] = []
  const tradeTargetPositions: string[] = []

  const byPos = countByPosition(team.players)
  const required = context.roster.requiredByPosition
  const hasValueSignal = context.availability.tradeValues === 'available'

  // 1) Roster holes vs. required starting slots.
  for (const [pos, need] of Object.entries(required)) {
    const have = (byPos[pos] ?? []).length
    if (have < need) {
      needs.push({
        position: pos,
        severity: have === 0 ? 'critical' : 'high',
        reason: `${have} rostered ${pos}${have === 1 ? '' : 's'} for ${need} required starting slot(s).`,
      })
      tradeTargetPositions.push(pos)
      facts.push(`${pos}: ${have} rostered vs ${need} starting slot(s).`)
    } else if (have === need) {
      weaknesses.push(`${pos} has no bench depth behind ${need} starter slot(s).`)
    } else if (have >= need + 2) {
      strengths.push(`${pos} is deep (${have} rostered for ${need} slot(s)).`)
    }
  }

  // 2) Bye-week stacking among starters (schedule-independent — uses byeWeek facts).
  const byeBuckets = new Map<number, RedraftPlayerFact[]>()
  for (const p of team.players) {
    if (p.isStarterSlot && p.byeWeek != null) {
      const bucket = byeBuckets.get(p.byeWeek) ?? []
      bucket.push(p)
      byeBuckets.set(p.byeWeek, bucket)
    }
  }
  for (const [byeWeek, players] of byeBuckets) {
    if (players.length >= 3) {
      weaknesses.push(`${players.length} starters share a Week ${byeWeek} bye.`)
      facts.push(`Bye stack Week ${byeWeek}: ${players.map((p) => p.playerName).join(', ')}.`)
    }
  }

  // 3) Injury flags among starters (status only — no medical certainty).
  const injured = team.players.filter(
    (p) => p.isStarterSlot && p.injuryStatus && !/^(healthy|active|ok)$/i.test(p.injuryStatus),
  )
  for (const p of injured) {
    weaknesses.push(`${p.playerName} (${p.position}) listed ${p.injuryStatus}.`)
    if (!tradeTargetPositions.includes(p.position)) tradeTargetPositions.push(p.position)
  }
  if (injured.length > 0) facts.push(`${injured.length} starter(s) carry a non-healthy injury status.`)

  // 4) Positional value strength (only when a value signal exists).
  if (hasValueSignal) {
    for (const [pos, players] of Object.entries(byPos)) {
      let bestScore = 0
      let bestSource: ReturnType<typeof sharedPlayerValue>['source'] = 'none'
      let bestAdp: number | null = null
      for (const p of players) {
        const v = sharedPlayerValue(p)
        if (v.source !== 'none' && v.value > bestScore) {
          bestScore = v.value
          bestSource = v.source
          bestAdp = p.adp
        }
      }
      if (bestScore >= 15) {
        if (bestSource === 'adp' && bestAdp != null) {
          strengths.push(`${pos} anchored by a top-ADP player (ADP ${bestAdp.toFixed(1)}).`)
        } else if (bestSource === 'projection' || bestSource === 'season_avg') {
          strengths.push(`${pos} anchored by a high-output starter (${bestScore.toFixed(1)} pts).`)
        }
      }
    }
  } else {
    missingDataFlags.push('Position strength is structural only — no projection/stat/ranking signal to rank player quality.')
  }

  // 5) Playoff-push context.
  if (context.availability.standings === 'available') {
    const games = team.wins + team.losses + team.ties
    const winPct = games > 0 ? team.wins / games : 0
    const weeksLeft = Math.max(0, context.playoffStartWeek - Math.max(1, context.currentWeek))
    if (team.isEliminated) {
      facts.push('Team is eliminated from playoff contention.')
    } else if (winPct < 0.4 && weeksLeft <= 4 && games > 0) {
      facts.push(`Playoff push urgent: ${team.wins}-${team.losses} with ~${weeksLeft} week(s) to the playoffs.`)
    } else if (winPct >= 0.6) {
      strengths.push(`Strong record (${team.wins}-${team.losses}) — protect the lead.`)
    }
  }

  // Urgency score: weighted by need severity, injuries, bye stacks, and playoff pressure.
  let urgency = 0
  for (const n of needs) urgency += n.severity === 'critical' ? 30 : n.severity === 'high' ? 18 : 8
  urgency += injured.length * 10
  urgency += [...byeBuckets.values()].filter((p) => p.length >= 3).length * 8
  if (context.availability.standings === 'available' && !team.isEliminated) {
    const games = team.wins + team.losses + team.ties
    const winPct = games > 0 ? team.wins / games : 0.5
    if (winPct < 0.4 && games > 0) urgency += 12
  }
  const urgencyScore = Math.min(100, urgency)

  if (needs.length === 0 && weaknesses.length === 0) {
    facts.push('No structural roster holes detected against required starting slots.')
  }

  return {
    rosterId,
    needs,
    strengths: [...new Set(strengths)],
    weaknesses: [...new Set(weaknesses)],
    urgencyScore,
    tradeTargetPositions: [...new Set(tradeTargetPositions)],
    explanationFacts: facts,
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}

/** Convenience: needs for the viewer's own team (or null when they have none). */
export function evaluateUserTeamNeeds(context: RedraftWarRoomContext): TeamNeedsResult | null {
  if (!context.userRosterId) return null
  return evaluateTeamNeeds(context, context.userRosterId)
}

