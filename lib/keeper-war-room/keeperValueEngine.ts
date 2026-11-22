/**
 * KEEPER VALUE ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Two distinct value notions for keeper leagues:
 *  1. SEASON value — how good the player is this year (projection → season avg → ADP).
 *     Used by needs/lineup/trade/waivers.
 *  2. KEEPER SURPLUS — draft-capital value of keeping them: keeperCostRound − adpRound
 *     (positive = you keep a higher-value player for a later/cheaper pick). The core
 *     keep/cut signal. Requires both an ADP value AND a real keeper cost; null otherwise.
 */

import type { KeeperPlayerFact, KeeperWarRoomContext } from './types'

export type SeasonValueSource = 'projection' | 'season_avg' | 'adp' | 'none'

/** Map an average overall ADP (lower = better) onto a positive points-like value scale. */
export function adpToValue(adp: number): number {
  return Math.round((Math.max(0, 260 - adp) / 10) * 100) / 100
}

/** Best-available single-season value signal for a player. */
export function playerSeasonValue(p: KeeperPlayerFact): { value: number; source: SeasonValueSource } {
  if (p.weekProjection != null) return { value: p.weekProjection, source: 'projection' }
  if (p.seasonAvgActual != null) return { value: p.seasonAvgActual, source: 'season_avg' }
  if (p.adp != null) return { value: adpToValue(p.adp), source: 'adp' }
  return { value: 0, source: 'none' }
}

type KeeperVerdict = 'definite_keep' | 'keep' | 'borderline' | 'let_go' | 'ineligible' | 'no_cost'

export interface KeeperValueLine {
  playerId: string
  playerName: string
  position: string
  adp: number | null
  adpRound: number | null
  keeperCostLabel: string | null
  keeperCostRound: number | null
  /** Rounds of surplus (positive = good keeper); null when cost or value is missing. */
  surplusRounds: number | null
  verdict: KeeperVerdict
  reason: string
}

/**
 * Classify a single rostered player as a keeper candidate by surplus.
 * Honest: ineligible players are flagged; missing-cost players cannot be valued.
 */
export function classifyKeeper(p: KeeperPlayerFact): KeeperValueLine {
  const base = {
    playerId: p.playerId,
    playerName: p.playerName,
    position: p.position,
    adp: p.adp,
    adpRound: p.adpRound,
    keeperCostLabel: p.keeperCostLabel,
    keeperCostRound: p.keeperCostRound,
    surplusRounds: p.surplusRounds,
  }
  if (p.isEligible === false) {
    return { ...base, verdict: 'ineligible', reason: p.ineligibleReason ? `Ineligible (${p.ineligibleReason}).` : 'Not eligible to keep.' }
  }
  if (p.surplusRounds == null) {
    const why = p.keeperCostRound == null && p.keeperCostAuction == null ? 'no keeper cost on record' : 'no ADP/value signal'
    return { ...base, verdict: 'no_cost', reason: `Cannot value — ${why}.` }
  }
  const s = p.surplusRounds
  if (s >= 4) return { ...base, verdict: 'definite_keep', reason: `Elite value: keeps for R${p.keeperCostRound} vs ~R${p.adpRound} ADP (+${s} rounds).` }
  if (s >= 2) return { ...base, verdict: 'keep', reason: `Strong value: +${s} rounds of surplus (R${p.keeperCostRound} cost vs ~R${p.adpRound} ADP).` }
  if (s >= 0) return { ...base, verdict: 'borderline', reason: `Roughly fair: ${s >= 0 ? '+' : ''}${s} rounds (R${p.keeperCostRound} cost vs ~R${p.adpRound} ADP).` }
  return { ...base, verdict: 'let_go', reason: `Negative value: costs R${p.keeperCostRound} but ADP is only ~R${p.adpRound} (${s} rounds).` }
}

/** All rostered players for a team, classified + sorted best-surplus-first. */
export function rankKeepers(context: KeeperWarRoomContext, rosterId: string): KeeperValueLine[] {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  if (!team) return []
  return team.players
    .map(classifyKeeper)
    .sort((a, b) => {
      // Eligible, valued players first; then by surplus desc.
      const rank = (v: KeeperVerdict) =>
        v === 'definite_keep' ? 0 : v === 'keep' ? 1 : v === 'borderline' ? 2 : v === 'let_go' ? 3 : 4
      if (rank(a.verdict) !== rank(b.verdict)) return rank(a.verdict) - rank(b.verdict)
      return (b.surplusRounds ?? -99) - (a.surplusRounds ?? -99)
    })
}
