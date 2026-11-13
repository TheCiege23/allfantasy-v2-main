/**
 * Map Sleeper `roster_positions` to starter slot metadata and display labels.
 */

/** Labels for starter slots only (QB, RB1, RB2, WR1, …). */
export function getStarterSlotLabels(rosterPositions: string[]): string[] {
  const starterPositions = rosterPositions.filter((p) => !['BN', 'IR', 'TAXI'].includes(p))
  const countByPos: Record<string, number> = {}
  return starterPositions.map((pos) => {
    const total = starterPositions.filter((x) => x === pos).length
    countByPos[pos] = (countByPos[pos] ?? 0) + 1
    const n = countByPos[pos]
    if (total <= 1) return pos
    return `${pos}${n}`
  })
}
