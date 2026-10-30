/**
 * Moves each Exile Island row directly under its Survivor league, so the rail reads them as one pair.
 *
 * Only pairs whose Survivor league is in `rows`: an island whose league is hidden or filtered out
 * keeps its own place. Everything else keeps the input order (the account's drag order).
 */
export function pairExileUnderSurvivor<T extends { id: string; exileOf?: string }>(rows: readonly T[]): T[] {
  const present = new Set(rows.map((row) => row.id))
  const islandsByLeague = new Map<string, T[]>()
  for (const row of rows) {
    if (!row.exileOf || !present.has(row.exileOf) || row.exileOf === row.id) continue
    const islands = islandsByLeague.get(row.exileOf)
    if (islands) islands.push(row)
    else islandsByLeague.set(row.exileOf, [row])
  }
  if (islandsByLeague.size === 0) return [...rows]
  const out: T[] = []
  for (const row of rows) {
    if (row.exileOf && islandsByLeague.get(row.exileOf)?.includes(row)) continue
    out.push(row)
    const islands = islandsByLeague.get(row.id)
    if (islands) out.push(...islands)
  }
  return out
}

/** The ids of Exile Island rows that `pairExileUnderSurvivor` placed under their league. */
export function pairedExileIds(rows: ReadonlyArray<{ id: string; exileOf?: string }>): Set<string> {
  const present = new Set(rows.map((row) => row.id))
  return new Set(rows.filter((row) => row.exileOf && row.exileOf !== row.id && present.has(row.exileOf)).map((row) => row.id))
}
