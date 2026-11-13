export type RosterSlot = {
  label: string
  positions: string[]
  count: number
}

export const POSITION_COLORS: Record<string, string> = {
  QB: '#e17e44',
  RB: '#4ec9b0',
  WR: '#569cd6',
  TE: '#c586c0',
  K: '#9cdcfe',
  DEF: '#858585',
  DL: '#d7ba7d',
  LB: '#6a9955',
  DB: '#4fc1ff',
  FLEX: '#dcdcaa',
  'IDP FLEX': '#ce9178',
  PG: '#e17e44',
  SG: '#569cd6',
  SF: '#4ec9b0',
  PF: '#c586c0',
  C: '#d7ba7d',
  G: '#dcdcaa',
  F: '#6a9955',
  UTIL: '#858585',
  SP: '#e17e44',
  RP: '#569cd6',
  P: '#4ec9b0',
  '1B': '#c586c0',
  '2B': '#d7ba7d',
  '3B': '#6a9955',
  SS: '#4fc1ff',
  OF: '#dcdcaa',
  DH: '#9cdcfe',
  CI: '#ce9178',
  MI: '#858585',
  LW: '#e17e44',
  RW: '#569cd6',
  D: '#4ec9b0',
  /** Hockey goalie (use `positionColor` for NHL `G` vs NBA guard slot `G`) */
  G_H: '#c586c0',
  IR: '#858585',
  GK: '#e17e44',
  DEF_SOC: '#569cd6',
  MID: '#4ec9b0',
  FWD: '#c586c0',
}

export const SPORT_ROSTER_SLOTS: Record<string, RosterSlot[]> = {
  NFL: [
    { label: 'QB', positions: ['QB'], count: 1 },
    { label: 'RB', positions: ['RB'], count: 2 },
    { label: 'WR', positions: ['WR'], count: 2 },
    { label: 'TE', positions: ['TE'], count: 1 },
    { label: 'FLEX', positions: ['RB', 'WR', 'TE'], count: 2 },
    { label: 'DL', positions: ['DT', 'DE', 'DL'], count: 2 },
    { label: 'LB', positions: ['LB', 'ILB', 'OLB'], count: 2 },
    { label: 'DB', positions: ['CB', 'S', 'DB', 'FS', 'SS'], count: 2 },
    { label: 'IDP FLEX', positions: ['DT', 'DE', 'DL', 'LB', 'CB', 'S', 'DB'], count: 2 },
    { label: 'BN', positions: ['*'], count: 6 },
  ],
  NCAAFB: [
    { label: 'QB', positions: ['QB'], count: 1 },
    { label: 'RB', positions: ['RB'], count: 2 },
    { label: 'WR', positions: ['WR'], count: 2 },
    { label: 'TE', positions: ['TE'], count: 1 },
    { label: 'FLEX', positions: ['RB', 'WR', 'TE'], count: 1 },
    { label: 'BN', positions: ['*'], count: 5 },
  ],
  NCAAF: [
    { label: 'QB', positions: ['QB'], count: 1 },
    { label: 'RB', positions: ['RB'], count: 2 },
    { label: 'WR', positions: ['WR'], count: 2 },
    { label: 'TE', positions: ['TE'], count: 1 },
    { label: 'FLEX', positions: ['RB', 'WR', 'TE'], count: 1 },
    { label: 'BN', positions: ['*'], count: 5 },
  ],
  NBA: [
    { label: 'PG', positions: ['PG'], count: 1 },
    { label: 'SG', positions: ['SG'], count: 1 },
    { label: 'SF', positions: ['SF'], count: 1 },
    { label: 'PF', positions: ['PF'], count: 1 },
    { label: 'C', positions: ['C'], count: 1 },
    { label: 'G', positions: ['PG', 'SG'], count: 1 },
    { label: 'F', positions: ['SF', 'PF'], count: 1 },
    { label: 'UTIL', positions: ['PG', 'SG', 'SF', 'PF', 'C'], count: 1 },
    { label: 'BN', positions: ['*'], count: 3 },
  ],
  NCAABB: [
    { label: 'PG', positions: ['PG'], count: 1 },
    { label: 'SG', positions: ['SG'], count: 1 },
    { label: 'SF', positions: ['SF'], count: 1 },
    { label: 'PF', positions: ['PF'], count: 1 },
    { label: 'C', positions: ['C'], count: 1 },
    { label: 'UTIL', positions: ['PG', 'SG', 'SF', 'PF', 'C'], count: 2 },
    { label: 'BN', positions: ['*'], count: 4 },
  ],
  NCAAB: [
    { label: 'PG', positions: ['PG'], count: 1 },
    { label: 'SG', positions: ['SG'], count: 1 },
    { label: 'SF', positions: ['SF'], count: 1 },
    { label: 'PF', positions: ['PF'], count: 1 },
    { label: 'C', positions: ['C'], count: 1 },
    { label: 'UTIL', positions: ['PG', 'SG', 'SF', 'PF', 'C'], count: 2 },
    { label: 'BN', positions: ['*'], count: 4 },
  ],
  MLB: [
    { label: 'C', positions: ['C'], count: 1 },
    { label: '1B', positions: ['1B'], count: 1 },
    { label: '2B', positions: ['2B'], count: 1 },
    { label: '3B', positions: ['3B'], count: 1 },
    { label: 'SS', positions: ['SS'], count: 1 },
    { label: 'OF', positions: ['OF', 'LF', 'CF', 'RF'], count: 3 },
    { label: 'CI', positions: ['1B', '3B'], count: 1 },
    { label: 'MI', positions: ['2B', 'SS'], count: 1 },
    { label: 'UTIL', positions: ['*'], count: 1 },
    { label: 'SP', positions: ['SP'], count: 2 },
    { label: 'RP', positions: ['RP', 'P'], count: 2 },
    { label: 'P', positions: ['SP', 'RP', 'P'], count: 2 },
    { label: 'BN', positions: ['*'], count: 4 },
  ],
  NHL: [
    { label: 'C', positions: ['C'], count: 2 },
    { label: 'LW', positions: ['LW', 'W'], count: 2 },
    { label: 'RW', positions: ['RW', 'W'], count: 2 },
    { label: 'D', positions: ['D'], count: 4 },
    { label: 'G', positions: ['G'], count: 1 },
    { label: 'BN', positions: ['*'], count: 4 },
  ],
  SOCCER: [
    { label: 'GK', positions: ['GK'], count: 1 },
    { label: 'DEF', positions: ['DEF', 'D'], count: 4 },
    { label: 'MID', positions: ['MID', 'M'], count: 4 },
    { label: 'FWD', positions: ['FWD', 'F', 'ATT'], count: 2 },
    { label: 'BN', positions: ['*'], count: 4 },
  ],
  PGA: [
    { label: 'G', positions: ['GOLF'], count: 6 },
    { label: 'BN', positions: ['*'], count: 2 },
  ],
}

export function positionColor(pos: string, sport?: string): string {
  const p = pos.trim().toUpperCase()
  const su = sport?.trim().toUpperCase() ?? ''
  if (p === 'G' && su === 'NHL') return POSITION_COLORS.G_H ?? '#c586c0'
  return POSITION_COLORS[p] ?? POSITION_COLORS[pos] ?? '#8b949e'
}
