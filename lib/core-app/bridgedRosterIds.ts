import 'server-only'

import { prisma } from '@/lib/prisma'
import { reduceCrosswalk } from './crosswalkRules'
import { declaredSleeperId } from './declaredSleeperId'
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
type IdentityBridgeColumn = (typeof BRIDGE_COLUMN_BY_PLATFORM)[keyof typeof BRIDGE_COLUMN_BY_PLATFORM]

/**
 * 🛑 A PASTED YAHOO LEAGUE BRIDGES BY ITS OWN SPELLING, WITH NO READ (2026-11-26). The paste import
 * resolves each player at import time and stores him DECLARED (`sleeper:<id>`, declaredSleeperId.ts);
 * an unmatched player keeps a `yahoo-paste:` id. So the bridge for such a league is the roster itself:
 * a declared id maps to its Sleeper id, anything else — a `yahoo-paste:` id, or a bare Yahoo number
 * from any other import — is unbridged and DROPPED, exactly as an unbridged Fleaflicker id is. The
 * same `BRIDGE_MIN_COVERAGE` rule then decides whether a miss can be trusted. Until this, every
 * reader below treated the league as unreadable although most of its players carried a Sleeper id.
 *
 * `'declared'` is not a `PlayerIdentityMap` column. Anything that reads the registry by `column` must
 * branch on `isDeclaredBridge` first.
 */
export const DECLARED_BRIDGE = 'declared' as const
const DECLARED_BRIDGE_PLATFORMS = new Set(['yahoo'])
type BridgeColumn = IdentityBridgeColumn | typeof DECLARED_BRIDGE

export function isDeclaredBridge(column: string | null | undefined): column is typeof DECLARED_BRIDGE {
  return column === DECLARED_BRIDGE
}

/** Share of a league's distinct roster ids that must translate before a miss can be trusted. */
export const BRIDGE_MIN_COVERAGE = 0.8

export function bridgeColumnFor(platform: string | null | undefined): BridgeColumn | null {
  const p = (platform ?? '').trim().toLowerCase() as keyof typeof BRIDGE_COLUMN_BY_PLATFORM
  if (DECLARED_BRIDGE_PLATFORMS.has(p)) return DECLARED_BRIDGE
  return BRIDGE_COLUMN_BY_PLATFORM[p] ?? null
}

/** Declared id → its Sleeper id, for the declared ids among `ids`. Pure; no read. */
export function declaredBridgeMap(ids: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>()
  for (const id of ids) {
    const sid = declaredSleeperId(id)
    if (sid) out.set(id, sid)
  }
  return out
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
 * Pure: a league's distinct roster ids against its bridge — how many translate, and whether a miss can
 * be trusted. THE coverage rule; `loadBridgedLeagues` and `declaredAvailability.ts` both read it.
 */
export function bridgeVerdict(
  ids: readonly string[],
  map: ReadonlyMap<string, string>,
): { total: number; translated: number; readable: boolean } {
  const translated = ids.filter((id) => map.has(id)).length
  return { total: ids.length, translated, readable: bridgeCoverageReadable(translated, ids.length) }
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

/** The prefix an unbridged id carries in `applyBridgeKeepingSlots` output. */
export const UNBRIDGED_ID_PREFIX = 'unbridged:'

/** Is this id a placeholder for a roster player the bridge could not identify? */
export function isUnbridgedId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(UNBRIDGED_ID_PREFIX)
}

/**
 * `applyBridge` for readers that need the roster's SHAPE, not just its membership.
 *
 * `applyBridge` drops an empty slot ('0') and every unbridged id, so a starters array shifts: the
 * player in slot 3 lands in slot 2. A lineup reader maps starters to slots BY INDEX, so that shift
 * misplaces players. Here an empty slot stays '0', and an unbridged id stays in place as
 * `unbridged:<providerId>` — never a bare number, so nothing can read it as the Sleeper player who
 * shares it, and a caller can count what it cannot see (`isUnbridgedId`) instead of losing it.
 */
export function applyBridgeKeepingSlots(playerData: unknown, map: ReadonlyMap<string, string>): Record<string, unknown> {
  const pd = (playerData ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = { ...pd }
  for (const key of ROSTER_KEYS) {
    const arr = pd[key]
    if (!Array.isArray(arr)) continue
    out[key] = arr.flatMap((x) => {
      if (x == null) return []
      const raw = String(x)
      if (raw === '0') return ['0']
      const to = map.get(raw)
      return [to ?? `${UNBRIDGED_ID_PREFIX}${raw}`]
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
    if (isDeclaredBridge(column)) {
      mapByColumn.set(column, declaredBridgeMap(ids))
      continue
    }
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
    out.set(l.id, { platform: (l.platform ?? '').trim().toLowerCase(), column, map, ...bridgeVerdict(ids, map) })
  }
  return out
}

/**
 * Is this a pasted-Yahoo league whose DECLARED ids clear the coverage bar — so its rosters, read
 * through `sleeperReadableRosters` (which keeps declared ids, unwrapped), can be trusted for a miss?
 * False for every other league, with no query. For readers that refuse a foreign league outright.
 */
export async function isDeclaredReadableLeague(
  league: { id: string; platform: string | null | undefined },
  db: Pick<typeof prisma, 'roster' | 'playerIdentityMap'> = prisma,
): Promise<boolean> {
  if (!isDeclaredBridge(bridgeColumnFor(league.platform))) return false
  const verdict = (await loadBridgedLeagues([league], db).catch(() => null))?.get(league.id)
  return verdict?.readable === true
}

/** The searched player's own id on each bridged platform — to tell "not here" from "cannot see him". */
export async function bridgeIdsForSleeperId(
  sleeperId: string,
  db: Pick<typeof prisma, 'playerIdentityMap'> = prisma,
): Promise<Partial<Record<BridgeColumn, string>>> {
  // NFL, as the bridge itself is (`loadBridgedLeagues` reads `sport: 'NFL'`): `sleeperId` is the NFL
  // Sleeper column, and an NBA id read here would hand back an NFL player's bridge ids.
  const row = await db.playerIdentityMap
    .findUnique({ where: { sleeperId, sport: 'NFL' }, select: { fleaflickerId: true, mflId: true } })
    .catch(() => null)
  // Every player has a declared spelling (`sleeper:<his id>`): a declared league can always see him.
  const out: Partial<Record<BridgeColumn, string>> = { [DECLARED_BRIDGE]: sleeperId }
  if (row?.fleaflickerId) out.fleaflickerId = row.fleaflickerId
  if (row?.mflId) out.mflId = row.mflId
  return out
}
