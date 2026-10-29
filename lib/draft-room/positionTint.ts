/**
 * One solid color per position for filled draft-board tiles, in Sleeper's palette (pink QB, teal
 * RB, blue WR, orange TE…). It is the cue that makes a board readable at a glance ("three WRs in
 * a row"). Filled tiles put dark text on these, so every color here is bright.
 *
 * Covers every sport the draft room runs. A position missing from the table still gets a stable
 * color from a small hash, so a new sport never renders a grey board.
 */

const PINK = '#ff2a6d'
const TEAL = '#00ceb8'
const BLUE = '#58a7ff'
const ORANGE = '#ffae58'
const PURPLE = '#bd66ff'
const BROWN = '#bf755f'
const LIME = '#a3e635'
const YELLOW = '#facc15'

const POSITION_HEX: Record<string, string> = {
  // Football (Sleeper's own colors)
  QB: PINK,
  RB: TEAL,
  WR: BLUE,
  TE: ORANGE,
  K: PURPLE,
  DEF: BROWN,
  DST: BROWN,
  DL: ORANGE,
  LB: YELLOW,
  DB: TEAL,
  // Basketball
  PG: BLUE,
  SG: TEAL,
  SF: LIME,
  PF: ORANGE,
  // `C` is shared by NBA center and NHL center; one color keeps it consistent.
  C: PINK,
  G: PURPLE,
  F: YELLOW,
  // Hockey
  LW: BLUE,
  RW: TEAL,
  D: ORANGE,
  // Baseball
  SP: PINK,
  RP: '#ff6b9a',
  P: PINK,
  '1B': ORANGE,
  '2B': TEAL,
  '3B': BLUE,
  SS: YELLOW,
  OF: LIME,
  DH: PURPLE,
  // Soccer
  GK: PURPLE,
  GKP: PURPLE,
  DF: ORANGE,
  MID: TEAL,
  MF: TEAL,
  FWD: PINK,
  FW: PINK,
}

const FALLBACK = [BLUE, TEAL, ORANGE, PINK, PURPLE, LIME, YELLOW, BROWN]

export function positionTintHex(position: string | null | undefined): string | null {
  const key = (position ?? '').trim().toUpperCase().split(/[\/,\s]/)[0] ?? ''
  if (!key || key === '-' || key === '—') return null
  const known = POSITION_HEX[key]
  if (known) return known
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return FALLBACK[hash % FALLBACK.length]!
}
