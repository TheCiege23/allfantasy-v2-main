/**
 * [NEW] lib/soccer-roster/SoccerRosterTemplates.ts
 * Soccer roster slot definitions and league-type templates.
 * Default: GK/DEF/MID/FWD with 11 starters + bench, FPL-compatible base.
 */

import type { RosterSlotDef } from '@/lib/nfl-roster/NflRosterTemplates'
export type { RosterSlotDef }
export type SoccerRosterTemplate = { key: string; label: string; leagueTypes: string[]; slots: Record<string, number>; description: string }

export const SOCCER_ROSTER_SLOTS: RosterSlotDef[] = [
  // Core positions
  { key: 'GK', label: 'Goalkeeper', shortLabel: 'GK', color: '#f59e0b', category: 'offense', eligiblePositions: ['GK', 'GKP'], defaultCount: 1, minCount: 0, maxCount: 3 },
  { key: 'DEF', label: 'Defender', shortLabel: 'DEF', color: '#14b8a6', category: 'offense', eligiblePositions: ['DEF', 'CB', 'LB', 'RB', 'LWB', 'RWB'], defaultCount: 3, minCount: 0, maxCount: 6 },
  { key: 'MID', label: 'Midfielder', shortLabel: 'MID', color: '#38bdf8', category: 'offense', eligiblePositions: ['MID', 'CM', 'CDM', 'CAM', 'LM', 'RM', 'AM'], defaultCount: 4, minCount: 0, maxCount: 7 },
  { key: 'FWD', label: 'Forward', shortLabel: 'FWD', color: '#f43f5e', category: 'offense', eligiblePositions: ['FWD', 'ST', 'CF', 'LW', 'RW', 'SS'], defaultCount: 3, minCount: 0, maxCount: 5 },
  // Flex
  { key: 'FLEX_DEF_MID', label: 'Flex (DEF/MID)', shortLabel: 'D/M', color: '#a78bfa', category: 'flex', eligiblePositions: ['DEF', 'MID', 'CB', 'LB', 'RB', 'CM', 'CDM', 'CAM'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'FLEX_MID_FWD', label: 'Flex (MID/FWD)', shortLabel: 'M/F', color: '#a78bfa', category: 'flex', eligiblePositions: ['MID', 'FWD', 'CM', 'CAM', 'AM', 'ST', 'CF', 'LW', 'RW'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'FLEX', label: 'Flex (DEF/MID/FWD)', shortLabel: 'FLEX', color: '#e879f9', category: 'flex', eligiblePositions: ['DEF', 'MID', 'FWD', 'CB', 'LB', 'RB', 'CM', 'CDM', 'CAM', 'AM', 'ST', 'CF', 'LW', 'RW'], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'UTIL', label: 'Utility (Any Outfield)', shortLabel: 'UTIL', color: '#ec4899', category: 'flex', eligiblePositions: ['DEF', 'MID', 'FWD', 'GK', 'CB', 'LB', 'RB', 'CM', 'CDM', 'CAM', 'AM', 'ST', 'CF', 'LW', 'RW', 'GKP'], defaultCount: 0, minCount: 0, maxCount: 3 },
  // Bench / Reserve
  { key: 'BN', label: 'Bench', shortLabel: 'BN', color: '#4b5563', category: 'bench', eligiblePositions: [], defaultCount: 4, minCount: 0, maxCount: 12 },
  { key: 'IR', label: 'Injured', shortLabel: 'IR', color: '#ef4444', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'IR_PLUS', label: 'IR+', shortLabel: 'IR+', color: '#dc2626', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 3 },
  { key: 'TAXI', label: 'Taxi Squad', shortLabel: 'TAXI', color: '#8b5cf6', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 8 },
  { key: 'YOUTH', label: 'Youth / Academy', shortLabel: 'YTH', color: '#7c3aed', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 12 },
  { key: 'RIGHTS', label: 'Rights', shortLabel: 'RTS', color: '#6d28d9', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 10 },
  { key: 'DEVELOPMENT', label: 'Development', shortLabel: 'DEV', color: '#5b21b6', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 10 },
  { key: 'ACADEMY', label: 'Academy', shortLabel: 'ACA', color: '#4c1d95', category: 'reserve', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 10 },
  // Dual-track development section (pro side when primary is youth)
  { key: 'C2C_GK', label: 'Pro GK', shortLabel: 'pGK', color: '#f59e0b', category: 'college', eligiblePositions: ['GK', 'GKP'], defaultCount: 0, minCount: 0, maxCount: 2 },
  { key: 'C2C_DEF', label: 'Pro DEF', shortLabel: 'pDEF', color: '#14b8a6', category: 'college', eligiblePositions: ['DEF'], defaultCount: 0, minCount: 0, maxCount: 5 },
  { key: 'C2C_MID', label: 'Pro MID', shortLabel: 'pMID', color: '#38bdf8', category: 'college', eligiblePositions: ['MID'], defaultCount: 0, minCount: 0, maxCount: 5 },
  { key: 'C2C_FWD', label: 'Pro FWD', shortLabel: 'pFWD', color: '#f43f5e', category: 'college', eligiblePositions: ['FWD'], defaultCount: 0, minCount: 0, maxCount: 4 },
  { key: 'C2C_BN', label: 'Pro Bench', shortLabel: 'pBN', color: '#4b5563', category: 'college', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 8 },
  { key: 'C2C_IR', label: 'Pro IR', shortLabel: 'pIR', color: '#ef4444', category: 'college', eligiblePositions: [], defaultCount: 0, minCount: 0, maxCount: 3 },
]

export const SOCCER_SLOT_MAP = new Map(SOCCER_ROSTER_SLOTS.map((s) => [s.key, s]))

export const SOCCER_ROSTER_TEMPLATES: SoccerRosterTemplate[] = [
  { key: 'redraft', label: 'Redraft', leagueTypes: ['redraft'], description: 'Standard soccer redraft (FPL-compatible base: 11 starters + 4 bench).',
    slots: { GK: 1, DEF: 3, MID: 4, FWD: 3, BN: 4, IR: 1 } },
  { key: 'dynasty', label: 'Dynasty', leagueTypes: ['dynasty'], description: 'Deep dynasty with taxi and youth stash.',
    slots: { GK: 1, DEF: 3, MID: 4, FWD: 3, FLEX: 1, BN: 8, IR: 2, TAXI: 4, YOUTH: 8 } },
  { key: 'keeper', label: 'Keeper', leagueTypes: ['keeper'], description: 'Extended keeper roster.',
    slots: { GK: 1, DEF: 3, MID: 4, FWD: 3, BN: 5, IR: 1 } },
  { key: 'best_ball', label: 'Best Ball', leagueTypes: ['best_ball'], description: 'Deep best ball.',
    slots: { GK: 1, DEF: 3, MID: 4, FWD: 3, FLEX: 1, BN: 8, IR: 1 } },
  { key: 'points', label: 'Points League', leagueTypes: ['redraft'], description: 'Points-league roster.',
    slots: { GK: 1, DEF: 3, MID: 4, FWD: 3, BN: 4, IR: 1 } },
  { key: 'category', label: 'Category League', leagueTypes: ['redraft'], description: 'Category-based scoring.',
    slots: { GK: 1, DEF: 4, MID: 4, FWD: 2, BN: 4, IR: 1 } },
  { key: 'guillotine', label: 'Guilly', leagueTypes: ['guillotine'], description: 'Lean guillotine.',
    slots: { GK: 1, DEF: 3, MID: 4, FWD: 2, BN: 3 } },
  { key: 'survivor', label: 'Survivor', leagueTypes: ['survivor'], description: 'Survivor roster.',
    slots: { GK: 1, DEF: 3, MID: 4, FWD: 3, BN: 4 } },
  { key: 'zombie', label: 'Zombie', leagueTypes: ['zombie'], description: 'Lean zombie.',
    slots: { GK: 1, DEF: 3, MID: 4, FWD: 3, BN: 4 } },
  { key: 'tournament', label: 'Tournament', leagueTypes: ['tournament'], description: 'Tournament roster.',
    slots: { GK: 1, DEF: 3, MID: 4, FWD: 3, BN: 4 } },
  { key: 'big_brother', label: 'Big Brother', leagueTypes: ['big_brother'], description: 'Big Brother roster.',
    slots: { GK: 1, DEF: 3, MID: 4, FWD: 3, BN: 5 } },
  { key: 'development', label: 'Development / Youth', leagueTypes: ['devy'], description: 'Dynasty with youth/academy stash.',
    slots: { GK: 1, DEF: 3, MID: 4, FWD: 3, BN: 6, IR: 2, TAXI: 4, YOUTH: 8, RIGHTS: 6 } },
  { key: 'dual_track', label: 'Dual-Track (Dev + Pro)', leagueTypes: ['c2c'], description: 'Youth/development + pro sections.',
    slots: { GK: 1, DEF: 3, MID: 4, FWD: 3, BN: 5, YOUTH: 8, ACADEMY: 8,
      C2C_GK: 1, C2C_DEF: 3, C2C_MID: 4, C2C_FWD: 3, C2C_BN: 5, C2C_IR: 2 } },
]

export function resolveSoccerRosterTemplate(leagueType: string): SoccerRosterTemplate {
  return SOCCER_ROSTER_TEMPLATES.find((t) => t.leagueTypes.includes(leagueType)) ?? SOCCER_ROSTER_TEMPLATES[0]!
}
export function getAllSoccerSlots(): RosterSlotDef[] { return SOCCER_ROSTER_SLOTS }
export function calculateSoccerRosterSize(config: Record<string, number>): { starters: number; bench: number; total: number } {
  let starters = 0, bench = 0
  for (const [key, count] of Object.entries(config)) {
    const slot = SOCCER_SLOT_MAP.get(key)
    if (!slot || count <= 0) continue
    if (slot.category === 'bench' || slot.category === 'reserve' || slot.category === 'college') bench += count
    else starters += count
  }
  return { starters, bench, total: starters + bench }
}
