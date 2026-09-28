/**
 * [NEW] lib/ncaaf-roster/NcaafRosterTemplates.ts
 * NCAAF roster slot definitions and league-type templates.
 * College football defaults: K in redraft (team defense optional and off — none exists to draft), 2 WR, Superflex optional, IDP optional.
 */

import type { RosterSlotDef } from '@/lib/nfl-roster/NflRosterTemplates'
export type { RosterSlotDef }
export type NcaafRosterTemplate = { key: string; label: string; leagueTypes: string[]; slots: Record<string, number>; description: string }

export const NCAAF_ROSTER_SLOTS: RosterSlotDef[] = [
  // Offense
  { key: 'QB', label: 'Quarterback', shortLabel: 'QB', color: '#f43f5e', category: 'offense', eligiblePositions: ['QB'], defaultCount: 1, minCount: 0, maxCount: 4 },
  { key: 'RB', label: 'Running Back', shortLabel: 'RB', color: '#14b8a6', category: 'offense', eligiblePositions: ['RB'], defaultCount: 2, minCount: 0, maxCount: 6 },
  { key: 'WR', label: 'Wide Receiver', shortLabel: 'WR', color: '#38bdf8', category: 'offense', eligiblePositions: ['WR'], defaultCount: 3, minCount: 0, maxCount: 6 },
  { key: 'TE', label: 'Tight End', shortLabel: 'TE', color: '#f59e0b', category: 'offense', eligiblePositions: ['TE'], defaultCount: 1, minCount: 0, maxCount: 4 },
  // Flex
  { key: 'FLEX', label: 'Flex (WR/RB/TE)', shortLabel: 'FLEX', color: '#a78bfa', category: 'flex', eligiblePositions: ['WR', 'RB', 'TE'], defaultCount: 1, minCount: 0, maxCount: 4 },
  { key: 'FLEX_WR_RB', label: 'Flex (WR/RB)', shortLabel: 'W/R', color: '#a78bfa', category: 'flex', eligiblePositions: ['WR', 'RB'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'FLEX_WR_TE', label: 'Flex (WR/TE)', shortLabel: 'W/T', color: '#a78bfa', category: 'flex', eligiblePositions: ['WR', 'TE'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'SUPERFLEX', label: 'Super Flex (QB/WR/RB/TE)', shortLabel: 'SF', color: '#ec4899', category: 'flex', eligiblePositions: ['QB', 'WR', 'RB', 'TE'], defaultCount: 0, minCount: 0, maxCount: 2 },
  // K / DEF
  { key: 'K', label: 'Kicker', shortLabel: 'K', color: '#6b7280', category: 'kicker', eligiblePositions: ['K'], defaultCount: 1, minCount: 0, maxCount: 2 },
  // Off by default: no college team defense exists to draft (the pool holds none) and no feed carries a
  // college team-defense stat line, so a default DEF starter could never be filled — and an unfilled
  // starter slot makes every lineup save fail. A commissioner can still add one.
  { key: 'DEF', label: 'Defense / Special Teams', shortLabel: 'DEF', color: '#64748b', category: 'dst', eligiblePositions: ['DEF'], defaultCount: 0, minCount: 0, maxCount: 2 },
  // IDP (optional for college)
  { key: 'DL', label: 'Defensive Line', shortLabel: 'DL', color: '#22d3ee', category: 'idp', eligiblePositions: ['DE', 'DT', 'DL'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'LB', label: 'Linebacker', shortLabel: 'LB', color: '#34d399', category: 'idp', eligiblePositions: ['LB', 'ILB', 'OLB'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'DB', label: 'Defensive Back', shortLabel: 'DB', color: '#818cf8', category: 'idp', eligiblePositions: ['CB', 'S', 'SS', 'FS', 'DB'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'IDP_FLEX', label: 'Flex (IDP)', shortLabel: 'IDP', color: '#06b6d4', category: 'idp', eligiblePositions: ['DE', 'DT', 'DL', 'LB', 'CB', 'S', 'DB'], defaultCount: 0, minCount: 0, maxCount: 4 },
  // Bench / Reserve
  { key: 'BN', label: 'Bench', shortLabel: 'BN', color: '#4b5563', category: 'bench', eligiblePositions: [], defaultCount: 8, minCount: 0, maxCount: 25 },
  { key: 'IR', label: 'Injured Reserve', shortLabel: 'IR', color: '#ef4444', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 5 },
  { key: 'TAXI', label: 'Taxi Squad', shortLabel: 'TAXI', color: '#8b5cf6', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 10 },
  { key: 'DEVY', label: 'Devy Stash', shortLabel: 'DEVY', color: '#7c3aed', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 12 },
  { key: 'CAMPUS', label: 'Campus / Rights', shortLabel: 'CAMP', color: '#6d28d9', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 12 },
  // C2C Pro (NFL) section
  { key: 'C2C_QB', label: 'NFL QB', shortLabel: 'nQB', color: '#f43f5e', category: 'college', eligiblePositions: ['QB'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'C2C_RB', label: 'NFL RB', shortLabel: 'nRB', color: '#14b8a6', category: 'college', eligiblePositions: ['RB'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'C2C_WR', label: 'NFL WR', shortLabel: 'nWR', color: '#38bdf8', category: 'college', eligiblePositions: ['WR'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'C2C_TE', label: 'NFL TE', shortLabel: 'nTE', color: '#f59e0b', category: 'college', eligiblePositions: ['TE'], defaultCount: 0, minCount: 0, maxCount: 2 },
  { key: 'C2C_FLEX', label: 'NFL Flex', shortLabel: 'nFLX', color: '#a78bfa', category: 'college', eligiblePositions: ['WR', 'RB', 'TE'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'C2C_SF', label: 'NFL Super Flex', shortLabel: 'nSF', color: '#ec4899', category: 'college', eligiblePositions: ['QB', 'WR', 'RB', 'TE'], defaultCount: 0, minCount: 0, maxCount: 2 },
  { key: 'C2C_BN', label: 'NFL Bench', shortLabel: 'nBN', color: '#4b5563', category: 'college', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 15 },
  { key: 'C2C_IR', label: 'NFL IR', shortLabel: 'nIR', color: '#ef4444', category: 'college', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 4 },
]

export const NCAAF_SLOT_MAP = new Map(NCAAF_ROSTER_SLOTS.map((s) => [s.key, s]))

export const NCAAF_ROSTER_TEMPLATES: NcaafRosterTemplate[] = [
  { key: 'redraft', label: 'Redraft', leagueTypes: ['redraft'], description: 'Standard NCAAF redraft.',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, BN: 8, IR: 1 } },
  { key: 'dynasty', label: 'Dynasty', leagueTypes: ['dynasty'], description: 'Deep dynasty with superflex and taxi.',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPERFLEX: 1, BN: 15, IR: 3, TAXI: 4 } },
  // Matches the keeper contract (lib/league-concepts/keeperDefaults.ts), which the settings screens show
  // and the draft's round count is computed from. It was 3 WR, no K, 10 bench, 1 IR here, so a keeper
  // league showed a kicker slot its lineup did not have, and drafted 16 rounds into 18 draftable spots.
  { key: 'keeper', label: 'Keeper', leagueTypes: ['keeper'], description: 'Standard NCAAF keeper.',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, BN: 8, IR: 2 } },
  // Matches what the best ball optimizer SCORES (lib/bestball/rules.ts NCAAF lineupSlots) and the best
  // ball contract (bestBallDefaults: 16-player roster, 16-round draft): QB, 2 RB, 3 WR, 2 FLEX — TEs start
  // through FLEX. It carried a TE, a superflex and 12 bench (22 spots) that nothing scored.
  { key: 'best_ball', label: 'Best Ball', leagueTypes: ['best_ball'], description: 'Standard NCAAF best ball.',
    slots: { QB: 1, RB: 2, WR: 3, FLEX: 2, BN: 8 } },
  { key: 'superflex', label: 'Superflex', leagueTypes: ['redraft', 'dynasty'], description: 'Superflex variant.',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SUPERFLEX: 1, BN: 8 } },
  { key: 'idp', label: 'IDP', leagueTypes: ['redraft', 'dynasty'], description: 'College IDP roster.',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, DL: 2, LB: 2, DB: 2, IDP_FLEX: 1, BN: 8 } },
  { key: 'guillotine', label: 'Guillotine', leagueTypes: ['guillotine'], description: 'Lean guillotine.',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, BN: 5 } },
  { key: 'survivor', label: 'Survivor', leagueTypes: ['survivor'], description: 'Survivor roster.',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, BN: 7 } },
  { key: 'zombie', label: 'Zombie', leagueTypes: ['zombie'], description: 'Lean zombie roster.',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, BN: 4 } },
  { key: 'tournament', label: 'Tournament', leagueTypes: ['tournament'], description: 'Tournament roster.',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, BN: 6 } },
  { key: 'big_brother', label: 'Big Brother', leagueTypes: ['big_brother'], description: 'Big Brother roster.',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, BN: 7 } },
  { key: 'devy', label: 'Devy', leagueTypes: ['devy'], description: 'Devy dynasty with taxi and devy stash.',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPERFLEX: 1, BN: 10, TAXI: 4, DEVY: 10, IR: 2 } },
  { key: 'c2c', label: 'C2C Football', leagueTypes: ['c2c'], description: 'College-to-Canton with NCAAF + NFL sections.',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPERFLEX: 1, BN: 10, CAMPUS: 10,
      C2C_QB: 1, C2C_RB: 2, C2C_WR: 2, C2C_TE: 1, C2C_FLEX: 1, C2C_SF: 1, C2C_BN: 8, C2C_IR: 2 } },
]

export function resolveNcaafRosterTemplate(leagueType: string): NcaafRosterTemplate {
  return NCAAF_ROSTER_TEMPLATES.find((t) => t.leagueTypes.includes(leagueType)) ?? NCAAF_ROSTER_TEMPLATES[0]!
}
export function getAllNcaafSlots(): RosterSlotDef[] { return NCAAF_ROSTER_SLOTS }
export function calculateNcaafRosterSize(config: Record<string, number>): { starters: number; bench: number; total: number } {
  let starters = 0, bench = 0
  for (const [key, count] of Object.entries(config)) {
    const slot = NCAAF_SLOT_MAP.get(key)
    if (!slot || count <= 0) continue
    if (slot.category === 'bench' || slot.category === 'reserve' || slot.category === 'college') bench += count
    else starters += count
  }
  return { starters, bench, total: starters + bench }
}
