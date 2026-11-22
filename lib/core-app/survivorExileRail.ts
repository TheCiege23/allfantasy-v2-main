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

/**
 * The dashboard's league card: up to `limit` leagues, each Survivor league carrying its Exile Island
 * with it. An island never takes one of the `limit` places, and it is pulled from `pool` (every
 * league, not only the capped queue) when the queue holds the Survivor league but not the island,
 * so the pair is never split by the cap.
 */
export function leagueCardGroups<T extends { id: string; exileOf?: string }>(
  leagues: readonly T[],
  pool: readonly T[],
  limit: number,
): Array<{ league: T; islands: T[] }> {
  const present = new Set(leagues.map((row) => row.id))
  const groups: Array<{ league: T; islands: T[] }> = []
  for (const row of pairExileUnderSurvivor(leagues)) {
    const main = row.exileOf && row.exileOf !== row.id && present.has(row.exileOf) ? row.exileOf : null
    const owner = main ? groups.find((group) => group.league.id === main) : undefined
    if (owner) owner.islands.push(row)
    else if (!main) groups.push({ league: row, islands: [] })
  }
  const shown = groups.slice(0, limit)
  for (const group of shown) {
    for (const row of pool) {
      if (row.exileOf === group.league.id && row.id !== group.league.id && !present.has(row.id)) group.islands.push(row)
    }
  }
  return shown
}
