const POSITION_COLORS: Record<string, string> = {
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

export function positionColor(pos: string, sport?: string): string {
  const p = pos.trim().toUpperCase()
  const su = sport?.trim().toUpperCase() ?? ''
  if (p === 'G' && su === 'NHL') return POSITION_COLORS.G_H ?? '#c586c0'
  return POSITION_COLORS[p] ?? POSITION_COLORS[pos] ?? '#8b949e'
}
