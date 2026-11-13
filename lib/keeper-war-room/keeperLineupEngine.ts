/**
 * KEEPER LINEUP / START-SIT ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Only relevant when the keeper league's season is ACTIVE. Greedy fill of required
 * positional slots by best-available season value (projection → season avg → ADP).
 * Confidence reflects the weakest signal used. When the season isn't active or no signal
 * exists, it returns a clear non-active / structural state instead of inventing points.
 */

import { playerSeasonValue, type SeasonValueSource } from './keeperValueEngine'
import type { KeeperPlayerFact, KeeperWarRoomContext } from './types'

interface KeeperLineupAssignment {
  position: string
  playerId: string | null
  playerName: string | null
  value: number | null
  valueSource: SeasonValueSource
  reason: string
}

export interface KeeperLineupResult {
  rosterId: string
  active: boolean
  suggestedStarters: KeeperLineupAssignment[]
  suggestedBench: Array<{ playerId: string; playerName: string; position: string; value: number | null }>
  confidence: 'high' | 'medium' | 'low' | 'none'
  missingDataFlags: string[]
}

function rank(p: KeeperPlayerFact): { player: KeeperPlayerFact; value: number; source: SeasonValueSource } {
  const v = playerSeasonValue(p)
  return { player: p, value: v.value, source: v.source }
}

export function buildKeeperLineupRecommendation(context: KeeperWarRoomContext, rosterId: string): KeeperLineupResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  if (!team) {
    return { rosterId, active: false, suggestedStarters: [], suggestedBench: [], confidence: 'none', missingDataFlags: ['Roster not found in this season.'] }
  }
  if (!context.seasonActive) {
    return {
      rosterId,
      active: false,
      suggestedStarters: [],
      suggestedBench: [],
      confidence: 'none',
      missingDataFlags: [...new Set([...missingDataFlags, 'Season is not active — start/sit is not in play yet.'])],
    }
  }

  const ranked = team.players.filter((p) => p.slotType !== 'ir').map(rank).sort((a, b) => b.value - a.value)
  const anySignal = ranked.some((r) => r.source !== 'none')
  const used = new Set<string>()
  const starters: KeeperLineupAssignment[] = []

  for (const [pos, count] of Object.entries(context.roster.requiredByPosition)) {
    for (let i = 0; i < count; i++) {
      const cand = ranked.find((r) => !used.has(r.player.playerId) && r.player.position === pos)
      if (!cand) {
        starters.push({ position: pos, playerId: null, playerName: null, value: null, valueSource: 'none', reason: `No eligible ${pos} available.` })
        continue
      }
      used.add(cand.player.playerId)
      const injuryNote = cand.player.injuryStatus && !/^(healthy|active|ok)$/i.test(cand.player.injuryStatus) ? ` (listed ${cand.player.injuryStatus})` : ''
      starters.push({
        position: pos,
        playerId: cand.player.playerId,
        playerName: cand.player.playerName,
        value: cand.source === 'none' ? null : Math.round(cand.value * 100) / 100,
        valueSource: cand.source,
        reason: cand.source === 'none' ? `Placed by eligibility only${injuryNote}.` : `Top ${pos} by ${cand.source === 'adp' ? 'ADP' : cand.source === 'projection' ? 'projection' : 'season avg'}${injuryNote}.`,
      })
    }
  }

  const bench = ranked
    .filter((r) => !used.has(r.player.playerId))
    .map((r) => ({ playerId: r.player.playerId, playerName: r.player.playerName, position: r.player.position, value: r.source === 'none' ? null : Math.round(r.value * 100) / 100 }))

  const filled = starters.filter((s) => s.playerId != null).map((s) => s.valueSource)
  let confidence: KeeperLineupResult['confidence']
  if (!anySignal || filled.length === 0) confidence = 'none'
  else if (filled.some((s) => s === 'none' || s === 'adp')) confidence = 'low'
  else if (filled.some((s) => s === 'season_avg')) confidence = 'medium'
  else confidence = 'high'

  if (!anySignal) missingDataFlags.push('Start/sit is structural only — no projections, stats, or ADP to rank starters.')
  else if (confidence === 'low') missingDataFlags.push('Start/sit is low confidence — based partly on ADP/ranking.')

  return { rosterId, active: true, suggestedStarters: starters, suggestedBench: bench, confidence, missingDataFlags: [...new Set(missingDataFlags)] }
}
