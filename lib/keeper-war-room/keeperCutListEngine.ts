/**
 * KEEPER CUT-LIST ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Surfaces who to CUT / not keep: ineligible players, negative-surplus keepers, and the
 * weakest season-value depth once the keeper limit forces choices. Complements the
 * recommendation engine (what to keep) with the inverse (what to let go).
 */

import { classifyKeeper, playerSeasonValue, rankKeepers } from './keeperValueEngine'
import type { KeeperPlayerFact, KeeperWarRoomContext } from './types'

interface KeeperCutCandidate {
  playerId: string
  playerName: string
  position: string
  seasonValue: number | null
  surplusRounds: number | null
  reason: string
}

export interface KeeperCutListResult {
  rosterId: string
  /** Players you should not keep (ineligible / negative surplus first), then weakest value. */
  cutList: KeeperCutCandidate[]
  riskFlags: string[]
  missingDataFlags: string[]
}

function seasonValueOf(p: KeeperPlayerFact): number | null {
  const v = playerSeasonValue(p)
  return v.source === 'none' ? null : Math.round(v.value * 100) / 100
}

export function buildKeeperCutList(context: KeeperWarRoomContext, rosterId: string): KeeperCutListResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  const riskFlags: string[] = []
  if (!team) {
    return { rosterId, cutList: [], riskFlags: [], missingDataFlags: ['Roster not found in this season.'] }
  }

  const ranked = rankKeepers(context, rosterId)
  const cuts: KeeperCutCandidate[] = []

  // 1) Ineligible + negative-surplus first (clear cuts).
  for (const r of ranked) {
    if (r.verdict === 'ineligible') {
      cuts.push({ playerId: r.playerId, playerName: r.playerName, position: r.position, seasonValue: null, surplusRounds: r.surplusRounds, reason: r.reason })
    } else if (r.verdict === 'let_go') {
      cuts.push({ playerId: r.playerId, playerName: r.playerName, position: r.position, seasonValue: null, surplusRounds: r.surplusRounds, reason: r.reason })
    }
  }

  // 2) Weakest season-value depth (works even without keeper costs).
  const byValue = team.players
    .map((p) => ({ p, v: seasonValueOf(p) }))
    .sort((a, b) => (a.v ?? -1) - (b.v ?? -1))
  for (const { p, v } of byValue.slice(0, 4)) {
    if (cuts.some((c) => c.playerId === p.playerId)) continue
    cuts.push({
      playerId: p.playerId,
      playerName: p.playerName,
      position: p.position,
      seasonValue: v,
      surplusRounds: p.surplusRounds,
      reason:
        v == null
          ? `Lowest-confidence asset (no value signal)${p.injuryStatus ? `, listed ${p.injuryStatus}` : ''}.`
          : `Among the weakest rosterable values (${v.toFixed(1)})${p.injuryStatus ? `, listed ${p.injuryStatus}` : ''}.`,
    })
  }

  const eligibleValued = ranked.filter((r) => r.verdict !== 'ineligible' && r.verdict !== 'no_cost')
  if (eligibleValued.length > context.keeper.maxKeepers) {
    riskFlags.push(`More positive-value keepers (${eligibleValued.length}) than keeper slots (${context.keeper.maxKeepers}) — some value must be cut or traded.`)
  }
  if (context.availability.keeperCosts === 'missing') {
    riskFlags.push('Keeper-cost data unavailable — cut list falls back to season value only.')
  }

  return { rosterId, cutList: cuts.slice(0, 8), riskFlags, missingDataFlags: [...new Set(missingDataFlags)] }
}
