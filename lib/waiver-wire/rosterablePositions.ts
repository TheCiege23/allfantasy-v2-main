/**
 * The positions a league can start, as a set, or null when the league did not say (the list is
 * then left as it is). Read from the roster route's `starterAllowedPositions`: every position some
 * starting slot accepts, flex and utility slots already expanded. Every sport.
 *
 * A league with no kicker, team-defense or defensive-player slot still listed all of them as free
 * agents and offered K and DEF as filters (owner report, 2026-11-22: a QB / RB / WR / TE / FLEX
 * league showing a defensive lineman second in its list). A player nobody can start is noise.
 */
export function rosterablePositions(starterAllowedPositions: unknown): Set<string> | null {
  if (!Array.isArray(starterAllowedPositions)) return null
  const out = new Set<string>()
  for (const raw of starterAllowedPositions) {
    const position = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
    if (position) out.add(position)
  }
  return out.size > 0 ? out : null
}

/**
 * Other names one position goes by, across the sports' feeds and slot names. Symmetric by use: a
 * player's position is tried as itself and as each alias, against the league's slot positions.
 */
const POSITION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // Football
  DEF: ['DST', 'D/ST', 'D'],
  DST: ['DEF', 'D/ST'],
  'D/ST': ['DEF', 'DST'],
  DE: ['DL'],
  DT: ['DL'],
  EDGE: ['DL'],
  CB: ['DB'],
  S: ['DB'],
  SS: ['DB'],
  FS: ['DB'],
  ILB: ['LB'],
  OLB: ['LB'],
  PK: ['K'],
  // Baseball
  LF: ['OF'],
  CF: ['OF'],
  RF: ['OF'],
  SP: ['P'],
  RP: ['P'],
  P: ['SP', 'RP'],
  DH: ['UTIL', 'UT'],
  // Basketball
  PG: ['G'],
  SG: ['G'],
  SF: ['F'],
  PF: ['F'],
  G: ['PG', 'SG'],
  F: ['SF', 'PF', 'FWD'],
  // Hockey
  LW: ['W'],
  RW: ['W'],
  W: ['LW', 'RW'],
  // Soccer
  GK: ['GKP'],
  GKP: ['GK'],
  D: ['DEF'],
  M: ['MID'],
  MID: ['M'],
  FWD: ['F', 'FW', 'ST'],
  FW: ['FWD'],
  ST: ['FWD'],
}

/**
 * Whether a player at `position` fits a league with these positions. Null set: everyone fits.
 *
 * A player listed at several positions ("PG/SG", "LW,RW", "SF-PF") fits when any one of them does.
 * A position this table does not know at all is not a reason to hide someone only when the league's
 * own positions are unknown too; against a known set it has to match, as itself or by an alias.
 */
export function positionIsRosterable(position: string | null | undefined, allowed: Set<string> | null): boolean {
  if (!allowed) return true
  const text = String(position ?? '').trim().toUpperCase()
  // No position on file is not a reason to hide someone.
  if (!text) return true
  const parts = text === 'D/ST' ? [text] : text.split(/[/,\-\s]+/).filter(Boolean)
  return parts.some((p) => allowed.has(p) || (POSITION_ALIASES[p] ?? []).some((alias) => allowed.has(alias)))
}
