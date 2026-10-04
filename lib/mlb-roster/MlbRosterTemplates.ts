/**
 * [NEW] lib/mlb-roster/MlbRosterTemplates.ts
 * MLB roster slot definitions and league-type templates.
 * Covers hitters, pitchers, bench, reserve, and prospect/devy slots.
 */

import type { RosterSlotDef } from '@/lib/nfl-roster/NflRosterTemplates'
export type { RosterSlotDef }
export type MlbRosterTemplate = { key: string; label: string; leagueTypes: string[]; slots: Record<string, number>; description: string }

export const MLB_ROSTER_SLOTS: RosterSlotDef[] = [
  // Hitters
  { key: 'C', label: 'Catcher', shortLabel: 'C', color: '#f43f5e', category: 'offense', eligiblePositions: ['C'], defaultCount: 1, minCount: 0, maxCount: 3 },
  { key: '1B', label: 'First Base', shortLabel: '1B', color: '#14b8a6', category: 'offense', eligiblePositions: ['1B'], defaultCount: 1, minCount: 0, maxCount: 3 },
  { key: '2B', label: 'Second Base', shortLabel: '2B', color: '#38bdf8', category: 'offense', eligiblePositions: ['2B'], defaultCount: 1, minCount: 0, maxCount: 3 },
  { key: '3B', label: 'Third Base', shortLabel: '3B', color: '#f59e0b', category: 'offense', eligiblePositions: ['3B'], defaultCount: 1, minCount: 0, maxCount: 3 },
  { key: 'SS', label: 'Shortstop', shortLabel: 'SS', color: '#a78bfa', category: 'offense', eligiblePositions: ['SS'], defaultCount: 1, minCount: 0, maxCount: 3 },
  { key: 'CI', label: 'Corner Infielder', shortLabel: 'CI', color: '#22d3ee', category: 'flex', eligiblePositions: ['1B', '3B'], defaultCount: 1, minCount: 0, maxCount: 3 },
  { key: 'MI', label: 'Middle Infielder', shortLabel: 'MI', color: '#818cf8', category: 'flex', eligiblePositions: ['2B', 'SS'], defaultCount: 1, minCount: 0, maxCount: 3 },
  { key: 'OF', label: 'Outfielder', shortLabel: 'OF', color: '#34d399', category: 'offense', eligiblePositions: ['OF', 'LF', 'CF', 'RF'], defaultCount: 3, minCount: 0, maxCount: 7 },
  { key: 'UTIL', label: 'Utility', shortLabel: 'UTIL', color: '#e879f9', category: 'flex', eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'LF', 'CF', 'RF', 'DH', 'TWP'], defaultCount: 1, minCount: 0, maxCount: 4 },
  { key: 'H', label: 'Hitter (Any)', shortLabel: 'H', color: '#ec4899', category: 'flex', eligiblePositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'LF', 'CF', 'RF', 'DH', 'TWP'], defaultCount: 0, minCount: 0, maxCount: 4 },
  // Pitchers
  { key: 'SP', label: 'Starting Pitcher', shortLabel: 'SP', color: '#ef4444', category: 'offense', eligiblePositions: ['SP'], defaultCount: 2, minCount: 0, maxCount: 7 },
  { key: 'RP', label: 'Relief Pitcher', shortLabel: 'RP', color: '#fb923c', category: 'offense', eligiblePositions: ['RP'], defaultCount: 2, minCount: 0, maxCount: 5 },
  { key: 'P', label: 'Pitcher (Any)', shortLabel: 'P', color: '#dc2626', category: 'flex', eligiblePositions: ['SP', 'RP', 'P'], defaultCount: 3, minCount: 0, maxCount: 15 },
  // Bench / Reserve
  { key: 'BN', label: 'Bench', shortLabel: 'BN', color: '#4b5563', category: 'bench', eligiblePositions: [], defaultCount: 6, minCount: 0, maxCount: 20 },
  { key: 'IL', label: 'Injured List', shortLabel: 'IL', color: '#ef4444', category: 'reserve', eligiblePositions: [], defaultCount: 2, minCount: 0, maxCount: 8 },
  { key: 'IL_PLUS', label: 'IL+ (60-day)', shortLabel: 'IL+', color: '#dc2626', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 5 },
  { key: 'NA', label: 'Not Active', shortLabel: 'NA', color: '#6b7280', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 10 },
  { key: 'TAXI', label: 'Taxi Squad', shortLabel: 'TAXI', color: '#8b5cf6', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 10 },
  { key: 'PROSPECT', label: 'Prospect Stash', shortLabel: 'PRSP', color: '#7c3aed', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 15 },
  { key: 'RIGHTS', label: 'Rights / Development', shortLabel: 'RTS', color: '#6d28d9', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 15 },
  { key: 'MINORS', label: 'Minor League', shortLabel: 'MiLB', color: '#5b21b6', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 15 },
]

