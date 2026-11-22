/**
 * GUILLOTINE ROSTER-RISK ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Identifies roster weaknesses that could cause ELIMINATION: thin/weak starting positions
 * (low floor), injured starters, and overall floor fragility. Survival-first — a low floor
 * is the biggest elimination risk, not a low ceiling.
 */

import { playerValue, isInjured } from './guillotineValue'
import type { GuillotinePlayerFact, GuillotineWarRoomContext } from './types'

interface GuillotineRosterWeakness {
  position: string
  severity: 'critical' | 'high' | 'moderate'
  reason: string
}

export interface GuillotineRosterRiskResult {
  rosterId: string
  weaknesses: GuillotineRosterWeakness[]
  injuredStarters: Array<{ playerId: string; playerName: string; position: string; status: string }>
  /** 0-100; higher = more elimination risk from roster construction. */
  floorRiskScore: number
  explanationFacts: string[]
  missingDataFlags: string[]
}

function countByPosition(players: GuillotinePlayerFact[]): Record<string, GuillotinePlayerFact[]> {
  const m: Record<string, GuillotinePlayerFact[]> = {}
  for (const p of players) (m[p.position] ??= []).push(p)
  return m
}

export function evaluateRosterRisk(context: GuillotineWarRoomContext, rosterId: string): GuillotineRosterRiskResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  if (!team) {
    return { rosterId, weaknesses: [], injuredStarters: [], floorRiskScore: 0, explanationFacts: ['Roster not found in this league.'], missingDataFlags }
  }

  const byPos = countByPosition(team.players)
  const required = context.roster.requiredByPosition
  const weaknesses: GuillotineRosterWeakness[] = []
  const facts: string[] = []
  const hasValue = context.availability.projections === 'available' || context.availability.playerValues === 'available'

  // 1) Structural holes vs required starters (no body = guaranteed zero at a slot = elimination fuel).
  for (const [pos, need] of Object.entries(required)) {
    const have = (byPos[pos] ?? []).length
    if (have < need) {
      weaknesses.push({ position: pos, severity: have === 0 ? 'critical' : 'high', reason: `${have} rostered ${pos} for ${need} starting slot(s) — a hole drags your weekly floor down.` })
      facts.push(`${pos}: ${have}/${need} starters.`)
    }
  }

  // 2) Low-floor starting positions (best available value well below replacement).
  if (hasValue) {
    for (const [pos, need] of Object.entries(required)) {
      const starters = (byPos[pos] ?? []).filter((p) => p.isStarterSlot)
      const best = starters.reduce((m, p) => Math.max(m, playerValue(p).value), 0)
      if (starters.length >= need && best > 0 && best < 8) {
        weaknesses.push({ position: pos, severity: 'moderate', reason: `${pos} floor is low (top projection ~${best.toFixed(1)}) — a quiet week here can sink you.` })
      }
    }
  } else {
    missingDataFlags.push('Floor analysis is limited — no projections/ADP to rank starter floors.')
  }

  // 3) Injured starters (status only).
  const injuredStarters = team.players
    .filter((p) => p.isStarterSlot && isInjured(p.injuryStatus))
    .map((p) => ({ playerId: p.playerId, playerName: p.playerName, position: p.position, status: p.injuryStatus as string }))
  for (const p of injuredStarters) facts.push(`${p.playerName} (${p.position}) listed ${p.status}.`)

  let floorRisk = 0
  for (const w of weaknesses) floorRisk += w.severity === 'critical' ? 30 : w.severity === 'high' ? 18 : 9
  floorRisk += injuredStarters.length * 12
  const floorRiskScore = Math.min(100, floorRisk)

  if (weaknesses.length === 0 && injuredStarters.length === 0) facts.push('No structural starting holes or injured starters — floor looks stable.')

  return {
    rosterId,
    weaknesses,
    injuredStarters,
    floorRiskScore,
    explanationFacts: facts,
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}
