/**
 * DYNASTY ROSTER NEEDS ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Evaluates a single roster on a DYNASTY horizon: positional holes vs required
 * starting slots, AGE concentration (too many aging/cliff starters at a position),
 * and long-term value depth. Surfaces needs/strengths/weaknesses + trade-target
 * positions. Unlike redraft, this weighs age trajectory and asset value, not weekly
 * output or bye weeks.
 */

import { dynastyValue, ageTrajectory } from './dynastyPlayerValue'
import type { DynastyPlayerFact, DynastyWarRoomContext } from './types'

export interface DynastyTeamNeed {
  position: string
  severity: 'critical' | 'high' | 'moderate'
  reason: string
}

export interface DynastyNeedsResult {
  rosterId: string
  needs: DynastyTeamNeed[]
  strengths: string[]
  weaknesses: string[]
  /** 0-100; higher = more long-term roster work needed. */
  urgencyScore: number
  tradeTargetPositions: string[]
  explanationFacts: string[]
  missingDataFlags: string[]
}

function countByPosition(players: DynastyPlayerFact[]): Record<string, DynastyPlayerFact[]> {
  const map: Record<string, DynastyPlayerFact[]> = {}
  for (const p of players) (map[p.position] ??= []).push(p)
  return map
}

function valueOf(p: DynastyPlayerFact): number | null {
  const v = dynastyValue(p)
  return v.source === 'none' ? null : v.value
}

export function evaluateDynastyTeamNeeds(
  context: DynastyWarRoomContext,
  rosterId: string,
): DynastyNeedsResult {
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
      explanationFacts: ['Roster not found in this league.'],
      missingDataFlags,
    }
  }

  const facts: string[] = []
  const needs: DynastyTeamNeed[] = []
  const strengths: string[] = []
  const weaknesses: string[] = []
  const tradeTargetPositions: string[] = []

  const byPos = countByPosition(team.players)
  const required = context.roster.requiredByPosition
  const hasValueSignal = context.availability.playerValues === 'available'
  const hasAgeSignal = context.availability.playerAges === 'available'

  // 1) Roster holes vs. required starting slots (structural, always available).
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
      weaknesses.push(`${pos} has no depth behind ${need} starter slot(s).`)
    } else if (have >= need + 2) {
      strengths.push(`${pos} is deep (${have} rostered for ${need} slot(s)).`)
    }
  }

  // 2) Age concentration: starters in 'aging'/'cliff' trajectory at a position (dynasty-specific).
  if (hasAgeSignal) {
    const agingByPos: Record<string, string[]> = {}
    for (const p of team.players) {
      if (!p.isStarterSlot) continue
      const traj = ageTrajectory(p.position, p.age, context.sport)
      if (traj === 'aging' || traj === 'cliff') (agingByPos[p.position] ??= []).push(`${p.playerName} (${p.age}, ${traj})`)
    }
    for (const [pos, names] of Object.entries(agingByPos)) {
      if (names.length >= 2) {
        weaknesses.push(`${pos} core is aging: ${names.join(', ')}.`)
        if (!tradeTargetPositions.includes(pos)) tradeTargetPositions.push(pos)
        facts.push(`Age risk at ${pos}: ${names.length} starter(s) past prime.`)
      }
    }
  } else {
    missingDataFlags.push('Age-trajectory needs are limited — no player ages available.')
  }

  // 3) Value depth (only with a value signal).
  if (hasValueSignal) {
    for (const [pos, players] of Object.entries(byPos)) {
      let best = 0
      for (const p of players) {
        const v = valueOf(p)
        if (v != null && v > best) best = v
      }
      if (best >= 18) strengths.push(`${pos} anchored by a premium dynasty asset (value ${best.toFixed(1)}).`)
    }
  } else {
    missingDataFlags.push('Position strength is structural only — no dynasty value signal to rank quality.')
  }

  // 4) Injury flags among starters (status only — no medical certainty).
  const injured = team.players.filter(
    (p) => p.isStarterSlot && p.injuryStatus && !/^(healthy|active|ok)$/i.test(p.injuryStatus),
  )
  for (const p of injured) {
    weaknesses.push(`${p.playerName} (${p.position}) listed ${p.injuryStatus}.`)
    if (!tradeTargetPositions.includes(p.position)) tradeTargetPositions.push(p.position)
  }

  // Urgency: structural holes + aging concentration + injuries.
  let urgency = 0
  for (const n of needs) urgency += n.severity === 'critical' ? 30 : n.severity === 'high' ? 18 : 8
  urgency += weaknesses.filter((w) => w.includes('aging')).length * 10
  urgency += injured.length * 8
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

export function evaluateUserDynastyTeamNeeds(context: DynastyWarRoomContext): DynastyNeedsResult | null {
  if (!context.userRosterId) return null
  return evaluateDynastyTeamNeeds(context, context.userRosterId)
}