export const MLB_SLOT_MAP = new Map(MLB_ROSTER_SLOTS.map((s) => [s.key, s]))

export const MLB_ROSTER_TEMPLATES: MlbRosterTemplate[] = [
  { key: 'redraft', label: 'Redraft', leagueTypes: ['redraft'], description: 'Standard MLB redraft.',
    slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, CI: 1, MI: 1, OF: 3, UTIL: 1, SP: 2, RP: 2, P: 3, BN: 6, IL: 2, NA: 1 } },
  { key: 'dynasty', label: 'Dynasty', leagueTypes: ['dynasty'], description: 'Deep dynasty with prospect stash.',
    slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, CI: 1, MI: 1, OF: 5, UTIL: 2, SP: 3, RP: 2, P: 4, BN: 12, IL: 4, NA: 5, TAXI: 6, PROSPECT: 10 } },
  { key: 'keeper', label: 'Keeper', leagueTypes: ['keeper'], description: 'Extended keeper roster.',
    slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, CI: 1, MI: 1, OF: 4, UTIL: 1, SP: 2, RP: 2, P: 3, BN: 8, IL: 3, NA: 2 } },
  { key: 'best_ball', label: 'Best Ball', leagueTypes: ['best_ball'], description: 'Deep best ball.',
    slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, CI: 1, MI: 1, OF: 5, UTIL: 2, SP: 3, RP: 2, P: 4, BN: 10, IL: 2 } },
  { key: 'points', label: 'Points League', leagueTypes: ['redraft'], description: 'Points-league roster.',
    slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, CI: 1, MI: 1, OF: 3, UTIL: 1, SP: 2, RP: 2, P: 3, BN: 6, IL: 2 } },
  { key: 'category', label: 'Category / Roto', leagueTypes: ['redraft'], description: 'Category-based scoring roster.',
    slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, CI: 1, MI: 1, OF: 5, UTIL: 1, SP: 3, RP: 2, P: 3, BN: 7, IL: 2, NA: 2 } },
  { key: 'guillotine', label: 'Guillotine', leagueTypes: ['guillotine'], description: 'Lean guillotine.',
    slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3, UTIL: 1, SP: 2, RP: 1, P: 2, BN: 4 } },
  { key: 'survivor', label: 'Survivor', leagueTypes: ['survivor'], description: 'Survivor roster.',
    slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 4, UTIL: 1, SP: 2, RP: 2, P: 2, BN: 6 } },
  { key: 'zombie', label: 'Zombie', leagueTypes: ['zombie'], description: 'Lean zombie.',
    slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 4, UTIL: 1, SP: 2, RP: 2, P: 3, BN: 5 } },
  { key: 'tournament', label: 'Tournament', leagueTypes: ['tournament'], description: 'Tournament roster.',
    slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3, UTIL: 1, SP: 2, RP: 2, P: 3, BN: 5 } },
  { key: 'big_brother', label: 'Big Brother', leagueTypes: ['big_brother'], description: 'Big Brother roster.',
    slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 4, UTIL: 1, SP: 2, RP: 2, P: 2, BN: 6 } },
  { key: 'devy', label: 'Devy / Prospect', leagueTypes: ['devy'], description: 'Dynasty with prospect/minors stash.',
    slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, CI: 1, MI: 1, OF: 5, UTIL: 2, SP: 3, RP: 2, P: 4, BN: 10, IL: 4, NA: 5, TAXI: 6, PROSPECT: 10 } },
]

export function resolveMlbRosterTemplate(leagueType: string): MlbRosterTemplate {
  return MLB_ROSTER_TEMPLATES.find((t) => t.leagueTypes.includes(leagueType)) ?? MLB_ROSTER_TEMPLATES[0]!
}
export function getAllMlbSlots(): RosterSlotDef[] { return MLB_ROSTER_SLOTS }
export function calculateMlbRosterSize(config: Record<string, number>): { starters: number; bench: number; total: number } {
  let starters = 0, bench = 0
  for (const [key, count] of Object.entries(config)) {
    const slot = MLB_SLOT_MAP.get(key)
    if (!slot || count <= 0) continue
    if (slot.category === 'bench' || slot.category === 'reserve') bench += count
    else starters += count
  }
  return { starters, bench, total: starters + bench }
}
