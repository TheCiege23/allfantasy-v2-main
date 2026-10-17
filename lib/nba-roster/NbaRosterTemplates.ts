/**
 * [NEW] lib/nba-roster/NbaRosterTemplates.ts
 * NBA roster slot definitions and league-type templates.
 * Supports standard, dynasty, devy, C2C, and all specialty league types.
 */

import type { RosterSlotDef, NflRosterTemplate as RosterTemplate } from '@/lib/nfl-roster/NflRosterTemplates'
export type { RosterSlotDef }
export type NbaRosterTemplate = RosterTemplate

export const NBA_ROSTER_SLOTS: RosterSlotDef[] = [
  // Standard positions
  { key: 'PG', label: 'Point Guard', shortLabel: 'PG', color: '#f43f5e', category: 'offense', eligiblePositions: ['PG'], defaultCount: 1, minCount: 0, maxCount: 4 },
  { key: 'SG', label: 'Shooting Guard', shortLabel: 'SG', color: '#fb923c', category: 'offense', eligiblePositions: ['SG'], defaultCount: 1, minCount: 0, maxCount: 4 },
  { key: 'G', label: 'Guard', shortLabel: 'G', color: '#f59e0b', category: 'flex', eligiblePositions: ['PG', 'SG'], defaultCount: 1, minCount: 0, maxCount: 4 },
  { key: 'SF', label: 'Small Forward', shortLabel: 'SF', color: '#14b8a6', category: 'offense', eligiblePositions: ['SF'], defaultCount: 1, minCount: 0, maxCount: 4 },
  { key: 'PF', label: 'Power Forward', shortLabel: 'PF', color: '#22d3ee', category: 'offense', eligiblePositions: ['PF'], defaultCount: 1, minCount: 0, maxCount: 4 },
  { key: 'F', label: 'Forward', shortLabel: 'F', color: '#34d399', category: 'flex', eligiblePositions: ['SF', 'PF'], defaultCount: 1, minCount: 0, maxCount: 4 },
  { key: 'C', label: 'Center', shortLabel: 'C', color: '#818cf8', category: 'offense', eligiblePositions: ['C'], defaultCount: 2, minCount: 0, maxCount: 4 },
  { key: 'UTIL', label: 'Utility', shortLabel: 'UTIL', color: '#a78bfa', category: 'flex', eligiblePositions: ['PG', 'SG', 'SF', 'PF', 'C'], defaultCount: 2, minCount: 0, maxCount: 6 },
  // Advanced flex
  { key: 'FLEX_PG_SG', label: 'Flex (PG/SG)', shortLabel: 'PG/SG', color: '#e879f9', category: 'flex', eligiblePositions: ['PG', 'SG'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'FLEX_SF_PF', label: 'Flex (SF/PF)', shortLabel: 'SF/PF', color: '#e879f9', category: 'flex', eligiblePositions: ['SF', 'PF'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'FLEX_G_F', label: 'Flex (G/F)', shortLabel: 'G/F', color: '#e879f9', category: 'flex', eligiblePositions: ['PG', 'SG', 'SF', 'PF'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'FLEX_F_C', label: 'Flex (F/C)', shortLabel: 'F/C', color: '#e879f9', category: 'flex', eligiblePositions: ['SF', 'PF', 'C'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'SUPER_UTIL', label: 'Super Utility', shortLabel: 'SU', color: '#ec4899', category: 'flex', eligiblePositions: ['PG', 'SG', 'SF', 'PF', 'C'], defaultCount: 0, minCount: 0, maxCount: 3 },
  // Bench / Reserve
  { key: 'BN', label: 'Bench', shortLabel: 'BN', color: '#4b5563', category: 'bench', eligiblePositions: [], defaultCount: 3, minCount: 0, maxCount: 15 },
  { key: 'IL', label: 'Injured List', shortLabel: 'IL', color: '#ef4444', category: 'reserve', eligiblePositions: [], defaultCount: 2, minCount: 0, maxCount: 5 },
  { key: 'IL_PLUS', label: 'IL+', shortLabel: 'IL+', color: '#dc2626', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'TAXI', label: 'Taxi Squad', shortLabel: 'TAXI', color: '#8b5cf6', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 8 },
  { key: 'DEVY', label: 'Devy Stash', shortLabel: 'DEVY', color: '#7c3aed', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 12 },
  // C2C College
  { key: 'C2C_G', label: 'College Guard', shortLabel: 'cG', color: '#f59e0b', category: 'college', eligiblePositions: ['G', 'PG', 'SG'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'C2C_F', label: 'College Forward', shortLabel: 'cF', color: '#34d399', category: 'college', eligiblePositions: ['F', 'SF', 'PF'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'C2C_C', label: 'College Center', shortLabel: 'cC', color: '#818cf8', category: 'college', eligiblePositions: ['C'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'C2C_UTIL', label: 'College Utility', shortLabel: 'cUTIL', color: '#a78bfa', category: 'college', eligiblePositions: ['G', 'F', 'C', 'PG', 'SG', 'SF', 'PF'], defaultCount: 0, minCount: 0, maxCount: 6 },
  { key: 'C2C_BN', label: 'College Bench', shortLabel: 'cBN', color: '#4b5563', category: 'college', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 15 },
  { key: 'CAMPUS', label: 'Campus / Rights', shortLabel: 'CAMP', color: '#7c3aed', category: 'college', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 12 },
]

export const NBA_SLOT_MAP = new Map(NBA_ROSTER_SLOTS.map((s) => [s.key, s]))

export const NBA_ROSTER_TEMPLATES: NbaRosterTemplate[] = [
  { key: 'redraft', label: 'Redraft', leagueTypes: ['redraft'], description: 'Standard NBA redraft roster (Yahoo-compatible).',
    slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 3, IL: 2 } },
  { key: 'dynasty', label: 'Dynasty', leagueTypes: ['dynasty'], description: 'Deep dynasty roster with taxi.',
    slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 8, IL: 3, TAXI: 4 } },
  { key: 'keeper', label: 'Keeper', leagueTypes: ['keeper'], description: 'Extended keeper roster.',
    slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 5, IL: 2 } },
  { key: 'best_ball', label: 'Best Ball', leagueTypes: ['best_ball'], description: 'Deep best ball roster.',
    slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 3, BN: 6, IL: 2 } },
  { key: 'lock_in', label: 'Lock-In', leagueTypes: ['redraft'], description: 'Weekly lock-in format.',
    slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 5, IL: 2 } },
  { key: 'category', label: 'Category League', leagueTypes: ['redraft'], description: 'Category-based scoring roster.',
    slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 4, IL: 2 } },
  { key: 'guillotine', label: 'Guillotine', leagueTypes: ['guillotine'], description: 'Lean guillotine roster.',
    slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 1, UTIL: 2, BN: 2 } },
  { key: 'survivor', label: 'Survivor', leagueTypes: ['survivor'], description: 'Standard survivor roster.',
    slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 1, UTIL: 1, BN: 4 } },
  { key: 'zombie', label: 'Zombie', leagueTypes: ['zombie'], description: 'Lean zombie roster for active churn.',
    slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 3, BN: 3 } },
  { key: 'tournament', label: 'Tournament', leagueTypes: ['tournament'], description: 'Tournament roster.',
    slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 3 } },
  { key: 'big_brother', label: 'Big Brother', leagueTypes: ['big_brother'], description: 'Big Brother roster.',
    slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 4 } },
  { key: 'devy', label: 'Devy Dynasty', leagueTypes: ['devy'], description: 'Devy dynasty with taxi and devy stash.',
    slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 3, BN: 6, TAXI: 4, DEVY: 8, IL: 2 } },
  { key: 'c2c', label: 'C2C Basketball', leagueTypes: ['c2c'], description: 'College-to-Canton with NBA + NCAAB sections.',
    slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 5, IL: 2,
      C2C_G: 2, C2C_F: 2, C2C_C: 1, C2C_UTIL: 3, C2C_BN: 8, CAMPUS: 8 } },
]

export function resolveNbaRosterTemplate(leagueType: string): NbaRosterTemplate {
  return NBA_ROSTER_TEMPLATES.find((t) => t.leagueTypes.includes(leagueType)) ?? NBA_ROSTER_TEMPLATES[0]!
}

export function getAllNbaSlots(): RosterSlotDef[] { return NBA_ROSTER_SLOTS }

export function calculateNbaRosterSize(config: Record<string, number>): { starters: number; bench: number; total: number } {
  let starters = 0, bench = 0
  for (const [key, count] of Object.entries(config)) {
    const slot = NBA_SLOT_MAP.get(key)
    if (!slot || count <= 0) continue
    if (slot.category === 'bench' || slot.category === 'reserve' || slot.category === 'college') bench += count
    else starters += count
  }
  return { starters, bench, total: starters + bench }
}
