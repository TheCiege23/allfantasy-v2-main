import type { LineupSlotDef, OptimizerPlayer, OptimizerResult, SlotAssignment } from './types'
import { optimizeSoccerFormation } from './soccerFormationOptimizer'
import { OPTIMAL_LINEUP_ALGORITHM, type LineupSlotSpec } from '@/lib/lineup-optimizer/optimalLineup'
import { normalizeToken } from '@/lib/redraft/lineupValidation'
import { computeBestBallLineup } from './productionLineup'

/*
 * 🛑 THIS WAS `bestball-greedy-v1` AND IT WAS WRONG ON DUAL ELIGIBILITY. It filled every non-FLEX/UTIL
 * slot in array order with the highest-scoring eligible player, so a RB/WR worth 30 went into RB and the
 * WR seat took a 5 — 35 where the optimum is 50 (audit 2026-11-06, finding #17). It fed contest scoring,
 * survivor and the `/api/bestball/optimize` cache, so all three could disagree with the matchup.
 *
 * It now seats the lineup with the production primitive (`computeOptimalLineup`, exact) through
 * `lib/bestball/productionLineup.ts`. Signatures and the `OptimizerResult` shape are unchanged; the name
 * `runGreedyOptimizer` is kept only so its importers do not move — nothing about it is greedy any more.
 */

function toSpecs(slots: LineupSlotDef[]): LineupSlotSpec[] {
  /*
   * Normalized with the same token rules as the players (`DST`→`DEF`), so a template that says `DST` and a
   * player listed as `DEF` still meet. `slotOrder` keeps the caller's order for the reported assignment.
   */
  return slots.map((s, i) => ({
    slot: s.slot,
    eligible: (s.eligible ?? []).map((e) => (e === '*' ? '*' : normalizeToken(e))),
    count: Math.max(0, Math.floor(Number(s.count) || 0)),
    slotOrder: i,
  }))
}

/**
 * Exact best ball lineup over the given slots. SOCCER formation templates (slots with `min`/`max`) use the
 * formation optimizer instead (caller: `seatContestLineup`).
 */
export function runGreedyOptimizer(ranked: OptimizerPlayer[], slots: LineupSlotDef[], sport: string): OptimizerResult {
  const byId = new Map<string, OptimizerPlayer>()
  for (const p of ranked) {
    const prev = byId.get(p.playerId)
    if (!prev || p.points > prev.points) byId.set(p.playerId, p)
  }
  const result = computeBestBallLineup({
    slots: toSpecs(slots),
    players: [...byId.values()].map((p) => ({ playerId: p.playerId, position: p.position, points: p.points, playerName: p.playerName })),
  })

  const assignments: SlotAssignment[] = result.assignments.map((a) => ({ slot: a.slot, player: byId.get(a.playerId)! }))
  const requiredBySlot = new Map(slots.map((s) => [s.slot, s.required !== false]))
  const unfilledSlots = result.unfilledSlots.map(
    (u) => `${u.slot} #${u.seat} — no eligible player (required=${requiredBySlot.get(u.slot) ?? true})`,
  )
  const alternateExists = result.provenance.tiedAlternativeExists

  return {
    assignments,
    totalPoints: result.total,
    alternateExists,
    alternateLineup: alternateExists ? { note: 'possible tie alternate' } : null,
    optimizerLog: { algorithm: OPTIMAL_LINEUP_ALGORITHM, sport, unfilledSlots },
  }
}

/** A SOCCER contest template that states a formation range (`min`/`max` per line) rather than fixed seats. */
function isFormationTemplate(slots: LineupSlotDef[]): boolean {
  return slots.some((s) => s.min != null || s.max != null)
}

/**
 * Seats a contest/template lineup; it does not decide one. Fixed-seat templates go straight to the
 * canonical `computeOptimalLineup` (lib/lineup-optimizer/optimalLineup.ts); only a SOCCER formation
 * range uses the formation pass. Formerly `optimizeLineupForSport`, renamed when it stopped being its
 * own optimizer, so it no longer claims to be a competing lineup authority.
 */
export function seatContestLineup(
  players: OptimizerPlayer[],
  slots: LineupSlotDef[],
  sport: string,
): OptimizerResult {
  const ranked = [...players].sort((a, b) => b.points - a.points || a.playerId.localeCompare(b.playerId))
  /*
   * Only a formation-range template takes the formation path: that contract (any of seven formations) is
   * not a fixed set of seats, so it is not a matroid. A soccer LEAGUE is scored by production over its
   * fixed roster seats, and its slots come from `buildBestBallSlots` with no min/max — so it is seated
   * exactly, like every other sport.
   */
  if (sport === 'SOCCER' && isFormationTemplate(slots)) {
    const soc = optimizeSoccerFormation(ranked, { lineupSlots: slots })
    return {
      assignments: soc.assignments,
      totalPoints: soc.totalPoints,
      alternateExists: false,
      alternateLineup: null,
      optimizerLog: { algorithm: 'soccer-formation-v1', sport: 'SOCCER', formation: soc.formation, note: soc.log },
    }
  }
  return runGreedyOptimizer(ranked, slots, sport)
}
