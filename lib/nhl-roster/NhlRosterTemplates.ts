/**
 * [NEW] lib/nhl-roster/NhlRosterTemplates.ts
 * NHL roster slot definitions and league-type templates.
 * Covers skaters, goalies, flex, bench, reserve, and prospect/development slots.
 */

import type { RosterSlotDef } from '@/lib/nfl-roster/NflRosterTemplates'
import { DAILY_REDRAFT_ROSTER_LAYOUTS, dailyRedraftRosterSlotMap } from '@/lib/sportConfig/dailySportRedraftRoster'
export type { RosterSlotDef }
export type NhlRosterTemplate = { key: string; label: string; leagueTypes: string[]; slots: Record<string, number>; description: string }

export const NHL_ROSTER_SLOTS: RosterSlotDef[] = [
  // Skaters
  { key: 'C', label: 'Center', shortLabel: 'C', color: '#f43f5e', category: 'offense', eligiblePositions: ['C'], defaultCount: 2, minCount: 0, maxCount: 5 },
  { key: 'LW', label: 'Left Wing', shortLabel: 'LW', color: '#14b8a6', category: 'offense', eligiblePositions: ['LW'], defaultCount: 2, minCount: 0, maxCount: 5 },
  { key: 'RW', label: 'Right Wing', shortLabel: 'RW', color: '#38bdf8', category: 'offense', eligiblePositions: ['RW'], defaultCount: 2, minCount: 0, maxCount: 5 },
  { key: 'W', label: 'Winger', shortLabel: 'W', color: '#22d3ee', category: 'flex', eligiblePositions: ['LW', 'RW'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'D', label: 'Defenseman', shortLabel: 'D', color: '#818cf8', category: 'offense', eligiblePositions: ['D'], defaultCount: 4, minCount: 0, maxCount: 8 },
  { key: 'UTIL', label: 'Utility', shortLabel: 'UTIL', color: '#a78bfa', category: 'flex', eligiblePositions: ['C', 'LW', 'RW', 'D'], defaultCount: 1, minCount: 0, maxCount: 4 },
  { key: 'SKT', label: 'Skater (Any)', shortLabel: 'SKT', color: '#e879f9', category: 'flex', eligiblePositions: ['C', 'LW', 'RW', 'D'], defaultCount: 0, minCount: 0, maxCount: 4 },
  // Flex variants
  { key: 'FLEX_CW', label: 'Flex (C/W)', shortLabel: 'C/W', color: '#e879f9', category: 'flex', eligiblePositions: ['C', 'LW', 'RW'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'FLEX_LW_RW', label: 'Flex (LW/RW)', shortLabel: 'LW/RW', color: '#e879f9', category: 'flex', eligiblePositions: ['LW', 'RW'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'FLEX_FD', label: 'Flex (F/D)', shortLabel: 'F/D', color: '#e879f9', category: 'flex', eligiblePositions: ['C', 'LW', 'RW', 'D'], defaultCount: 0, minCount: 0, maxCount: 3 },
  // Goalie
  { key: 'G', label: 'Goalie', shortLabel: 'G', color: '#f59e0b', category: 'offense', eligiblePositions: ['G'], defaultCount: 2, minCount: 0, maxCount: 4 },
  // Bench / Reserve
  { key: 'BN', label: 'Bench', shortLabel: 'BN', color: '#4b5563', category: 'bench', eligiblePositions: [], defaultCount: 4, minCount: 0, maxCount: 15 },
  { key: 'IR', label: 'Injured Reserve', shortLabel: 'IR', color: '#ef4444', category: 'reserve', eligiblePositions: [], defaultCount: 2, minCount: 0, maxCount: 6 },
  { key: 'IR_PLUS', label: 'IR+', shortLabel: 'IR+', color: '#dc2626', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'TAXI', label: 'Taxi Squad', shortLabel: 'TAXI', color: '#8b5cf6', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 8 },
  { key: 'PROSPECT', label: 'Prospect Stash', shortLabel: 'PRSP', color: '#7c3aed', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 12 },
  { key: 'RIGHTS', label: 'Rights / Development', shortLabel: 'RTS', color: '#6d28d9', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 10 },
  { key: 'RESERVE', label: 'Reserve', shortLabel: 'RSV', color: '#5b21b6', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 10 },
]

export const NHL_SLOT_MAP = new Map(NHL_ROSTER_SLOTS.map((s) => [s.key, s]))

export const NHL_ROSTER_TEMPLATES: NhlRosterTemplate[] = [
  { key: 'redraft', label: 'Redraft', leagueTypes: ['redraft'], description: 'Standard NHL redraft (Yahoo-compatible base).',
    // The one redraft layout (lib/sportConfig/dailySportRedraftRoster.ts) — never restated here.
    slots: dailyRedraftRosterSlotMap(DAILY_REDRAFT_ROSTER_LAYOUTS.NHL) },
  { key: 'dynasty', label: 'Dynasty', leagueTypes: ['dynasty'], description: 'Deep dynasty with prospect stash.',
    slots: { C: 2, LW: 2, RW: 2, D: 4, UTIL: 2, G: 2, BN: 10, IR: 3, TAXI: 4, PROSPECT: 8 } },
  { key: 'keeper', label: 'Keeper', leagueTypes: ['keeper'], description: 'Extended keeper roster.',
    slots: { C: 2, LW: 2, RW: 2, D: 4, UTIL: 1, G: 2, BN: 6, IR: 2 } },
  { key: 'best_ball', label: 'Best Ball', leagueTypes: ['best_ball'], description: 'Deep best ball.',
    slots: { C: 2, LW: 2, RW: 2, D: 4, UTIL: 2, G: 2, BN: 8, IR: 2 } },
  { key: 'points', label: 'Points League', leagueTypes: ['redraft'], description: 'Points-league roster.',
    slots: { C: 2, LW: 2, RW: 2, D: 4, UTIL: 1, G: 2, BN: 4, IR: 2 } },
  { key: 'category', label: 'Category League', leagueTypes: ['redraft'], description: 'Category-based scoring.',
    slots: { C: 2, LW: 2, RW: 2, D: 4, UTIL: 1, G: 2, BN: 5, IR: 2 } },
  { key: 'guillotine', label: 'Guilly', leagueTypes: ['guillotine'], description: 'Lean guillotine.',
    slots: { C: 2, LW: 2, RW: 2, D: 3, UTIL: 1, G: 1, BN: 3 } },
  { key: 'survivor', label: 'Survivor', leagueTypes: ['survivor'], description: 'Survivor roster.',
    slots: { C: 2, LW: 2, RW: 2, D: 4, UTIL: 1, G: 2, BN: 4 } },
  { key: 'zombie', label: 'Zombie', leagueTypes: ['zombie'], description: 'Lean zombie.',
    slots: { C: 2, LW: 2, RW: 2, D: 4, UTIL: 1, G: 2, BN: 4 } },
  { key: 'tournament', label: 'Tournament', leagueTypes: ['tournament'], description: 'Tournament roster.',
    slots: { C: 2, LW: 2, RW: 2, D: 4, UTIL: 1, G: 2, BN: 4 } },
  { key: 'big_brother', label: 'Big Brother', leagueTypes: ['big_brother'], description: 'Big Brother roster.',
    slots: { C: 2, LW: 2, RW: 2, D: 4, UTIL: 1, G: 2, BN: 5 } },
  { key: 'prospect', label: 'Prospect / Development', leagueTypes: ['devy', 'dynasty'], description: 'Dynasty with prospect/development stash.',
    slots: { C: 2, LW: 2, RW: 2, D: 4, UTIL: 2, G: 2, BN: 8, IR: 3, TAXI: 4, PROSPECT: 10, RIGHTS: 6 } },
]

export function resolveNhlRosterTemplate(leagueType: string): NhlRosterTemplate {
  return NHL_ROSTER_TEMPLATES.find((t) => t.leagueTypes.includes(leagueType)) ?? NHL_ROSTER_TEMPLATES[0]!
}
export function getAllNhlSlots(): RosterSlotDef[] { return NHL_ROSTER_SLOTS }
export function calculateNhlRosterSize(config: Record<string, number>): { starters: number; bench: number; total: number } {
  let starters = 0, bench = 0
  for (const [key, count] of Object.entries(config)) {
    const slot = NHL_SLOT_MAP.get(key)
    if (!slot || count <= 0) continue
    if (slot.category === 'bench' || slot.category === 'reserve') bench += count
    else starters += count
  }
  return { starters, bench, total: starters + bench }
}
