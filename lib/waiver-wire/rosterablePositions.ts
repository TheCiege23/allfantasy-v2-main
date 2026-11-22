/**
 * The positions a league can start, as a set, or null when the league did not say (the list is
 * then left as it is). Read from the roster route's `starterAllowedPositions`: every position some
 * starting slot accepts, flex slots already expanded.
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

/** How a player's own position reads against a league's slot positions. */
const POSITION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  DEF: ['DST', 'D/ST'],
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
}

/** Whether a player at `position` fits a league with these positions. Null set: everyone fits. */
export function positionIsRosterable(position: string | null | undefined, allowed: Set<string> | null): boolean {
  if (!allowed) return true
  const p = String(position ?? '').trim().toUpperCase()
  // No position on file is not a reason to hide someone.
  if (!p) return true
  if (allowed.has(p)) return true
  return (POSITION_ALIASES[p] ?? []).some((alias) => allowed.has(alias))
}
