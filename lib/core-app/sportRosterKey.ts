import { isNativePlatform } from '@/lib/league/isNativeLeague'

/**
 * The player key the Player Finder home uses for a roster in a sport OTHER than NFL.
 *
 * Pure and client-safe; the loader is `sportRosterTranslate.ts`.
 *
 * WHY A SECOND KEY. Every home reader (shares, flagged starters) was written for NFL and keys a
 * player by his Sleeper id. A Fantrax NHL roster holds Fantrax ids (`04yla`), a native NBA roster holds
 * Rolling Insights ids, and a Sleeper NBA roster holds Sleeper's NBA numbers — none of which may be read
 * as an NFL Sleeper id (rosterIdSpace.ts). So those leagues used to be counted as "a platform we can't
 * read yet" and their players never appeared. They are now translated, through `PlayerIdentityMap`,
 * to the CATALOG row that names the player (`SportsPlayer` sport + source + externalId), and that row's
 * identity is the key.
 *
 * ⚠ THE KEY CARRIES ITS SPORT. Shares count across leagues by key; a bare provider number would let
 * NBA Rolling Insights 1234 and NHL Rolling Insights 1234 merge into one "player held in 2 leagues".
 * `NBA|rolling_insights|1234` cannot collide with anything, and it cannot be mistaken for a Sleeper id
 * (which never contains `|`).
 */

export const SPORT_KEY_SEP = '|'

export type SportKeyParts = { sport: string; source: string; externalId: string }

export function sportPlayerKey(sport: string, source: string, externalId: string): string {
  return [String(sport).toUpperCase(), String(source).toLowerCase(), externalId].join(SPORT_KEY_SEP)
}

/** True for a key minted by `sportPlayerKey`; false for an NFL Sleeper id (digits, or a club abbreviation for a defense). */
export function isSportPlayerKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.includes(SPORT_KEY_SEP)
}

export function parseSportPlayerKey(key: string): SportKeyParts | null {
  const parts = key.split(SPORT_KEY_SEP)
  if (parts.length !== 3 || parts.some((p) => !p)) return null
  return { sport: parts[0]!, source: parts[1]!, externalId: parts[2]! }
}

/** The league's sport as the readers compare it — a missing sport is NFL, as everywhere else. */
export function leagueSportOf(sport: string | null | undefined): string {
  const s = String(sport ?? '').trim().toUpperCase()
  return s || 'NFL'
}

/**
 * Which column of `PlayerIdentityMap` a league's roster ids live in, or a direct catalog source.
 *
 *   - `identity`: look the id up in that column, then follow the identity to its catalog row.
 *   - `catalog`: the roster already holds a catalog id (a native league holds Rolling Insights or
 *     TheSportsDB ids) — `source` names which.
 *   - `sleeperCatalog`: a Sleeper league of another sport holds Sleeper's numbers for THAT sport,
 *     which the catalog stores in `sleeperId` on that sport's rows.
 *
 * Null for a platform with no id link in that sport: the league stays "can't read yet", never read raw.
 */
export type RosterIdRoute =
  | { kind: 'identity'; column: 'fantraxId' | 'espnId' | 'mflId' | 'fleaflickerId' | 'sleeperNbaId' }
  | { kind: 'catalog' }
  | { kind: 'sleeperCatalog' }

export function rosterIdRouteFor(platform: string | null | undefined, sport: string | null | undefined): RosterIdRoute | null {
  const s = leagueSportOf(sport)
  if (s === 'NFL') return null // NFL keeps the Sleeper-id readers it has always had.
  const p = String(platform ?? '').trim().toLowerCase()
  if (isNativePlatform(p)) return { kind: 'catalog' }
  if (p === 'sleeper') return { kind: 'sleeperCatalog' }
  if (p === 'fantrax') return { kind: 'identity', column: 'fantraxId' }
  if (p === 'espn') return { kind: 'identity', column: 'espnId' }
  if (p === 'mfl') return { kind: 'identity', column: 'mflId' }
  if (p === 'fleaflicker') return { kind: 'identity', column: 'fleaflickerId' }
  return null
}

/** A native roster id's catalog source: Rolling Insights numbers, or TheSportsDB's `tsdb_` ids (soccer). */
export function nativeCatalogSource(id: string): 'rolling_insights' | 'thesportsdb' | null {
  if (/^tsdb_/.test(id)) return 'thesportsdb'
  if (/^\d+$/.test(id)) return 'rolling_insights'
  return null
}
