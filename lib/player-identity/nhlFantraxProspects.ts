import type { FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'
import { identityNameKey } from '@/lib/redraft/rosterGameLogIdBridge'
import { proTeamCode } from './proFantraxIdentityPlan'

/**
 * NHL prospects for a dynasty ROOKIE draft, from the Fantrax NHL player universe we already store.
 * Owner's call 2026-10-31: "use the Fantrax AHL players if possible".
 *
 * WHERE THE DATA COMES FROM. `getPlayerIds?sport=NHL` (~9,054 rows; slice in
 * `tests/fixtures/fantrax/nhl-player-ids-public.json`, contract notes in `contracts/fantrax/GAPS.md`
 * F-01 / F-10) is read weekly by `ingestProFantraxIdentities('NHL')`. That job used to keep only the
 * rows it could link to a Rolling Insights identity and discard the rest — every AHL, junior and
 * unsigned player. It now also stores the whole universe, compacted, under
 * `NHL_FANTRAX_UNIVERSE_CACHE_KEY` in `sportsDataCache`. This module only READS that row and
 * `PlayerIdentityMap`: it is DB-first and calls no provider.
 *
 * THE RULE. A Fantrax NHL row is a prospect when NONE of these is true:
 *   1. its `fantraxId` is on an NHL `PlayerIdentityMap` row (the weekly job linked him to a Rolling
 *      Insights NHL player — he is in the pro pool already);
 *   2. its name (in `PlayerIdentityMap.normalizedName` form) is an NHL identity's name — the link
 *      can miss on a stale team, and a same-named pro must not be listed twice;
 *   3. its name is already on the league's pro pool (checked by the draft-pool caller);
 *   4. its team is a label we do not recognise as a current NHL club (e.g. the retired `ARI`) and is
 *      not Fantrax's no-club marker `(N/A)` — refused, never guessed;
 *   5. its position is not a hockey position (C / LW / RW / D / G).
 * Rolling Insights NHL is NHL-only (no AHL/junior/Europe — docs/DYNASTY_PROSPECT_DATA_PLAN.md §3.2),
 * and `player_game_stats` for NHL is keyed on `PlayerIdentityMap.id`. So "not in the NHL identity
 * registry" (1 + 2) also means "no NHL game in our stored stats": a player with no identity row has
 * no game-log row to have. It is that, rather than a separate game-log read, that this rule rests on.
 *
 * ⚠ WHAT IT CANNOT KNOW — say this wherever the pool is described:
 *   - Fantrax sends NO age, draft year, league/level or prospect flag (F-01). "Not in our NHL data"
 *     is the whole test, so the `(N/A)` bucket also holds players who never signed, left for Europe
 *     or retired without reaching our registry. Signed players (an NHL org abbreviation) come first.
 *   - The org is Fantrax's `team` label: for an AHL player it is the NHL parent club (Tyler Madden →
 *     MIN in the capture), not the AHL affiliate.
 *   - There is no ranking. Within each group rows are ordered newest Fantrax id first — ids are
 *     handed out as players are added, so this is a weak proxy for "recent draft class" — only to
 *     choose WHICH rows fit under the cap; the board then sorts them by name like any unranked row.
 *
 * IDS. A prospect is drafted as `fantrax:<fantraxId>`. `lib/redraft/rosterGameLogIdBridge.ts` maps
 * that through `PlayerIdentityMap.fantraxId` within the sport, so once the weekly job links him to a
 * Rolling Insights NHL identity (he reaches an NHL roster), his game logs score with no roster
 * rewrite. Until then he has no NHL games, and zero is the truth, not a gap.
 */

export const NHL_FANTRAX_UNIVERSE_CACHE_KEY = 'fantrax:nhl-player-universe'

/** The draft-pool id prefix for a Fantrax-only NHL prospect. */
export const FANTRAX_PROSPECT_ID_PREFIX = 'fantrax:'

/** How many prospects a rookie draft board carries at most. */
export const NHL_FANTRAX_PROSPECT_LIMIT = 750

/** `[fantraxId, name ("Last, First"), team, position]` — the stored, compacted universe row. */
export type NhlFantraxUniverseRow = [string, string, string, string]

export type NhlFantraxUniverseSnapshot = {
  at: string
  rows: NhlFantraxUniverseRow[]
}

export type NhlFantraxProspect = {
  /** `fantrax:<fantraxId>` — see IDS above. */
  playerId: string
  fantraxId: string
  /** "First Last". */
  name: string
  position: 'C' | 'LW' | 'RW' | 'D' | 'G'
  /** The NHL club holding him (canonical abbreviation), or null when Fantrax lists no club. */
  orgTeam: string | null
}

export type NhlFantraxProspectCounts = {
  universe: number
  prospects: number
  linked: number
  knownName: number
  inPool: number
  unrecognisedTeam: number
  badRow: number
  overLimit: number
}

const NO_CLUB = '(N/A)'
const HOCKEY_POSITIONS = new Set(['C', 'LW', 'RW', 'D', 'G'])

/** Compacts the provider map for storage; drops rows with no id or no name. */
export function compactNhlFantraxUniverse(refs: Iterable<FantraxPlayerRef>): NhlFantraxUniverseRow[] {
  const out: NhlFantraxUniverseRow[] = []
  for (const ref of refs) {
    const id = String(ref?.fantraxId ?? '').trim()
    const name = String(ref?.name ?? '').trim()
    if (!id || !name) continue
    out.push([id, name, String(ref.team ?? '').trim(), String(ref.position ?? '').trim()])
  }
  return out
}

/** Fantrax writes "Last, First"; everything else in this repo writes "First Last". */
export function fantraxDisplayName(raw: string): string {
  const parts = raw.split(',').map((p) => p.trim())
  return parts.length === 2 && parts[0] && parts[1] ? `${parts[1]} ${parts[0]}` : raw.trim()
}

function hockeyPosition(raw: string): NhlFantraxProspect['position'] | null {
  const token = String(raw ?? '').toUpperCase().split(/[,/\s]+/).find((p) => HOCKEY_POSITIONS.has(p))
  return (token as NhlFantraxProspect['position'] | undefined) ?? null
}

/** Fantrax ids are base-36 strings of growing length: longer is newer, then lexical. */
function compareFantraxIdDesc(a: string, b: string): number {
  if (a.length !== b.length) return b.length - a.length
  return a < b ? 1 : a > b ? -1 : 0
}

export function parseNhlFantraxUniverse(data: unknown): NhlFantraxUniverseSnapshot | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const { at, rows } = data as { at?: unknown; rows?: unknown }
  if (!Array.isArray(rows)) return null
  const clean = rows.filter(
    (r): r is NhlFantraxUniverseRow => Array.isArray(r) && r.length === 4 && r.every((v) => typeof v === 'string'),
  )
  return { at: typeof at === 'string' ? at : '', rows: clean }
}

