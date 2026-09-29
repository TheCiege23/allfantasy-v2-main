import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import {
  indexBySleeperId,
  mayBeSleeperId,
  nonSleeperExternalIdWhere,
  sleeperIdWhere,
} from '@/lib/player-identity/externalIdNamespace'

function fallbackPlayerLabel(playerId: string): string {
  return `Player ${playerId.slice(0, 8)}`
}

function setNameIfPresent(map: Map<string, string>, playerId: string | null | undefined, name: string | null | undefined): void {
  if (!playerId || !name || map.has(playerId)) return
  const trimmed = name.trim()
  if (!trimmed) return
  map.set(playerId, trimmed)
}

function normalizeSport(sport: LeagueSport | string | null | undefined): string {
  const raw = String(sport ?? 'NFL').trim().toUpperCase()
  return raw || 'NFL'
}

export function normalizePlayerLookupToken(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The `PlayerIdentityMap` column that holds a foreign platform's own ids. A platform with no column
 * here (Yahoo, anything unrecognised) is named by nobody — its ids get the neutral fallback label.
 */
const FOREIGN_IDENTITY_COLUMN = {
  espn: 'espnId',
  mfl: 'mflId',
  myfantasyleague: 'mflId',
  fleaflicker: 'fleaflickerId',
  fantrax: 'fantraxId',
} as const
type ForeignColumn = (typeof FOREIGN_IDENTITY_COLUMN)[keyof typeof FOREIGN_IDENTITY_COLUMN]

/**
 * Name the players a league's rosters refer to.
 *
 * 🛑 `platform` IS REQUIRED BECAUSE A PLAYER ID IS ONLY MEANINGFUL IN ITS LEAGUE'S ID SPACE. This
 * used to take ids alone and ask every table and every provider column at once, keeping whichever
 * name came back first. Sleeper, ESPN, Fleaflicker, MFL, Rolling Insights and the backfill all write
 * small numbers, and the same number is a different person in each (Sleeper 9228 is Bryce Young;
 * Rolling Insights 9228 is an offensive tackle). So a Sleeper id with no Sleeper row picked up a
 * stranger's name from `SportsPlayer.externalId`, and an ESPN id was read as a Sleeper id by the
 * canonical lookup. Now each league's ids are asked only of the places that speak that space:
 *
 *   - Sleeper league       every id is a Sleeper id — canonical players, the identity map's
 *                          `sleeperId`, `SportsPlayer` by Sleeper id. Never `externalId`.
 *   - native league        a bare number in NFL is a Sleeper id (handled as above). Anything else is
 *                          self-describing (`name:Josh Allen:QB:BUF`, `tsdb_34415964`) or a provider
 *                          id in a sport Sleeper does not cover (a native NHL roster holds Rolling
 *                          Insights ids) — those are the ids `externalId` legitimately names.
 *   - ESPN/MFL/Fleaflicker/Fantrax   only that platform's identity-map column.
 *   - anything else        nothing; the neutral fallback label beats a stranger's name.
 *
 * Measured on production 2026-09-29, the native split loses no name that was right: of 186 native
 * NFL roster ids, the 25 named only through `externalId` were 24 `name:` backfill ids and one
 * `tsdb_` id; all 72 native NHL ids were Rolling Insights numbers.
 */
export async function resolvePlayerNamesForSport(
  playerIds: string[],
  sport: LeagueSport | string | null | undefined,
  platform: string | null | undefined,
): Promise<Map<string, string>> {
  const uniquePlayerIds = [...new Set(playerIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))]
  const nameMap = new Map<string, string>()
  if (uniquePlayerIds.length === 0) return nameMap

  const normalizedSport = normalizeSport(sport)
  const p = String(platform ?? '').trim().toLowerCase()
  const native = isNativePlatform(p)
  const foreignColumn: ForeignColumn | null =
    (FOREIGN_IDENTITY_COLUMN as Record<string, ForeignColumn | undefined>)[p] ?? null

  const sleeperIds = p === 'sleeper'
    ? uniquePlayerIds
    : native
      ? uniquePlayerIds.filter((id) => mayBeSleeperId(id, normalizedSport))
      : []
  const nativeOtherIds = native ? uniquePlayerIds.filter((id) => !sleeperIds.includes(id)) : []

  if (sleeperIds.length > 0) {
    if (normalizedSport === 'NFL') {
      try {
        // Canonical read path: a fixed 3 queries against `Player` + `PlayerProviderIdentity`, keyed
        // by Sleeper id. Ids with no canonical player are simply absent, so the reads below still run.
        const { getCanonicalPlayersBySleeperIds } = await import('@/lib/canonical/getCanonicalPlayer')
        const canonical = await getCanonicalPlayersBySleeperIds(sleeperIds)
        for (const playerId of sleeperIds) setNameIfPresent(nameMap, playerId, canonical.get(playerId)?.name)
      } catch {
        // Fall through to local database lookups.
      }
    }

    try {
      const rows = await prisma.playerIdentityMap.findMany({
        where: { sport: normalizedSport, sleeperId: { in: sleeperIds } },
        select: { canonicalName: true, sleeperId: true },
      })
      for (const row of rows) setNameIfPresent(nameMap, row.sleeperId, row.canonicalName)
    } catch {
      // Optional mapping layer; ignore lookup failures.
    }

    try {
      const unnamed = sleeperIds.filter((id) => !nameMap.has(id))
      if (unnamed.length > 0) {
        const rows = await prisma.sportsPlayer.findMany({
          where: sleeperIdWhere(unnamed, normalizedSport),
          select: { sleeperId: true, source: true, name: true },
        })
        for (const [sleeperId, row] of indexBySleeperId(rows)) setNameIfPresent(nameMap, sleeperId, row.name)
      }
    } catch {
      // Optional lookup; ignore failures.
    }
  }

  if (foreignColumn) {
    /*
     * ⚠ ONE COLUMN, NOT NINE. The old read matched every provider column and bound the row's name to
     * all of them, so an ESPN id equal to some row's Fleaflicker or Sleeper id named that row's
     * player. `fantraxId` was measured collision-free across columns on the TEST database
     * (2026-09-19, 4,128 NCAAF rows) — that stays true, and now does not have to.
     */
    try {
      const rows = await prisma.playerIdentityMap.findMany({
        where: { sport: normalizedSport, [foreignColumn]: { in: uniquePlayerIds } },
        select: { canonicalName: true, [foreignColumn]: true },
      })
      for (const row of rows as Array<Record<string, string | null>>) {
        setNameIfPresent(nameMap, row[foreignColumn], row.canonicalName)
      }
    } catch {
      // Optional mapping layer; ignore lookup failures.
    }
  }

  if (nativeOtherIds.length > 0) {
    try {
      const rows = await prisma.sportsPlayer.findMany({
        where: nonSleeperExternalIdWhere(nativeOtherIds, normalizedSport),
        select: { externalId: true, name: true },
      })
      for (const row of rows) setNameIfPresent(nameMap, row.externalId, row.name)
    } catch {
      // Optional lookup; ignore failures.
    }
  }

  for (const playerId of uniquePlayerIds) {
    if (!nameMap.has(playerId)) {
      nameMap.set(playerId, fallbackPlayerLabel(playerId))
    }
  }

  return nameMap
}
