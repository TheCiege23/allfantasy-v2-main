/**
 * One solid color per position for filled draft-board tiles: AllFantasy's own palette (violet QB,
 * green RB, gold WR, coral TE…), chosen in the 2026-11 room redesign to read at a glance without
 * borrowing Sleeper's pink / teal / blue / orange. Filled tiles put dark text on these, so every
 * color here is bright.
 *
 * Sport-aware: the same letters mean different positions across sports (`C` is an NBA center, an
 * NHL center and an MLB catcher; `D`, `F` and `G` collide the same way), so pass the league's sport
 * when you have it. Without one, the general table answers. A position missing from every table
 * still gets a stable color from a small hash, so a new sport never renders a grey board.
 */

const VIOLET = '#9b7bff'
const GREEN = '#74d65a'
const GOLD = '#ffc857'
const CORAL = '#ff7a59'
const BLUE = '#5b8cff'
const ROSE = '#f78fb3'
const AQUA = '#2fd4c4'
const SLATE = '#8ea0bf'
const TAN = '#c49a6c'
const SKY = '#93b4ff'

/** Football first (NFL and NCAAF), then every other sport's unambiguous positions. */
const GENERAL: Record<string, string> = {
  QB: VIOLET,
  RB: GREEN,
  WR: GOLD,
  TE: CORAL,
  K: SLATE,
  DEF: TAN,
  DST: TAN,
  // IDP
  DL: ROSE,
  DE: ROSE,
  DT: ROSE,
  EDGE: ROSE,
  LB: AQUA,
  DB: BLUE,
  CB: BLUE,
  S: BLUE,
  // Basketball
  PG: VIOLET,
  SG: BLUE,
  SF: GREEN,
  PF: GOLD,
  C: CORAL,
  G: VIOLET,
  F: GREEN,
  // Hockey
  LW: GREEN,
  RW: GOLD,
  D: BLUE,
  // Baseball
  SP: BLUE,
  RP: SKY,
  P: BLUE,
  '1B': GOLD,
  '2B': GREEN,
  '3B': ROSE,
  SS: VIOLET,
  OF: AQUA,
  LF: AQUA,
  CF: AQUA,
  RF: AQUA,
  DH: SLATE,
  // Soccer
  GK: CORAL,
  GKP: CORAL,
  DF: BLUE,
  MID: GREEN,
  MF: GREEN,
  FWD: GOLD,
  FW: GOLD,
}

/** Where a sport reads a shared letter differently from the general table. */
const BY_SPORT: Record<string, Record<string, string>> = {
  NHL: { C: VIOLET, G: CORAL, D: BLUE },
  MLB: { C: CORAL },
  SOCCER: { D: BLUE, M: GREEN, F: GOLD, G: CORAL, DEF: BLUE },
}

const FALLBACK = [BLUE, GREEN, GOLD, CORAL, VIOLET, AQUA, ROSE, TAN]

export function positionTintHex(position: string | null | undefined, sport?: string | null): string | null {
  const key = (position ?? '').trim().toUpperCase().split(/[\/,\s]/)[0] ?? ''
  if (!key || key === '-' || key === '—') return null
  const sportKey = (sport ?? '').trim().toUpperCase()
  const known = BY_SPORT[sportKey]?.[key] ?? GENERAL[key]
  if (known) return known
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return FALLBACK[hash % FALLBACK.length]!
}