/** The rule in the header, as a pure function. `knownNames` / `poolNames` hold `identityNameKey` forms. */
export function selectNhlFantraxProspects(
  rows: readonly NhlFantraxUniverseRow[],
  known: { fantraxIds: ReadonlySet<string>; names: ReadonlySet<string>; poolNames?: ReadonlySet<string> },
  limit = NHL_FANTRAX_PROSPECT_LIMIT,
): { prospects: NhlFantraxProspect[]; counts: NhlFantraxProspectCounts } {
  const counts: NhlFantraxProspectCounts = {
    universe: rows.length, prospects: 0, linked: 0, knownName: 0, inPool: 0, unrecognisedTeam: 0, badRow: 0, overLimit: 0,
  }
  const seenIds = new Set<string>()
  const candidates: NhlFantraxProspect[] = []
  for (const [rawId, rawName, rawTeam, rawPosition] of rows) {
    const fantraxId = rawId.trim()
    const name = fantraxDisplayName(rawName)
    const position = hockeyPosition(rawPosition)
    const nameKey = identityNameKey(name)
    if (!fantraxId || !nameKey || !position || seenIds.has(fantraxId)) { counts.badRow++; continue }
    seenIds.add(fantraxId)
    if (known.fantraxIds.has(fantraxId)) { counts.linked++; continue }
    if (known.names.has(nameKey)) { counts.knownName++; continue }
    if (known.poolNames?.has(nameKey)) { counts.inPool++; continue }
    const team = rawTeam.trim()
    const orgTeam = team === NO_CLUB ? null : proTeamCode('NHL', team) ?? undefined
    if (orgTeam === undefined) { counts.unrecognisedTeam++; continue }
    candidates.push({ playerId: `${FANTRAX_PROSPECT_ID_PREFIX}${fantraxId}`, fantraxId, name, position, orgTeam })
  }
  // Two prospects sharing one name cannot be told apart by any later name-keyed step: keep neither.
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

export type NhlProspectDb = {
  sportsDataCache: {
    findUnique(args: { where: { cacheKey: string }; select: { data: true; expiresAt: true } }): Promise<{ data: unknown; expiresAt: Date | null } | null>
  }
  playerIdentityMap: {
    findMany(args: { where: { sport: string }; select: { fantraxId: true; normalizedName: true; canonicalName: true } }): Promise<Array<{ fantraxId: string | null; normalizedName: string | null; canonicalName: string | null }>>
  }
}

/**
 * The prospects, or an empty list when the universe has never been stored or has expired (the
 * weekly writer refreshes it; a missing row is "no prospects yet", never an error).
 */
export async function loadNhlFantraxProspects(
  db: NhlProspectDb,
  opts: { poolNames?: ReadonlySet<string>; limit?: number; now?: Date } = {},
): Promise<{ prospects: NhlFantraxProspect[]; counts: NhlFantraxProspectCounts | null; snapshotAt: string | null }> {
  const row = await db.sportsDataCache.findUnique({
    where: { cacheKey: NHL_FANTRAX_UNIVERSE_CACHE_KEY },
    select: { data: true, expiresAt: true },
  })
  const now = opts.now ?? new Date()
  if (!row || (row.expiresAt && row.expiresAt.getTime() <= now.getTime())) return { prospects: [], counts: null, snapshotAt: null }
  const snapshot = parseNhlFantraxUniverse(row.data)
  if (!snapshot || snapshot.rows.length === 0) return { prospects: [], counts: null, snapshotAt: null }
  const identities = await db.playerIdentityMap.findMany({
    where: { sport: 'NHL' },
    select: { fantraxId: true, normalizedName: true, canonicalName: true },
  })
  const fantraxIds = new Set<string>()
  const names = new Set<string>()
  for (const identity of identities) {
    if (identity.fantraxId) fantraxIds.add(identity.fantraxId)
    // Both forms: the stored normalizedName, and the canonical name folded the same way as ours.
    for (const key of [identityNameKey(identity.normalizedName), identityNameKey(identity.canonicalName)]) if (key) names.add(key)
  }
  const { prospects, counts } = selectNhlFantraxProspects(snapshot.rows, { fantraxIds, names, poolNames: opts.poolNames }, opts.limit)
  return { prospects, counts, snapshotAt: snapshot.at || null }
}
