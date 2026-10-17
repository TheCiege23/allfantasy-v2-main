/**
 * League player ids → Rolling Insights ids, through `PlayerIdentityMap`, for reading
 * `player_season_stats` / anything else written in RI's own id space.
 *
 * 🛑 A ROSTER ID IS NEVER AN RI ID BY COINCIDENCE OF NUMBER. `player_season_stats` rows with
 * `source = 'rolling_insights'` are keyed on RI's own player number; an NFL redraft roster holds
 * SLEEPER ids (ESPN / Fleaflicker rosters hold those platforms' ids). The spaces overlap for
 * different people: Sleeper 6794 is Justin Jefferson, RI 6794 is DaRon Bland (measured on
 * production 2026-10-11 — 251 rostered NFL ids joined a stranger's 2026 RI row that way). So an
 * id is asked of the ONE identity column its league speaks (`leagueIdentityColumns`), and the
 * row's `rollingInsightsId` is what reaches the stats table.
 *
 * Refusals, never guesses:
 *   - an id whose column matches identity rows carrying MORE THAN ONE distinct RI id
 *     (`espnId` / `fleaflickerId` are not unique), and
 *   - an RI id CLAIMED BY MORE THAN ONE requested id — two roster slots resolving to one person
 *     means at least one of them is someone else.
 * Both land in `ambiguous` and get no RI id at all.
 *
 * `rollingInsightsId`-column ids (a native non-NFL roster, e.g. NHL) already ARE RI ids and pass
 * through unchanged — `leagueIdentityColumns` only routes a bare number there when it cannot be a
 * Sleeper id.
 */

import type { LeagueIdentityColumn } from './externalIdNamespace'

export type RiCrosswalkIdentity = {
  rollingInsightsId: string
  canonicalName: string | null
  currentTeam: string | null
  position: string | null
}

type IdentityRow = {
  rollingInsightsId: string | null
  canonicalName: string | null
  currentTeam: string | null
  position: string | null
} & Partial<Record<LeagueIdentityColumn, string | null>>

export type RiCrosswalkDb = {
  playerIdentityMap: {
    findMany(args: { where: Record<string, unknown>; select: Record<string, true> }): Promise<IdentityRow[]>
  }
}

export type RiCrosswalk = {
  /** Requested id → the identity whose RI id it resolves to. Unmapped and ambiguous ids are absent. */
  byId: Map<string, RiCrosswalkIdentity>
  /** Requested ids refused because the mapping was not one-to-one. */
  ambiguous: string[]
}

export async function crosswalkToRollingInsightsIds(
  db: RiCrosswalkDb,
  args: { sport: string; lookups: Array<{ column: LeagueIdentityColumn; ids: readonly string[] }> },
): Promise<RiCrosswalk> {
  const sport = String(args.sport ?? '').trim().toUpperCase()
  const lookups = args.lookups
    .map(({ column, ids }) => ({
      column,
      ids: [...new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean))],
    }))
    .filter((l) => l.ids.length > 0)

  /** requested id → every distinct RI identity its column matched. */
  const candidates = new Map<string, Map<string, RiCrosswalkIdentity>>()
  const add = (id: string, identity: RiCrosswalkIdentity) => {
    const held = candidates.get(id) ?? new Map<string, RiCrosswalkIdentity>()
    if (!held.has(identity.rollingInsightsId)) held.set(identity.rollingInsightsId, identity)
    candidates.set(id, held)
  }

  for (const { column, ids } of lookups) {
    if (column !== 'rollingInsightsId') continue
    for (const id of ids) add(id, { rollingInsightsId: id, canonicalName: null, currentTeam: null, position: null })
  }

  const viaMap = lookups.filter((l) => l.column !== 'rollingInsightsId')
  if (viaMap.length > 0) {
    const select: Record<string, true> = {
      rollingInsightsId: true,
      canonicalName: true,
      currentTeam: true,
      position: true,
    }
    for (const { column } of viaMap) select[column] = true
    const rows = await db.playerIdentityMap.findMany({
      where: {
        sport,
        rollingInsightsId: { not: null },
        OR: viaMap.map(({ column, ids }) => ({ [column]: { in: ids } })),
      },
      select,
    })
    for (const { column, ids } of viaMap) {
      const requested = new Set(ids)
      for (const row of rows) {
        const sourceId = String(row[column] ?? '').trim()
        const ri = String(row.rollingInsightsId ?? '').trim()
        if (!sourceId || !ri || !requested.has(sourceId)) continue
        add(sourceId, {
          rollingInsightsId: ri,
          canonicalName: row.canonicalName ?? null,
          currentTeam: row.currentTeam ?? null,
          position: row.position ?? null,
        })
      }
    }
  }

  const ambiguous = new Set<string>()
  const claimants = new Map<string, string[]>()
  for (const [id, byRi] of candidates) {
    if (byRi.size !== 1) {
      ambiguous.add(id)
      continue
    }
    const ri = [...byRi.keys()][0]!
    claimants.set(ri, [...(claimants.get(ri) ?? []), id])
  }
  for (const ids of claimants.values()) {
    if (ids.length > 1) for (const id of ids) ambiguous.add(id)
  }

  const byId = new Map<string, RiCrosswalkIdentity>()
  for (const [id, byRi] of candidates) {
    if (ambiguous.has(id)) continue
    byId.set(id, [...byRi.values()][0]!)
  }
  return { byId, ambiguous: [...ambiguous] }
}
