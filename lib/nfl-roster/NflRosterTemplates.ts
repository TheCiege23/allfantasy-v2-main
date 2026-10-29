/**
 * [NEW] lib/nfl-roster/NflRosterTemplates.ts
 * NFL roster templates per league type. Each template defines starter slots,
 * bench, IR, taxi, devy, and optional IDP/superflex/C2C sections.
 */

export interface RosterSlotDef {
  key: string
  label: string
  shortLabel: string
  color: string
  category: 'offense' | 'flex' | 'kicker' | 'dst' | 'idp' | 'bench' | 'reserve' | 'college'
  eligiblePositions: string[]
  defaultCount: number
  minCount: number
  maxCount: number
}

export interface NflRosterTemplate {
  key: string
  label: string
  leagueTypes: string[]
  slots: Record<string, number>
  description: string
}

/** All available NFL roster slot definitions. */
export const NFL_ROSTER_SLOTS: RosterSlotDef[] = [
  // Offense
  { key: 'QB', label: 'Quarterback', shortLabel: 'QB', color: '#f43f5e', category: 'offense', eligiblePositions: ['QB'], defaultCount: 1, minCount: 0, maxCount: 4 },
  { key: 'RB', label: 'Running Back', shortLabel: 'RB', color: '#14b8a6', category: 'offense', eligiblePositions: ['RB'], defaultCount: 2, minCount: 0, maxCount: 6 },
  { key: 'WR', label: 'Wide Receiver', shortLabel: 'WR', color: '#38bdf8', category: 'offense', eligiblePositions: ['WR'], defaultCount: 2, minCount: 0, maxCount: 6 },
  { key: 'TE', label: 'Tight End', shortLabel: 'TE', color: '#f59e0b', category: 'offense', eligiblePositions: ['TE'], defaultCount: 1, minCount: 0, maxCount: 4 },
  // Flex
  { key: 'FLEX', label: 'Flex (WR/RB/TE)', shortLabel: 'FLEX', color: '#a78bfa', category: 'flex', eligiblePositions: ['WR', 'RB', 'TE'], defaultCount: 1, minCount: 0, maxCount: 4 },
  { key: 'FLEX_WR_RB', label: 'Flex (WR/RB)', shortLabel: 'W/R', color: '#a78bfa', category: 'flex', eligiblePositions: ['WR', 'RB'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'FLEX_WR_TE', label: 'Flex (WR/TE)', shortLabel: 'W/T', color: '#a78bfa', category: 'flex', eligiblePositions: ['WR', 'TE'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'SUPERFLEX', label: 'Super Flex (QB/WR/RB/TE)', shortLabel: 'SF', color: '#ec4899', category: 'flex', eligiblePositions: ['QB', 'WR', 'RB', 'TE'], defaultCount: 0, minCount: 0, maxCount: 2 },
  // Kicker / DST
  { key: 'K', label: 'Kicker', shortLabel: 'K', color: '#6b7280', category: 'kicker', eligiblePositions: ['K'], defaultCount: 1, minCount: 0, maxCount: 2 },
  { key: 'DEF', label: 'Defense / Special Teams', shortLabel: 'DEF', color: '#64748b', category: 'dst', eligiblePositions: ['DEF'], defaultCount: 1, minCount: 0, maxCount: 2 },
  // IDP
  { key: 'DL', label: 'Defensive Line', shortLabel: 'DL', color: '#22d3ee', category: 'idp', eligiblePositions: ['DE', 'DT', 'DL'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'LB', label: 'Linebacker', shortLabel: 'LB', color: '#34d399', category: 'idp', eligiblePositions: ['LB', 'ILB', 'OLB'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'DB', label: 'Defensive Back', shortLabel: 'DB', color: '#818cf8', category: 'idp', eligiblePositions: ['CB', 'S', 'SS', 'FS', 'DB'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'IDP_FLEX', label: 'Flex (IDP)', shortLabel: 'IDP', color: '#06b6d4', category: 'idp', eligiblePositions: ['DE', 'DT', 'DL', 'LB', 'CB', 'S', 'DB'], defaultCount: 0, minCount: 0, maxCount: 4 },
  // Bench / Reserve
  { key: 'BN', label: 'Bench', shortLabel: 'BN', color: '#4b5563', category: 'bench', eligiblePositions: [], defaultCount: 6, minCount: 0, maxCount: 30 },
  { key: 'IR', label: 'Injured Reserve', shortLabel: 'IR', color: '#ef4444', category: 'reserve', eligiblePositions: [], defaultCount: 1, minCount: 0, maxCount: 5 },
  { key: 'TAXI', label: 'Taxi Squad', shortLabel: 'TAXI', color: '#8b5cf6', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 10 },
  { key: 'DEVY', label: 'Devy Stash', shortLabel: 'DEVY', color: '#7c3aed', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 10 },
  // C2C College
  { key: 'C2C_QB', label: 'College QB', shortLabel: 'cQB', color: '#f43f5e', category: 'college', eligiblePositions: ['QB'], defaultCount: 0, minCount: 0, maxCount: 2 },
  { key: 'C2C_RB', label: 'College RB', shortLabel: 'cRB', color: '#14b8a6', category: 'college', eligiblePositions: ['RB'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'C2C_WR', label: 'College WR', shortLabel: 'cWR', color: '#38bdf8', category: 'college', eligiblePositions: ['WR'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'C2C_TE', label: 'College TE', shortLabel: 'cTE', color: '#f59e0b', category: 'college', eligiblePositions: ['TE'], defaultCount: 0, minCount: 0, maxCount: 2 },
  { key: 'C2C_FLEX', label: 'College Flex', shortLabel: 'cFLX', color: '#a78bfa', category: 'college', eligiblePositions: ['QB', 'RB', 'WR', 'TE'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'C2C_BN', label: 'College Bench', shortLabel: 'cBN', color: '#4b5563', category: 'college', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 20 },
]

export const NFL_SLOT_MAP = new Map(NFL_ROSTER_SLOTS.map((s) => [s.key, s]))

/** NFL roster templates by league type. */
export const NFL_ROSTER_TEMPLATES: NflRosterTemplate[] = [
  { key: 'redraft', label: 'Redraft', leagueTypes: ['redraft'], description: 'Standard NFL redraft roster.',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6, IR: 1 } },
  { key: 'dynasty', label: 'Dynasty', leagueTypes: ['dynasty'], description: 'Deep dynasty roster with superflex and taxi.',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPERFLEX: 1, K: 0, DEF: 0, BN: 15, IR: 3, TAXI: 6 } },
  { key: 'keeper', label: 'Keeper', leagueTypes: ['keeper'], description: 'Extended keeper roster.',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 8, IR: 1 } },
  { key: 'best_ball', label: 'Best Ball', leagueTypes: ['best_ball'], description: 'Deep best ball roster, no K/DEF.',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, K: 0, DEF: 0, BN: 12 } },
  { key: 'superflex', label: 'Superflex', leagueTypes: ['redraft', 'dynasty'], description: 'Superflex variant.',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 1, K: 1, DEF: 1, BN: 8 } },
  { key: 'idp', label: 'IDP', leagueTypes: ['redraft', 'dynasty'], description: 'Individual Defensive Player roster.',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DL: 2, LB: 2, DB: 2, IDP_FLEX: 1, K: 0, DEF: 0, BN: 8, IR: 2 } },
  { key: 'guillotine', label: 'Guilly', leagueTypes: ['guillotine'], description: 'Lean Guilly roster.',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 4 } },
  { key: 'survivor', label: 'Survivor', leagueTypes: ['survivor'], description: 'Standard survivor roster.',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6 } },
  { key: 'zombie', label: 'Zombie', leagueTypes: ['zombie'], description: 'Lean zombie roster for active churn.',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, K: 0, DEF: 0, BN: 3 } },
  { key: 'tournament', label: 'Tournament', leagueTypes: ['tournament'], description: 'Tournament roster with moderate bench.',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 5 } },
  { key: 'big_brother', label: 'Big Brother', leagueTypes: ['big_brother'], description: 'Big Brother roster.',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6 } },
  { key: 'devy', label: 'Devy Dynasty', leagueTypes: ['devy'], description: 'Devy dynasty with taxi and devy stash.',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPERFLEX: 1, K: 0, DEF: 0, BN: 12, IR: 3, TAXI: 6, DEVY: 6 } },
  { key: 'c2c', label: 'C2C Football', leagueTypes: ['c2c'], description: 'College-to-Canton with NFL + NCAAF sections.',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, SUPERFLEX: 1, K: 0, DEF: 0, BN: 12, IR: 3, TAXI: 4,
      C2C_QB: 1, C2C_RB: 2, C2C_WR: 3, C2C_TE: 1, C2C_FLEX: 2, C2C_BN: 10 } },
]

/** Resolve the default roster template for a league type. */
export function resolveNflRosterTemplate(leagueType: string): NflRosterTemplate {
  const match = NFL_ROSTER_TEMPLATES.find((t) => t.leagueTypes.includes(leagueType))
  return match ?? NFL_ROSTER_TEMPLATES[0]!
}

/** Get the slot definitions that are active (count > 0) for a config. */
export function getActiveSlots(config: Record<string, number>): RosterSlotDef[] {
  return NFL_ROSTER_SLOTS.filter((s) => (config[s.key] ?? 0) > 0 || s.category === 'bench')
}

/** Get all available slots for a sport (for the editor to show all options). */
export function getAllNflSlots(): RosterSlotDef[] {
  return NFL_ROSTER_SLOTS
}

/** Calculate total roster size from a config. */
export function calculateRosterSize(config: Record<string, number>): { starters: number; bench: number; total: number } {
  let starters = 0, bench = 0
  for (const [key, count] of Object.entries(config)) {
    const slot = NFL_SLOT_MAP.get(key)
    if (!slot || count <= 0) continue
    if (slot.category === 'bench' || slot.category === 'reserve') bench += count
    else starters += count
  }
  return { starters, bench, total: starters + bench }
}
