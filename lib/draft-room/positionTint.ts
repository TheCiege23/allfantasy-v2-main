/**
 * One color per position, for filled draft-board tiles — the cue that makes a board readable at a
 * glance ("three WRs in a row"), the way Sleeper and ESPN color their boards.
 *
 * Covers every sport the draft room runs. A position missing from the table still gets a stable
 * color from a small hash, so a new sport never renders a grey board.
 */

const POSITION_HEX: Record<string, string> = {
  // Football
  QB: '#f43f5e',
  RB: '#10b981',
  WR: '#0ea5e9',
  TE: '#f59e0b',
  K: '#a78bfa',
  DEF: '#94a3b8',
  DST: '#94a3b8',
  DL: '#f97316',
  LB: '#eab308',
  DB: '#14b8a6',
  // Basketball
  PG: '#0ea5e9',
  SG: '#22d3ee',
  SF: '#10b981',
  PF: '#f59e0b',
  // `C` is shared by NBA center and NHL center; one color keeps it consistent.
  C: '#f43f5e',
  G: '#8b5cf6',
  F: '#84cc16',
  // Hockey
  LW: '#0ea5e9',
  RW: '#10b981',
  D: '#f59e0b',
  // Baseball
  SP: '#f43f5e',
  RP: '#fb7185',
  P: '#f43f5e',
  '1B': '#f59e0b',
  '2B': '#10b981',
  '3B': '#0ea5e9',
  SS: '#22d3ee',
  OF: '#84cc16',
  DH: '#a78bfa',
  // Soccer
  GK: '#8b5cf6',
  GKP: '#8b5cf6',
  DF: '#f59e0b',
  MID: '#10b981',
  MF: '#10b981',
  FWD: '#f43f5e',
  FW: '#f43f5e',
}

const FALLBACK = ['#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#22d3ee', '#84cc16', '#fb7185']

export function positionTintHex(position: string | null | undefined): string | null {
  const key = (position ?? '').trim().toUpperCase().split(/[\/,\s]/)[0] ?? ''
  if (!key || key === '-' || key === '—') return null
  const known = POSITION_HEX[key]
  if (known) return known
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return FALLBACK[hash % FALLBACK.length]!
}
