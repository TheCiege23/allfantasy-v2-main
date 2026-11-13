/**
 * KEEPER ROSTER-NEEDS ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Evaluates roster needs AFTER keepers are accounted for: counts the recommended keep
 * set (or already-declared keepers) by position against required starting slots, and
 * surfaces which positions you must address in the remaining draft. Keeper-specific —
 * it reasons about the post-keeper roster, not the full current roster.
 */

import { recommendKeepers } from './keeperRecommendationEngine'
import type { KeeperWarRoomContext } from './types'

interface KeeperTeamNeed {
  position: string
  severity: 'critical' | 'high' | 'moderate'
  reason: string
}

export interface KeeperNeedsResult {
  rosterId: string
  /** Positions kept (from the recommended keep set or declared keepers). */
  keptByPosition: Record<string, number>
  needs: KeeperTeamNeed[]
  strengths: string[]
  draftTargetPositions: string[]
  explanationFacts: string[]
  missingDataFlags: string[]
}

export function evaluateKeeperRosterNeeds(context: KeeperWarRoomContext, rosterId: string): KeeperNeedsResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  if (!team) {
    return {
      rosterId,
      keptByPosition: {},
      needs: [],
      strengths: [],
      draftTargetPositions: [],
      explanationFacts: ['Roster not found in this season.'],
      missingDataFlags,
    }
  }

  // Prefer already-declared keepers; otherwise use the recommended keep set.
  const declared = team.players.filter((p) => p.isKept)
  let keptIds: Set<string>
  if (declared.length > 0) {
    keptIds = new Set(declared.map((p) => p.playerId))
  } else {
    const rec = recommendKeepers(context, rosterId)
    keptIds = new Set(rec.recommended.map((r) => r.playerId))
    if (rec.needsMoreData) {
      missingDataFlags.push('Keep set is provisional — keeper cost/value data is incomplete.')
    }
  }

  const keptByPosition: Record<string, number> = {}
  for (const p of team.players) {
    if (keptIds.has(p.playerId)) keptByPosition[p.position] = (keptByPosition[p.position] ?? 0) + 1
  }

  const needs: KeeperTeamNeed[] = []
  const strengths: string[] = []
  const draftTargetPositions: string[] = []
  const facts: string[] = []
  const required = context.roster.requiredByPosition

  for (const [pos, need] of Object.entries(required)) {
    const kept = keptByPosition[pos] ?? 0
    if (kept >= need) {
      strengths.push(`${pos} starting need covered by keepers (${kept}/${need}).`)
    } else {
      const gap = need - kept
      needs.push({
        position: pos,
        severity: kept === 0 ? 'critical' : gap >= 2 ? 'high' : 'moderate',
        reason: `${kept} kept at ${pos} vs ${need} starting slot(s) — draft ${gap} more.`,
      })
      draftTargetPositions.push(pos)
      facts.push(`${pos}: keep ${kept}/${need} starters → draft ${gap}.`)
    }
  }

  if (keptIds.size === 0) facts.push('No keepers selected yet — every starting slot is open for the draft.')

  return {
    rosterId,
    keptByPosition,
    needs,
    strengths: [...new Set(strengths)],
    draftTargetPositions: [...new Set(draftTargetPositions)],
    explanationFacts: facts,
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}

export function evaluateUserKeeperRosterNeeds(context: KeeperWarRoomContext): KeeperNeedsResult | null {
  if (!context.userRosterId) return null
  return evaluateKeeperRosterNeeds(context, context.userRosterId)
}
