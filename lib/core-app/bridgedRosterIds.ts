import 'server-only'

import { prisma } from '@/lib/prisma'
import { reduceCrosswalk } from './crosswalkRules'
import { collectRosterIds, ROSTER_KEYS } from './rosterIdSpace'

/**
 * Reading a Fleaflicker or MFL roster in Sleeper ids — or not reading it at all.
 *
 * These platforms' rosters hold the provider's own numeric ids, which OVERLAP Sleeper's (44 of 248
 * on the one production Fleaflicker league, 2026-09-27). `PlayerIdentityMap.fleaflickerId` /
 * `.mflId` carry a bridge, filled from the FantasyCalc cache by
 * `lib/player-identity/fantasyCalcIdentityBridge.ts`.
 *
 * Two rules, and they are why this is its own module rather than a widening of the ESPN translator
 * in `rosterIdSpace.ts`:
 *
 *   1. AN UNBRIDGED ID IS DROPPED, NEVER KEPT RAW. The ESPN translator keeps unmapped ids (they feed
 *      the finder's "unchecked league" coverage report, and none collide today). Here a raw id IS the
 *      collision: kept, it reads as whichever Sleeper player happens to share the number.
 *   2. A LEAGUE IS READABLE ONLY WHEN MOST OF IT TRANSLATES. Below `BRIDGE_MIN_COVERAGE` a miss means
 *      "we could not see", not "he is not here", so the caller must name the league as unchecked.
 */

export const BRIDGE_COLUMN_BY_PLATFORM = { fleaflicker: 'fleaflickerId', mfl: 'mflId' } as const
type BridgeColumn = (typeof BRIDGE_COLUMN_BY_PLATFORM)[keyof typeof BRIDGE_COLUMN_BY_PLATFORM]

/** Share of a league's distinct roster ids that must translate before a miss can be trusted. */
export const BRIDGE_MIN_COVERAGE = 0.8

export function bridgeColumnFor(platform: string | null | undefined): BridgeColumn | null {
  const p = (platform ?? '').trim().toLowerCase() as keyof typeof BRIDGE_COLUMN_BY_PLATFORM
  return BRIDGE_COLUMN_BY_PLATFORM[p] ?? null
}

export type BridgedLeague = {
  platform: string
  column: BridgeColumn
  /** Provider id → Sleeper id, one-to-one (ambiguous ids already dropped). */
  map: Map<string, string>
  total: number
  translated: number
  readable: boolean
}

/** Pure: is a league with this much translated readable? */
export function bridgeCoverageReadable(translated: number, total: number): boolean {
  return total > 0 && translated / total >= BRIDGE_MIN_COVERAGE
}

/**
 * Roster arrays in Sleeper ids: bridged ids replaced, UNBRIDGED ids DROPPED. Keys that are not
 * roster arrays are untouched.
 */
export function applyBridge(playerData: unknown, map: ReadonlyMap<string, string>): Record<string, unknown> {
  const pd = (playerData ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = { ...pd }
  for (const key of ROSTER_KEYS) {
    const arr = pd[key]
    if (!Array.isArray(arr)) continue
    out[key] = arr.flatMap((x) => {
      if (x == null) return []
      const to = map.get(String(x))
      return to ? [to] : []
    })
  }
  return out
}

/**
 * For the bridged-platform leagues among `leagues`: every roster read once, the bridge loaded once
 * per platform, and a readability verdict per league. Leagues on other platforms are absent from
 * the result, and a call with none of them makes no query.
 */
export async function loadBridgedLeagues(
  leagues: ReadonlyArray<{ id: string; platform: string | null | undefined }>,
  db: Pick<typeof prisma, 'roster' | 'playerIdentityMap'> = prisma,
): Promise<Map<string, BridgedLeague>> {
  const out = new Map<string, BridgedLeague>()
  const bridged = leagues.filter((l) => bridgeColumnFor(l.platform))
  if (bridged.length === 0) return out

  const rosters = await db.roster
    .findMany({ where: { leagueId: { in: bridged.map((l) => l.id) } }, select: { leagueId: true, playerData: true } })
    .catch(() => [] as Array<{ leagueId: string; playerData: unknown }>)
  const byLeague = new Map<string, unknown[]>()
  for (const r of rosters) (byLeague.get(r.leagueId) ?? byLeague.set(r.leagueId, []).get(r.leagueId)!).push(r.playerData)

  const byColumn = new Map<BridgeColumn, Set<string>>()
  const idsByLeague = new Map<string, string[]>()
  for (const l of bridged) {
    const column = bridgeColumnFor(l.platform)!
    const ids = collectRosterIds(byLeague.get(l.id) ?? [])
    idsByLeague.set(l.id, ids)
    const set = byColumn.get(column) ?? new Set<string>()
    for (const id of ids) set.add(id)
    byColumn.set(column, set)
  }

  const mapByColumn = new Map<BridgeColumn, Map<string, string>>()
  for (const [column, ids] of byColumn) {
    if (ids.size === 0) {
      mapByColumn.set(column, new Map())
      continue
    }
    const rows = await db.playerIdentityMap
      .findMany({
        where: { sport: 'NFL', [column]: { in: [...ids] }, sleeperId: { not: null } },
        select: { sleeperId: true, [column]: true } as { sleeperId: true; fleaflickerId: true; mflId: true },
      })
      .catch(() => [] as Array<{ sleeperId: string | null; fleaflickerId?: string | null; mflId?: string | null }>)
    mapByColumn.set(column, reduceCrosswalk(rows.map((r) => ({ from: r[column] ?? null, to: r.sleeperId }))))
  }

  for (const l of bridged) {
    const column = bridgeColumnFor(l.platform)!
    const map = mapByColumn.get(column) ?? new Map<string, string>()
    const ids = idsByLeague.get(l.id) ?? []
    const translated = ids.filter((id) => map.has(id)).length
    out.set(l.id, {
      platform: (l.platform ?? '').trim().toLowerCase(),
      column,
      map,
      total: ids.length,
      translated,
      readable: bridgeCoverageReadable(translated, ids.length),
    })
  }
  return out
}

/** The searched player's own id on each bridged platform — to tell "not here" from "cannot see him". */
export async function bridgeIdsForSleeperId(
  sleeperId: string,
  db: Pick<typeof prisma, 'playerIdentityMap'> = prisma,
): Promise<Partial<Record<BridgeColumn, string>>> {
  const row = await db.playerIdentityMap
    .findUnique({ where: { sleeperId }, select: { fleaflickerId: true, mflId: true } })
    .catch(() => null)
  const out: Partial<Record<BridgeColumn, string>> = {}
  if (row?.fleaflickerId) out.fleaflickerId = row.fleaflickerId
  if (row?.mflId) out.mflId = row.mflId
  return out
}
