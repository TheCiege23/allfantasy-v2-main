import type { FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'
import { identityNameKey } from '@/lib/redraft/rosterGameLogIdBridge'
import {
  compactNhlFantraxUniverse,
  FANTRAX_PROSPECT_ID_PREFIX,
  fantraxDisplayName,
  parseNhlFantraxUniverse,
  type NhlFantraxUniverseRow,
  type NhlFantraxUniverseSnapshot,
} from './nhlFantraxProspects'
import { proTeamCode } from './proFantraxIdentityPlan'

/**
 * MLB prospects for a dynasty ROOKIE draft, from the Fantrax MLB player universe we already read.
 * The MLB twin of `nhlFantraxProspects.ts` (read that header first; this one only states where MLB
 * differs). `contracts/fantrax/GAPS.md` F-16 records the limits.
 *
 * WHERE THE DATA COMES FROM. `getPlayerIds?sport=MLB` is read weekly by
 * `ingestProFantraxIdentities('MLB')` (via `ingestMlbFantraxIdentities`, scheduled from
 * `/api/cron/import-players`). Its last run (2026-10-25) read 10,687 rows: 2,802 already linked, 3
 * ambiguous, and 7,882 unmatched and discarded. The same response is now also stored, compacted, under
 * `MLB_FANTRAX_UNIVERSE_CACHE_KEY`. This module only READS that row and `PlayerIdentityMap`: it is
 * DB-first and calls no provider.
 *
 * 🛑 WHY THE EXCLUSION HAS A SECOND GUARD HERE. On 2026-10-25 MLB had 7,320 identities but only 2,825
 * carried a `fantraxId`, so about 4,500 MLB players we ALREADY track are not linked to Fantrax (NHL: 4,386
 * and 2,388). The `fantraxId` test alone would list every one of them as a prospect. The name test is
 * the main guard, run against all MLB identities; a third test catches the same man spelt differently
 * on the two sides (a nickname, "J.P." vs "JP", a dropped middle initial).
 *
 * THE RULE. A Fantrax MLB row is a prospect when NONE of these is true:
 *   1. its `fantraxId` is on an MLB `PlayerIdentityMap` row;
 *   2. its name (`identityNameKey` form, generational suffix dropped) is an MLB identity's name;
 *   3. an MLB identity on the SAME club, with the same surname and first initial and a compatible role
 *      (pitcher / hitter; a two-way player is both), exists — we treat that as the same tracked player;
 *   4. its name is already on the league's pool (checked by the draft-pool caller);
 *   5. its team is not a current MLB club (`proTeamCode('MLB', …)`) and not Fantrax's no-club marker
 *      `(N/A)`. ⚠ That marker is CAPTURED for NBA and NHL (F-01); the only MLB capture holds three
 *      major leaguers and no unsigned row, so for MLB it is assumed from those two. If Fantrax MLB
 *      spells it differently, those rows are refused (rule 5), never guessed;
 *   6. its position is not a baseball position (C, 1B, 2B, 3B, SS, OF, LF, CF, RF, DH, UT, P, SP, RP,
 *      TWP). A row naming both a pitching and a hitting position, or `TWP`, is listed as `TWP`;
 *   7. another candidate shares its name (neither can be told apart later): both are dropped.
 *
 * ⚠ WHAT IT CANNOT KNOW: no age, draft year, level (AAA … rookie ball, college, international) or
 * prospect flag (F-01, F-10). So the `(N/A)` bucket also holds released veterans and retirees who
 * never reached our registry, and a signed minor-league veteran looks like a prospect. A row's `team`
 * is assumed to be the parent club, as it is for an AHL player in the NHL capture — unverified for MLB.
 *
 * ORDER AND CAP. Signed players first, then newest Fantrax id first (ids are handed out as players
 * are added — a weak proxy for "recent draft class"), only to choose WHICH rows fit under the cap.
 * The cap is 900: 30 clubs × the 30-deep per-club prospect list that is the usual published depth. A
 * dynasty rookie draft takes a few rounds per team, so 900 is far more than any board consumes while
 * keeping the board bounded.
 *
 * IDS. A prospect is drafted as `fantrax:<fantraxId>`; `lib/redraft/rosterGameLogIdBridge.ts` maps it
 * through `PlayerIdentityMap.fantraxId` within the MLB sport keys once the weekly job links him.
 */

export const MLB_FANTRAX_UNIVERSE_CACHE_KEY = 'fantrax:mlb-player-universe'

/** How many prospects an MLB rookie draft board carries at most (see ORDER AND CAP). */
export const MLB_FANTRAX_PROSPECT_LIMIT = 900

/** Same stored shape as NHL: `[fantraxId, name ("Last, First"), team, position]`. */
export type MlbFantraxUniverseRow = NhlFantraxUniverseRow
export type MlbFantraxUniverseSnapshot = NhlFantraxUniverseSnapshot

export type MlbProspectPosition = 'C' | '1B' | '2B' | '3B' | 'SS' | 'OF' | 'LF' | 'CF' | 'RF' | 'DH' | 'UT' | 'P' | 'SP' | 'RP' | 'TWP'

export type MlbFantraxProspect = {
  /** `fantrax:<fantraxId>`. */
  playerId: string
  fantraxId: string
  /** "First Last". */
  name: string
  position: MlbProspectPosition
  /** The MLB club holding him (canonical abbreviation), or null when Fantrax lists no club. */
  orgTeam: string | null
}

export type MlbFantraxProspectCounts = {
  universe: number
  prospects: number
  linked: number
  knownName: number
  knownClubSurname: number
  inPool: number
  unrecognisedTeam: number
  badRow: number
  overLimit: number
}

/** The provider map compacted for storage — the NHL compaction, which is sport-neutral. */
export function compactMlbFantraxUniverse(refs: Iterable<FantraxPlayerRef>): MlbFantraxUniverseRow[] {
  return compactNhlFantraxUniverse(refs)
}

export function parseMlbFantraxUniverse(data: unknown): MlbFantraxUniverseSnapshot | null {
  return parseNhlFantraxUniverse(data)
}

const NO_CLUB = '(N/A)'
const PITCHER = new Set(['P', 'SP', 'RP'])
const HITTER = new Set(['C', '1B', '2B', '3B', 'SS', 'OF', 'LF', 'CF', 'RF', 'DH', 'UT'])

type Role = 'pitcher' | 'hitter'

function positionTokens(raw: string | null | undefined): string[] {
  return String(raw ?? '').toUpperCase().split(/[,/\s]+/).filter(Boolean).map((p) => (p === 'UTIL' ? 'UT' : p))
}

/** The listed position: `TWP` for a two-way row, otherwise the first baseball token; null when none. */
export function baseballPosition(raw: string | null | undefined): MlbProspectPosition | null {
  const parts = positionTokens(raw)
  if (parts.includes('TWP')) return 'TWP'
  const pitches = parts.some((p) => PITCHER.has(p))
  const hits = parts.some((p) => HITTER.has(p))
  if (pitches && hits) return 'TWP'
  return (parts.find((p) => PITCHER.has(p) || HITTER.has(p)) as MlbProspectPosition | undefined) ?? null
}

function roles(raw: string | null | undefined): Role[] {
  const position = baseballPosition(raw)
  if (!position) return []
  if (position === 'TWP') return ['pitcher', 'hitter']
  return [PITCHER.has(position) ? 'pitcher' : 'hitter']
}

/** `team|surname|first initial` for one role, from an `identityNameKey` name; null when unusable. */
function clubSurnameKey(team: string, nameKey: string, role: Role): string | null {
  const parts = nameKey.split(' ').filter(Boolean)
  if (parts.length < 2) return null
  return `${team}|${parts[parts.length - 1]}|${parts[0]!.charAt(0)}|${role}`
}

/** Fantrax ids are base-36 strings of growing length: longer is newer, then lexical (as NHL). */
function compareFantraxIdDesc(a: string, b: string): number {
  if (a.length !== b.length) return b.length - a.length
  return a < b ? 1 : a > b ? -1 : 0
}

export type MlbKnownIdentity = { fantraxId: string | null; name: string | null; team: string | null; position: string | null }

/** The sets the rule reads, built from MLB `PlayerIdentityMap` rows. */
export function knownMlbIdentitySets(identities: Iterable<{ fantraxId: string | null; normalizedName: string | null; canonicalName: string | null; currentTeam: string | null; position: string | null }>) {
  const fantraxIds = new Set<string>()
  const names = new Set<string>()
  const clubSurnames = new Set<string>()
  for (const identity of identities) {
    if (identity.fantraxId) fantraxIds.add(identity.fantraxId)
    const keys = [identityNameKey(identity.normalizedName), identityNameKey(identity.canonicalName)].filter(Boolean)
    for (const key of keys) names.add(key)
    const team = proTeamCode('MLB', identity.currentTeam)
    if (!team) continue
    for (const role of roles(identity.position)) {
      for (const key of keys) {
        const k = clubSurnameKey(team, key, role)
        if (k) clubSurnames.add(k)
      }
    }
  }
  return { fantraxIds, names, clubSurnames }
}

/** The rule in the header, as a pure function. Name sets hold `identityNameKey` forms. */
export function selectMlbFantraxProspects(
  rows: readonly MlbFantraxUniverseRow[],
  known: {
    fantraxIds: ReadonlySet<string>
    names: ReadonlySet<string>
    clubSurnames?: ReadonlySet<string>
    poolNames?: ReadonlySet<string>
  },
  limit = MLB_FANTRAX_PROSPECT_LIMIT,
): { prospects: MlbFantraxProspect[]; counts: MlbFantraxProspectCounts } {
  const counts: MlbFantraxProspectCounts = {
    universe: rows.length, prospects: 0, linked: 0, knownName: 0, knownClubSurname: 0, inPool: 0, unrecognisedTeam: 0, badRow: 0, overLimit: 0,
  }
  const seenIds = new Set<string>()
  const candidates: MlbFantraxProspect[] = []
  for (const [rawId, rawName, rawTeam, rawPosition] of rows) {
    const fantraxId = rawId.trim()
    const name = fantraxDisplayName(rawName)
    const position = baseballPosition(rawPosition)
    const nameKey = identityNameKey(name)
    if (!fantraxId || !nameKey || !position || seenIds.has(fantraxId)) { counts.badRow++; continue }
    seenIds.add(fantraxId)
    if (known.fantraxIds.has(fantraxId)) { counts.linked++; continue }
    if (known.names.has(nameKey)) { counts.knownName++; continue }
    const team = rawTeam.trim()
    const orgTeam = team === NO_CLUB ? null : proTeamCode('MLB', team) ?? undefined
    if (orgTeam && known.clubSurnames && roles(rawPosition).some((role) => {
      const k = clubSurnameKey(orgTeam, nameKey, role)
      return k !== null && known.clubSurnames!.has(k)
    })) { counts.knownClubSurname++; continue }
    if (known.poolNames?.has(nameKey)) { counts.inPool++; continue }
    if (orgTeam === undefined) { counts.unrecognisedTeam++; continue }
    candidates.push({ playerId: `${FANTRAX_PROSPECT_ID_PREFIX}${fantraxId}`, fantraxId, name, position, orgTeam })
  }
  const byName = new Map<string, number>()
  for (const c of candidates) byName.set(identityNameKey(c.name), (byName.get(identityNameKey(c.name)) ?? 0) + 1)
  const unique = candidates.filter((c) => {
    if ((byName.get(identityNameKey(c.name)) ?? 0) === 1) return true
    counts.badRow++
    return false
  })
  unique.sort((a, b) =>
    (a.orgTeam ? 0 : 1) - (b.orgTeam ? 0 : 1) || compareFantraxIdDesc(a.fantraxId, b.fantraxId) || a.name.localeCompare(b.name),
  )
  const cap = Math.max(0, Math.floor(limit))
  counts.overLimit = Math.max(0, unique.length - cap)
  const prospects = unique.slice(0, cap)
  counts.prospects = prospects.length
  return { prospects, counts }
}

export type MlbProspectDb = {
  sportsDataCache: {
    findUnique(args: { where: { cacheKey: string }; select: { data: true; expiresAt: true } }): Promise<{ data: unknown; expiresAt: Date | null } | null>
  }
  playerIdentityMap: {
    findMany(args: {
      where: { sport: string }
      select: { fantraxId: true; normalizedName: true; canonicalName: true; currentTeam: true; position: true }
    }): Promise<Array<{ fantraxId: string | null; normalizedName: string | null; canonicalName: string | null; currentTeam: string | null; position: string | null }>>
  }
}

/** The prospects, or an empty list when the universe has never been stored or has expired. */
export async function loadMlbFantraxProspects(
  db: MlbProspectDb,
  opts: { poolNames?: ReadonlySet<string>; limit?: number; now?: Date } = {},
): Promise<{ prospects: MlbFantraxProspect[]; counts: MlbFantraxProspectCounts | null; snapshotAt: string | null }> {
  const row = await db.sportsDataCache.findUnique({
    where: { cacheKey: MLB_FANTRAX_UNIVERSE_CACHE_KEY },
    select: { data: true, expiresAt: true },
  })
  const now = opts.now ?? new Date()
  if (!row || (row.expiresAt && row.expiresAt.getTime() <= now.getTime())) return { prospects: [], counts: null, snapshotAt: null }
  const snapshot = parseMlbFantraxUniverse(row.data)
  if (!snapshot || snapshot.rows.length === 0) return { prospects: [], counts: null, snapshotAt: null }
  const identities = await db.playerIdentityMap.findMany({
    where: { sport: 'MLB' },
    select: { fantraxId: true, normalizedName: true, canonicalName: true, currentTeam: true, position: true },
  })
  const known = knownMlbIdentitySets(identities)
  const { prospects, counts } = selectMlbFantraxProspects(snapshot.rows, { ...known, poolNames: opts.poolNames }, opts.limit)
  return { prospects, counts, snapshotAt: snapshot.at || null }
}
