import { prisma } from '@/lib/prisma'

/**
 * Which player-id vocabulary a league's rosters speak, and the translation that
 * lets every Sleeper-id read in the Player Finder see through it.
 *
 * ⚠ ESPN ROSTERS ARE ESPN IDS, AND THE LINK TO OUR IDS ALREADY EXISTS. Measured on
 * production 2026-09-07: 263 distinct ESPN ids across the imported ESPN rosters,
 * 263 named in `sports_core_player_provider_identities`, 198 linked to a canonical
 * player, and 185 carried on `PlayerIdentityMap.espnId` next to a `sleeperId` —
 * written by `lib/espn/linkEspnIdentities.ts` from `/api/cron/import-players`.
 * Until now the Finder's rosters reads (`managerPresence`, `playerLeagueView`,
 * `playerFinder`, `playerSuggest`) scanned ESPN rosters for a Sleeper id, found
 * nothing, and the vocabulary guard correctly refused. Seventy percent of those
 * ids were resolvable one indexed read away. A day was spent believing the link
 * did not exist because `SportsPlayer` had no `source = 'espn'` rows — the wrong
 * table. See [[an-absence-is-only-as-good-as-where-you-looked]].
 *
 * WHAT THIS DOES: given a platform and its rosters, rewrite the roster arrays
 * (`players`, `starters`, `reserve`, `taxi`) through `espnId → sleeperId`. An id
 * with no mapping is KEPT AS IS — it then fails every Sleeper-id match honestly
 * and counts against the vocabulary guard, exactly as before. Sleeper and manual
 * leagues (AllFantasy's own id space IS Sleeper's) pass through untouched with no
 * query. Yahoo has no column on `PlayerIdentityMap` yet, so it passes through
 * untouched too and stays refused by the guard.
 *
 * WHAT THIS DOES NOT DO: write anything, or guess. The identity chain is the
 * import pipeline's job; this only reads what it has already verified.
 */

export type RosterIdSpace = 'sleeper' | 'espn' | 'other'

const ROSTER_KEYS = ['players', 'starters', 'reserve', 'taxi'] as const

export function rosterIdSpaceOf(platform: string | null | undefined): RosterIdSpace {
  const p = (platform ?? '').trim().toLowerCase()
  if (p === 'espn') return 'espn'
  if (p === '' || p === 'sleeper' || p === 'manual' || p === 'allfantasy') return 'sleeper'
  return 'other'
}

/** Every distinct id across the roster arrays, as strings. */
export function collectRosterIds(playerDatas: readonly unknown[]): string[] {
  const seen = new Set<string>()
  for (const raw of playerDatas) {
    const pd = (raw ?? {}) as Record<string, unknown>
    for (const key of ROSTER_KEYS) {
      const arr = pd[key]
      if (!Array.isArray(arr)) continue
      for (const x of arr) {
        if (x == null) continue
        const id = String(x)
        if (id) seen.add(id)
      }
    }
  }
  return [...seen]
}

/**
 * The same object with each roster array mapped through `map`. Ids without a
 * mapping are kept; keys that are not roster arrays are untouched; an empty map
 * returns the input object itself.
 */
export function translatePlayerData(playerData: unknown, map: ReadonlyMap<string, string>): Record<string, unknown> {
  const pd = (playerData ?? {}) as Record<string, unknown>
  if (map.size === 0) return pd
  const out: Record<string, unknown> = { ...pd }
  for (const key of ROSTER_KEYS) {
    const arr = pd[key]
    if (!Array.isArray(arr)) continue
    out[key] = arr.map((x) => {
      if (x == null) return x
      const id = String(x)
      return map.get(id) ?? x
    })
  }
  return out
}

/** `espnId → sleeperId` for the ids given, from rows that carry both. One indexed read. */
export async function loadEspnToSleeperMap(espnIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(espnIds.filter(Boolean))]
  if (ids.length === 0) return out
  const rows = await prisma.playerIdentityMap
    .findMany({
      where: { espnId: { in: ids }, sleeperId: { not: null } },
      select: { espnId: true, sleeperId: true },
    })
    .catch(() => [] as Array<{ espnId: string | null; sleeperId: string | null }>)
  for (const r of rows) {
    if (r.espnId && r.sleeperId && !out.has(r.espnId)) out.set(r.espnId, r.sleeperId)
  }
  return out
}

export type TranslatedRosters<T> = {
  rosters: T[]
  idSpace: RosterIdSpace
  /** Distinct ids the rosters held. */
  total: number
  /** How many of them were rewritten to a Sleeper id. */
  translated: number
}

/** One league's rosters, translated when the platform needs it. No query for Sleeper-id leagues. */
export async function translateRostersToSleeperIds<T extends { playerData: unknown }>(
  platform: string | null | undefined,
  rosters: readonly T[],
): Promise<TranslatedRosters<T>> {
  const idSpace = rosterIdSpaceOf(platform)
  if (idSpace !== 'espn' || rosters.length === 0) return { rosters: [...rosters], idSpace, total: 0, translated: 0 }
  const ids = collectRosterIds(rosters.map((r) => r.playerData))
  const map = await loadEspnToSleeperMap(ids)
  let translated = 0
  for (const id of ids) if (map.has(id)) translated += 1
  return {
    rosters: rosters.map((r) => ({ ...r, playerData: translatePlayerData(r.playerData, map) })),
    idSpace,
    total: ids.length,
    translated,
  }
}

/**
 * Rosters spanning many leagues, translated per league platform with ONE read for
 * every ESPN id across them. Rosters of leagues absent from `platformByLeague`
 * are treated as Sleeper-id rosters.
 */
export async function translateRostersByLeague<T extends { leagueId: string; playerData: unknown }>(
  rosters: readonly T[],
  platformByLeague: ReadonlyMap<string, string | null | undefined>,
): Promise<T[]> {
  const espn = rosters.filter((r) => rosterIdSpaceOf(platformByLeague.get(r.leagueId)) === 'espn')
  if (espn.length === 0) return [...rosters]
  const map = await loadEspnToSleeperMap(collectRosterIds(espn.map((r) => r.playerData)))
  if (map.size === 0) return [...rosters]
  return rosters.map((r) =>
    rosterIdSpaceOf(platformByLeague.get(r.leagueId)) === 'espn'
      ? { ...r, playerData: translatePlayerData(r.playerData, map) }
      : r,
  )
}
