/**
 * GUILLOTINE LINEUP-SAFETY ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Guillotine lineups ARE user-managed. Survival-first: fill required slots by best available
 * floor (projection → ADP proxy). If the team is in/near the chop zone it ALSO flags the
 * highest-ceiling bench swing (a survival situation may require chasing upside). Confidence
 * reflects the weakest signal used; structural-only when no value signal exists.
 */

import { playerValue, isInjured, type ValueSource } from './guillotineValue'
import { evaluateSurvivalRisk } from './guillotineSurvivalRiskEngine'
import type { GuillotinePlayerFact, GuillotineWarRoomContext } from './types'

interface GuillotineLineupSlot {
  position: string
  playerId: string | null
  playerName: string | null
  value: number | null
  valueSource: ValueSource
  reason: string
}

export interface GuillotineLineupSafetyResult {
  rosterId: string
  suggestedStarters: GuillotineLineupSlot[]
  /** When survival is at risk, the best ceiling swing to consider over a safe-but-low starter. */
  ceilingSwing: { playerId: string; playerName: string; position: string; value: number } | null
  posture: 'floor' | 'ceiling_needed' | 'limited'
  confidence: 'high' | 'low' | 'none'
  explanationFacts: string[]
  missingDataFlags: string[]
}

export function evaluateLineupSafety(context: GuillotineWarRoomContext, rosterId: string): GuillotineLineupSafetyResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  if (!team) {
    return { rosterId, suggestedStarters: [], ceilingSwing: null, posture: 'limited', confidence: 'none', explanationFacts: ['Roster not found in this league.'], missingDataFlags }
  }

  const ranked = team.players
    .filter((p) => p.slotType !== 'ir')
    .map((p) => ({ p, ...playerValue(p) }))
    .sort((a, b) => b.value - a.value)
  const anySignal = ranked.some((r) => r.source !== 'none')

  const used = new Set<string>()
  const starters: GuillotineLineupSlot[] = []
  for (const [pos, count] of Object.entries(context.roster.requiredByPosition)) {
    for (let i = 0; i < count; i++) {
      const cand = ranked.find((r) => !used.has(r.p.playerId) && r.p.position === pos)
      if (!cand) {
        starters.push({ position: pos, playerId: null, playerName: null, value: null, valueSource: 'none', reason: `No eligible ${pos} available.` })
        continue
      }
      used.add(cand.p.playerId)
      const injNote = isInjured(cand.p.injuryStatus) ? ` (listed ${cand.p.injuryStatus} — floor risk)` : ''
      starters.push({
        position: pos,
        playerId: cand.p.playerId,
        playerName: cand.p.playerName,
        value: cand.source === 'none' ? null : Math.round(cand.value * 100) / 100,
        valueSource: cand.source,
        reason: cand.source === 'none' ? `Placed by eligibility only${injNote}.` : `Safest ${pos} floor by ${cand.source === 'adp' ? 'ADP' : 'projection'}${injNote}.`,
      })
    }
  }

  // Survival posture: chop-zone/high risk → a ceiling swing may be warranted.
  const survival = evaluateSurvivalRisk(context, rosterId)
  const ceilingNeeded = survival.riskLevel === 'critical' || survival.riskLevel === 'high'
  let ceilingSwing: GuillotineLineupSafetyResult['ceilingSwing'] = null
  if (ceilingNeeded && anySignal) {
    const benchBest = ranked.find((r) => !used.has(r.p.playerId) && r.source !== 'none')
    if (benchBest) ceilingSwing = { playerId: benchBest.p.playerId, playerName: benchBest.p.playerName, position: benchBest.p.position, value: Math.round(benchBest.value * 100) / 100 }
  }

  const filled = starters.filter((s) => s.playerId != null).map((s) => s.valueSource)
  const confidence: GuillotineLineupSafetyResult['confidence'] = !anySignal || filled.length === 0 ? 'none' : filled.some((s) => s === 'none' || s === 'adp') ? 'low' : 'high'
  const posture: GuillotineLineupSafetyResult['posture'] = !anySignal ? 'limited' : ceilingNeeded ? 'ceiling_needed' : 'floor'

  const facts: string[] = []
  if (posture === 'floor') facts.push('Safe ahead of the chop zone — start your highest-floor lineup.')
  else if (posture === 'ceiling_needed') facts.push('Survival is at risk — a higher-ceiling swing can be worth the variance to climb out of the chop zone.')
  if (!anySignal) missingDataFlags.push('Lineup ordering is structural only — no projections/ADP to rank floors.')

  return { rosterId, suggestedStarters: starters, ceilingSwing, posture, confidence, explanationFacts: facts, missingDataFlags: [...new Set(missingDataFlags)] }
}
