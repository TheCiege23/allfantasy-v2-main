/**
 * [NEW] lib/ncaab-roster/NcaabRosterTemplates.ts
 * NCAAB roster slot definitions and league-type templates.
 * Uses broader positional grouping (G/F/C) as default, with optional granular slots.
 */

import type { RosterSlotDef } from '@/lib/nfl-roster/NflRosterTemplates'
export type { RosterSlotDef }
export type NcaabRosterTemplate = { key: string; label: string; leagueTypes: string[]; slots: Record<string, number>; description: string }

export const NCAAB_ROSTER_SLOTS: RosterSlotDef[] = [
  // Core grouped positions (default for college)
  { key: 'G', label: 'Guard', shortLabel: 'G', color: '#f59e0b', category: 'offense', eligiblePositions: ['G', 'PG', 'SG'], defaultCount: 2, minCount: 0, maxCount: 5 },
  { key: 'F', label: 'Forward', shortLabel: 'F', color: '#34d399', category: 'offense', eligiblePositions: ['F', 'SF', 'PF'], defaultCount: 2, minCount: 0, maxCount: 5 },
  { key: 'C', label: 'Center', shortLabel: 'C', color: '#818cf8', category: 'offense', eligiblePositions: ['C'], defaultCount: 1, minCount: 0, maxCount: 4 },
  { key: 'UTIL', label: 'Utility', shortLabel: 'UTIL', color: '#a78bfa', category: 'flex', eligiblePositions: ['G', 'F', 'C', 'PG', 'SG', 'SF', 'PF'], defaultCount: 3, minCount: 0, maxCount: 6 },
  // Optional granular positions
  { key: 'PG', label: 'Point Guard', shortLabel: 'PG', color: '#f43f5e', category: 'offense', eligiblePositions: ['PG'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'SG', label: 'Shooting Guard', shortLabel: 'SG', color: '#fb923c', category: 'offense', eligiblePositions: ['SG'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'SF', label: 'Small Forward', shortLabel: 'SF', color: '#14b8a6', category: 'offense', eligiblePositions: ['SF'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'PF', label: 'Power Forward', shortLabel: 'PF', color: '#22d3ee', category: 'offense', eligiblePositions: ['PF'], defaultCount: 0, minCount: 0, maxCount: 3 },
  // Flex variants
  { key: 'FLEX_PG_SG', label: 'Flex (PG/SG)', shortLabel: 'PG/SG', color: '#e879f9', category: 'flex', eligiblePositions: ['PG', 'SG'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'FLEX_SF_PF', label: 'Flex (SF/PF)', shortLabel: 'SF/PF', color: '#e879f9', category: 'flex', eligiblePositions: ['SF', 'PF'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'FLEX_G_F', label: 'Flex (G/F)', shortLabel: 'G/F', color: '#e879f9', category: 'flex', eligiblePositions: ['G', 'F', 'PG', 'SG', 'SF', 'PF'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'FLEX_F_C', label: 'Flex (F/C)', shortLabel: 'F/C', color: '#e879f9', category: 'flex', eligiblePositions: ['F', 'SF', 'PF', 'C'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'SUPER_UTIL', label: 'Super Utility', shortLabel: 'SU', color: '#ec4899', category: 'flex', eligiblePositions: ['G', 'F', 'C', 'PG', 'SG', 'SF', 'PF'], defaultCount: 0, minCount: 0, maxCount: 3 },
  // Bench / Reserve
  { key: 'BN', label: 'Bench', shortLabel: 'BN', color: '#4b5563', category: 'bench', eligiblePositions: [], defaultCount: 5, minCount: 0, maxCount: 15 },
  { key: 'IL', label: 'Injured List', shortLabel: 'IL', color: '#ef4444', category: 'reserve', eligiblePositions: [], defaultCount: 2, minCount: 0, maxCount: 5 },
  { key: 'IL_PLUS', label: 'IL+', shortLabel: 'IL+', color: '#dc2626', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'TAXI', label: 'Taxi Squad', shortLabel: 'TAXI', color: '#8b5cf6', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 8 },
  { key: 'DEVY', label: 'Devy Stash', shortLabel: 'DEVY', color: '#7c3aed', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 12 },
  { key: 'CAMPUS', label: 'Campus / Rights', shortLabel: 'CAMP', color: '#7c3aed', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 12 },
  // C2C Pro (NBA) section slots
  { key: 'C2C_PG', label: 'NBA Point Guard', shortLabel: 'nPG', color: '#f43f5e', category: 'college', eligiblePositions: ['PG'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'C2C_SG', label: 'NBA Shooting Guard', shortLabel: 'nSG', color: '#fb923c', category: 'college', eligiblePositions: ['SG'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'C2C_G', label: 'NBA Guard', shortLabel: 'nG', color: '#f59e0b', category: 'college', eligiblePositions: ['PG', 'SG'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'C2C_SF', label: 'NBA Small Forward', shortLabel: 'nSF', color: '#14b8a6', category: 'college', eligiblePositions: ['SF'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'C2C_PF', label: 'NBA Power Forward', shortLabel: 'nPF', color: '#22d3ee', category: 'college', eligiblePositions: ['PF'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'C2C_F', label: 'NBA Forward', shortLabel: 'nF', color: '#34d399', category: 'college', eligiblePositions: ['SF', 'PF'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'C2C_C', label: 'NBA Center', shortLabel: 'nC', color: '#818cf8', category: 'college', eligiblePositions: ['C'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'C2C_UTIL', label: 'NBA Utility', shortLabel: 'nUTIL', color: '#a78bfa', category: 'college', eligiblePositions: ['PG', 'SG', 'SF', 'PF', 'C'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'C2C_BN', label: 'NBA Bench', shortLabel: 'nBN', color: '#4b5563', category: 'college', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 10 },
  { key: 'C2C_IL', label: 'NBA IL', shortLabel: 'nIL', color: '#ef4444', category: 'college', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 3 },
]

export const NCAAB_SLOT_MAP = new Map(NCAAB_ROSTER_SLOTS.map((s) => [s.key, s]))

export const NCAAB_ROSTER_TEMPLATES: NcaabRosterTemplate[] = [
  { key: 'redraft', label: 'Redraft', leagueTypes: ['redraft'], description: 'Standard NCAAB redraft with broad G/F/C grouping.',
    slots: { G: 2, F: 2, C: 1, UTIL: 3, BN: 5, IL: 2 } },
  { key: 'dynasty', label: 'Dynasty', leagueTypes: ['dynasty'], description: 'Deep dynasty roster.',
    slots: { G: 2, F: 2, C: 1, UTIL: 4, BN: 8, IL: 3, TAXI: 4 } },
  { key: 'keeper', label: 'Keeper', leagueTypes: ['keeper'], description: 'Extended keeper roster.',
    slots: { G: 2, F: 2, C: 1, UTIL: 3, BN: 6, IL: 2 } },
  { key: 'best_ball', label: 'Best Ball', leagueTypes: ['best_ball'], description: 'Deep best ball roster.',
    slots: { G: 2, F: 2, C: 1, UTIL: 4, BN: 8, IL: 2 } },
  { key: 'lock_in', label: 'Lock-In', leagueTypes: ['redraft'], description: 'Weekly lock-in format.',
    slots: { G: 2, F: 2, C: 1, UTIL: 3, BN: 6, IL: 2 } },
  { key: 'category', label: 'Category League', leagueTypes: ['redraft'], description: 'Category-based scoring.',
    slots: { G: 2, F: 2, C: 1, UTIL: 3, BN: 5, IL: 2 } },
  { key: 'guillotine', label: 'Guilly', leagueTypes: ['guillotine'], description: 'Lean Guilly roster.',
    slots: { G: 2, F: 2, C: 1, UTIL: 2, BN: 3 } },
  { key: 'survivor', label: 'Survivor', leagueTypes: ['survivor'], description: 'Standard survivor roster.',
    slots: { G: 2, F: 2, C: 1, UTIL: 3, BN: 5 } },
  { key: 'zombie', label: 'Zombie', leagueTypes: ['zombie'], description: 'Lean zombie roster.',
    slots: { G: 2, F: 2, C: 1, UTIL: 4, BN: 4 } },
  { key: 'tournament', label: 'Tournament', leagueTypes: ['tournament'], description: 'Tournament roster.',
    slots: { G: 2, F: 2, C: 1, UTIL: 3, BN: 4 } },
  { key: 'big_brother', label: 'Big Brother', leagueTypes: ['big_brother'], description: 'Big Brother roster.',
    slots: { G: 2, F: 2, C: 1, UTIL: 3, BN: 5 } },
  { key: 'devy', label: 'Devy', leagueTypes: ['devy'], description: 'Devy with taxi and devy stash.',
    slots: { G: 2, F: 2, C: 1, UTIL: 4, BN: 8, TAXI: 4, DEVY: 10, IL: 2 } },
  { key: 'c2c', label: 'C2C Basketball', leagueTypes: ['c2c'], description: 'College-to-Canton with NCAAB + NBA sections.',
    slots: { G: 2, F: 2, C: 1, UTIL: 4, BN: 8, CAMPUS: 8,
      C2C_PG: 1, C2C_SG: 1, C2C_G: 1, C2C_SF: 1, C2C_PF: 1, C2C_F: 1, C2C_C: 2, C2C_UTIL: 2, C2C_BN: 5, C2C_IL: 2 } },
]

export function resolveNcaabRosterTemplate(leagueType: string): NcaabRosterTemplate {
  return NCAAB_ROSTER_TEMPLATES.find((t) => t.leagueTypes.includes(leagueType)) ?? NCAAB_ROSTER_TEMPLATES[0]!
}

export function getAllNcaabSlots(): RosterSlotDef[] { return NCAAB_ROSTER_SLOTS }

export function calculateNcaabRosterSize(config: Record<string, number>): { starters: number; bench: number; total: number } {
  let starters = 0, bench = 0
  for (const [key, count] of Object.entries(config)) {
    const slot = NCAAB_SLOT_MAP.get(key)
    if (!slot || count <= 0) continue
    if (slot.category === 'bench' || slot.category === 'reserve' || slot.category === 'college') bench += count
    else starters += count
  }
  return { starters, bench, total: starters + bench }
}
