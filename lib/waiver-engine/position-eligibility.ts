const SPECIAL = new Set(['K', 'DEF', 'DST', 'D/ST', 'LB', 'DL', 'DB', 'DE', 'DT', 'CB', 'S', 'SS', 'FS', 'EDGE', 'IDP'])
const GROUPS: Readonly<Record<string, readonly string[]>> = {
  DEF: ['DEF', 'DST', 'D/ST'], DST: ['DEF', 'DST', 'D/ST'], 'D/ST': ['DEF', 'DST', 'D/ST'],
  DL: ['DL', 'DE', 'DT', 'EDGE'], DB: ['DB', 'CB', 'S', 'SS', 'FS'],
  IDP: ['LB', 'DL', 'DB', 'DE', 'DT', 'CB', 'S', 'SS', 'FS', 'EDGE', 'IDP'],
  IDP_FLEX: ['LB', 'DL', 'DB', 'DE', 'DT', 'CB', 'S', 'SS', 'FS', 'EDGE', 'IDP'],
}

/** Special positions require positive evidence that the league actually starts them. */
export function waiverPositionEligible(position: string, rosterPositions: readonly string[]): boolean {
  const pos = position.toUpperCase()
  if (!SPECIAL.has(pos)) return true
  return rosterPositions.some(raw => {
    const slot = raw.toUpperCase()
    return slot === pos || !!GROUPS[slot]?.includes(pos)
  })
}
