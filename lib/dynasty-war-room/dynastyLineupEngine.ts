/**
 * DYNASTY LINEUP / START-SIT ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Dynasty leagues have no native weekly projections in this context, so the lineup
 * is ranked by dynasty VALUE (ADP/asset value) as a proxy for current quality. This
 * is inherently LOW confidence for week-to-week start/sit, and is surfaced as such —
 * it is most useful for contenders deciding who their best startable players are.
 * It assigns the top valued players to each required positional slot; the rest sit.
 * No flex/superflex distribution is invented beyond the resolved required-by-position
 * counts. When no value signal exists, it fills structurally and flags the output.
 */

import { dynastyValue } from './dynastyPlayerValue'
import type { DynastyPlayerFact, DynastyWarRoomContext } from './types'

interface DynastyLineupAssignment {
  position: string
  playerId: string | null
  playerName: string | null
  value: number | null
  reason: string
}

export interface DynastyLineupResult {
  rosterId: string
  suggestedStarters: DynastyLineupAssignment[]
  suggestedBench: Array<{ playerId: string; playerName: string; position: string; value: number | null }>
  confidence: 'low' | 'none'
  missingDataFlags: string[]
}

function valueOf(p: DynastyPlayerFact): { value: number; has: boolean } {
  const v = dynastyValue(p)
  return { value: v.value, has: v.source !== 'none' }
}

export function buildDynastyLineupRecommendation(
  context: DynastyWarRoomContext,
  rosterId: string,
): DynastyLineupResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  if (!team) {
    return {
      rosterId,
      suggestedStarters: [],
      suggestedBench: [],
      confidence: 'none',
      missingDataFlags: ['Roster not found in this league.'],
    }
  }

  // Only consider active (non-taxi/non-IR) players as startable.
  const active = team.players.filter((p) => p.slotType !== 'taxi' && p.slotType !== 'ir')
  const ranked = active
    .map((p) => ({ p, ...valueOf(p) }))
    .sort((a, b) => b.value - a.value)
  const anySignal = ranked.some((r) => r.has)

  const usedPlayerIds = new Set<string>()
  const starters: DynastyLineupAssignment[] = []

  // Fill each required positional slot with the highest-valued eligible player.
  for (const [pos, count] of Object.entries(context.roster.requiredByPosition)) {
    for (let i = 0; i < count; i++) {
      const candidate = ranked.find((r) => !usedPlayerIds.has(r.p.playerId) && r.p.position === pos)
      if (!candidate) {
        starters.push({ position: pos, playerId: null, playerName: null, value: null, reason: `No eligible ${pos} available.` })
        continue
      }
      usedPlayerIds.add(candidate.p.playerId)
      const injuryNote =
        candidate.p.injuryStatus && !/^(healthy|active|ok)$/i.test(candidate.p.injuryStatus)
          ? ` (listed ${candidate.p.injuryStatus})`
          : ''
      starters.push({
        position: pos,
        playerId: candidate.p.playerId,
        playerName: candidate.p.playerName,
        value: candidate.has ? Math.round(candidate.value * 100) / 100 : null,
        reason: candidate.has
          ? `Top ${pos} by dynasty value${candidate.p.adp != null ? ` (ADP ${candidate.p.adp.toFixed(1)})` : ''}${injuryNote}.`
          : `Placed by eligibility only — no value signal${injuryNote}.`,
      })
    }
  }

  const bench = ranked
    .filter((r) => !usedPlayerIds.has(r.p.playerId))
    .map((r) => ({
      playerId: r.p.playerId,
      playerName: r.p.playerName,
      position: r.p.position,
      value: r.has ? Math.round(r.value * 100) / 100 : null,
    }))

  const confidence: DynastyLineupResult['confidence'] = anySignal ? 'low' : 'none'
  if (!anySignal) {
    missingDataFlags.push('Start/sit ordering is structural only — no value signal to rank starters.')
  } else {
    missingDataFlags.push('Dynasty start/sit is LOW confidence — ranked by long-term value/ADP, not weekly projections.')
  }

  return {
    rosterId,
    suggestedStarters: starters,
    suggestedBench: bench,
    confidence,
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}
