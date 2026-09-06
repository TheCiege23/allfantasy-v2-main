import 'server-only'

import { prisma } from '@/lib/prisma'
import { suggestCatalog, type PlayerMatch } from './playerFinder'
import { normalizePosition } from './positionNormalization'
import { rosterIdCoverage, sampleRosterIds } from './rosterIdCoverage'

/**
 * Suggestions as you type, ranked by what you meant and annotated with where
 * he is in YOUR leagues.
 *
 * The catalog search alone sorts by name and stops at a fixed row count, so
 * "kin" returned Hawkins and Akingbulu and never Dalton Kincaid. Two things
 * fix that:
 *
 *   RANK   a name (or any word of it) that STARTS with the query is read
 *          FIRST from the catalog (suggestCatalog) and outranks one that
 *          merely contains it; within that, a player who is in one of your
 *          leagues — on your roster or someone else's — outranks a stranger;
 *          within that, more of your rosters first, then the name.
 *   CHIP   "yours in Dynasty Dragons", "@tashaR has him in Gridiron Gang",
 *          "free in 4 leagues" — read from the same roster index the page
 *          builds for the detail, not from a projection or a cached count.
 *
 * ⚠ "FREE" IS A CLAIM ABOUT ROSTERS WE COULD READ. ESPN and Yahoo rosters
 * arrive under the provider's own ids, and a Sleeper-id scan of them finds
 * nobody; those leagues are `unchecked`, never "free". Same guard as the
 * finder's own table (rosterIdCoverage.ts).
 *
 * The roster index is one read of every roster in every league you play (a
 * typical account is a dozen leagues of twelve rosters) and is cached per
 * user for a minute, because a typeahead asks several times per search.
 */

export type SuggestionPresence = {
  /** Leagues where he is on YOUR roster, by name. */
  yours: string[]
  /** Leagues where another manager has him. */
  owned: Array<{ leagueName: string; ownerName: string | null }>
  /** Leagues whose rosters we could read and he is on none of them. */
  free: string[]
  /** Leagues whose rosters speak another id vocabulary — not counted anywhere. */
  unchecked: number
}

export type PlayerSuggestion = PlayerMatch & {
  /** The query matches the start of the name or of one of its words. */
  prefix: boolean
  /** Null when signed out, or when the player has no Sleeper id to join on. */
  presence: SuggestionPresence | null
  /**
   * Rosters across every league AllFantasy holds that carry him — the one
   * relevance signal the catalog can offer. "kin" has forty prefix matches
   * with a team; the ones anyone is typing for are the ones people roster.
   */
  rostered: number
}

const COUNTS_TTL_MS = 10 * 60_000
let countsCache: { at: number; counts: Map<string, number> } | null = null

/** Rosters per Sleeper id across every league we hold, rebuilt at most every ten minutes. */
let countsRefresh: Promise<Map<string, number>> | null = null

async function buildGlobalRosterCounts(): Promise<Map<string, number>> {
  const rosters = await prisma.roster
    .findMany({ select: { playerData: true } })
    .catch(() => [] as Array<{ playerData: unknown }>)
  const counts = new Map<string, number>()
  for (const r of rosters) {
    for (const id of allIds((r.playerData ?? {}) as Record<string, unknown>)) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

/**
 * ⚠ MEASURED ON PRODUCTION BY THE GATE, 2026-09-05: this read is every roster
 * row — 3,407 rows / 4.3 MB of JSON today, growing with league count — so it
 * must never sit on a request's critical path once a value exists. A stale
 * value is handed back at once and ONE refresh runs behind it; only the very
 * first request in a process waits.
 */
export async function getGlobalRosterCounts(now = Date.now()): Promise<Map<string, number>> {
  if (countsCache && now - countsCache.at < COUNTS_TTL_MS) return countsCache.counts
  if (!countsRefresh) {
    countsRefresh = buildGlobalRosterCounts()
      .then((counts) => {
        countsCache = { at: now, counts }
        return counts
      })
      .finally(() => {
        countsRefresh = null
      })
  }
  return countsCache ? countsCache.counts : countsRefresh
}

type IndexedRoster = { platformUserId: string; ids: Set<string> }
type IndexedLeague = {
  id: string
  name: string
  /** False when the sampled roster ids do not resolve against our player table. */
  usable: boolean
  yoursIds: Set<string>
  rosters: IndexedRoster[]
  ownerByRoster: Map<string, string | null>
}
export type RosterIndex = { leagues: IndexedLeague[] }

const INDEX_TTL_MS = 60_000
const indexCache = new Map<string, { at: number; index: RosterIndex }>()

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []
}
function allIds(pd: Record<string, unknown>): Set<string> {
  return new Set([...asIds(pd.players), ...asIds(pd.starters), ...asIds(pd.reserve), ...asIds(pd.taxi)])
}

export async function buildRosterIndex(userId: string, leagueIds: string[]): Promise<RosterIndex> {
  if (leagueIds.length === 0) return { leagues: [] }
  const [leagues, teams, rosters] = await Promise.all([
    prisma.league
      .findMany({ where: { id: { in: leagueIds } }, select: { id: true, name: true } })
      .catch(() => [] as Array<{ id: string; name: string | null }>),
    prisma.leagueTeam
      .findMany({
        where: { leagueId: { in: leagueIds } },
        select: { leagueId: true, externalId: true, platformUserId: true, claimedByUserId: true, ownerName: true },
      })
      .catch(
        () =>
          [] as Array<{ leagueId: string; externalId: string; platformUserId: string | null; claimedByUserId: string | null; ownerName: string }>,
      ),
    prisma.roster
      .findMany({ where: { leagueId: { in: leagueIds } }, select: { leagueId: true, platformUserId: true, playerData: true } })
      .catch(() => [] as Array<{ leagueId: string; platformUserId: string; playerData: unknown }>),
  ])

  // One vocabulary sample per league, resolved in a single read.
  const rostersByLeague = new Map<string, typeof rosters>()
  for (const r of rosters) {
    const arr = rostersByLeague.get(r.leagueId) ?? []
    arr.push(r)
    rostersByLeague.set(r.leagueId, arr)
  }
  const samples = new Map<string, string[]>()
  for (const [id, rs] of rostersByLeague) samples.set(id, sampleRosterIds(rs.map((r) => r.playerData), 60))
  const all = [...new Set([...samples.values()].flat())]
  const knownRows =
    all.length > 0
      ? await prisma.sportsPlayer
          .findMany({ where: { sleeperId: { in: all } }, select: { sleeperId: true }, distinct: ['sleeperId'] })
          .catch(() => [] as Array<{ sleeperId: string | null }>)
      : []
  const known = new Set(knownRows.map((r) => r.sleeperId).filter((x): x is string => Boolean(x)))

  const nameById = new Map(leagues.map((l) => [l.id, l.name?.trim() || 'Untitled league']))
  const out: IndexedLeague[] = []
  for (const id of leagueIds) {
    const rs = rostersByLeague.get(id) ?? []
    if (rs.length === 0) continue // nothing imported: says nothing either way
    const teamRows = teams.filter((t) => t.leagueId === id)
    const yoursIds = new Set<string>()
    const ownerByRoster = new Map<string, string | null>()
    for (const t of teamRows) {
      if (t.platformUserId) ownerByRoster.set(t.platformUserId, t.ownerName ?? null)
      ownerByRoster.set(t.externalId, t.ownerName ?? null)
      if (t.claimedByUserId === userId) {
        for (const c of [t.platformUserId, t.externalId, userId]) if (c) yoursIds.add(c)
      }
    }
    const sample = samples.get(id) ?? []
    out.push({
      id,
      name: nameById.get(id) ?? 'Untitled league',
      usable: sample.length > 0 && rosterIdCoverage(sample, known).usable,
      yoursIds,
      rosters: rs.map((r) => ({ platformUserId: r.platformUserId, ids: allIds((r.playerData ?? {}) as Record<string, unknown>) })),
      ownerByRoster,
    })
  }
  return { leagues: out }
}

/** The index for a user, rebuilt at most once a minute; `loadLeagueIds` runs only on a miss. */
/**
 * Bounded: the TTL is checked on read, so without a cap an entry for a user
 * who searched once would live for the life of the process. Today that is
 * ~23 users with a claimed team (the gate's production count); the cap is for
 * the day it is not. Insertion order is recency — a hit is re-inserted — so
 * the oldest-used entries go first.
 */
const INDEX_CAP = 500

export async function getRosterIndex(userId: string, loadLeagueIds: () => Promise<string[]>, now = Date.now()): Promise<RosterIndex> {
  const hit = indexCache.get(userId)
  if (hit && now - hit.at < INDEX_TTL_MS) {
    indexCache.delete(userId)
    indexCache.set(userId, hit)
    return hit.index
  }
  const leagueIds = await loadLeagueIds().catch(() => [] as string[])
  const index = await buildRosterIndex(userId, leagueIds)
  indexCache.delete(userId)
  indexCache.set(userId, { at: now, index })
  while (indexCache.size > INDEX_CAP) {
    const oldest = indexCache.keys().next().value
    if (oldest === undefined) break
    indexCache.delete(oldest)
  }
  return index
}

/** Test seams. */
export function clearRosterIndexCache(): void {
  indexCache.clear()
  countsCache = null
  countsRefresh = null
}
export function rosterIndexCacheSize(): number {
  return indexCache.size
}

export function presenceOf(sleeperId: string | null, index: RosterIndex): SuggestionPresence | null {
  if (!sleeperId) return null
  const p: SuggestionPresence = { yours: [], owned: [], free: [], unchecked: 0 }
  for (const league of index.leagues) {
    const holder = league.rosters.find((r) => r.ids.has(sleeperId)) ?? null
    if (holder) {
      if (league.yoursIds.has(holder.platformUserId)) p.yours.push(league.name)
      else p.owned.push({ leagueName: league.name, ownerName: league.ownerByRoster.get(holder.platformUserId) ?? null })
    } else if (league.usable) {
      p.free.push(league.name)
    } else {
      p.unchecked += 1
    }
  }
  return p
}

export function isPrefixMatch(query: string, name: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  const n = name.trim().toLowerCase()
  return n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q))
}

/** Pure: the tier and the tie-breaks described in the header. */
export function rankSuggestions(rows: PlayerSuggestion[]): PlayerSuggestion[] {
  const tier = (s: PlayerSuggestion) => {
    const inYours = Boolean(s.presence && (s.presence.yours.length > 0 || s.presence.owned.length > 0))
    return (s.prefix ? 0 : 2) + (inYours ? 0 : 1)
  }
  // A player with a team is active; one without is retired or unsigned. Between
  // otherwise-equal rows the active one is the one being typed for.
  const active = (s: PlayerSuggestion) => (s.team ? 0 : 1)
  // The finder joins NFL rosters today; a college or NBA row of the same
  // letters is not what a search box on this screen is for.
  const nfl = (s: PlayerSuggestion) => (s.sport === 'NFL' ? 0 : 1)
  return [...rows].sort(
    (a, b) =>
      tier(a) - tier(b) ||
      (b.presence?.yours.length ?? 0) - (a.presence?.yours.length ?? 0) ||
      b.rostered - a.rostered ||
      active(a) - active(b) ||
      nfl(a) - nfl(b) ||
      a.name.localeCompare(b.name),
  )
}

/**
 * One row per person. The catalog holds Dalton Kincaid as an NFL row AND as
 * his college row, and Corey Kiner twice under two team spellings; the
 * collapse inside the catalog read keys on team, so those survive it. After
 * ranking, the first row for a name + position wins — the rostered NFL one —
 * and two different players who share a name but not a position both stay.
 */
export function foldSamePerson(rows: PlayerSuggestion[]): PlayerSuggestion[] {
  const seen = new Set<string>()
  const out: PlayerSuggestion[] = []
  for (const s of rows) {
    const key = `${s.name.trim().toLowerCase()}|${positionGroup(s.position)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

/**
 * The position at the grain sources agree on. Kamren Kinchens is `DB` to
 * Sleeper and `S` to another vendor, Christian Mahogany `OL`, `G` and `OG`;
 * the exact label separates one person into three rows, while the group
 * still keeps a QB and a linebacker who share a name apart.
 */
const POSITION_GROUPS: Record<string, string> = {
  QB: 'QB',
  RB: 'RB', FB: 'RB', HB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'K', P: 'K', PK: 'K', LS: 'K',
  OL: 'OL', OT: 'OL', OG: 'OL', G: 'OL', C: 'OL', T: 'OL',
  DL: 'DEF', DE: 'DEF', DT: 'DEF', NT: 'DEF', EDGE: 'DEF', LB: 'DEF', ILB: 'DEF', OLB: 'DEF', MLB: 'DEF',
  DB: 'DEF', CB: 'DEF', S: 'DEF', FS: 'DEF', SS: 'DEF', SAF: 'DEF', DEF: 'DEF', IDP: 'DEF',
}
export function positionGroup(position: string | null | undefined): string {
  const p = normalizePosition(position ?? null)
  return POSITION_GROUPS[p] ?? p
}

export async function suggestPlayers(args: {
  query: string
  userId: string | null
  /** Called at most once a minute per user; the ids of every league they play. */
  loadLeagueIds: () => Promise<string[]>
  limit?: number
}): Promise<PlayerSuggestion[]> {
  const limit = Math.max(1, Math.min(args.limit ?? 8, 10))
  const q = args.query.trim()
  if (q.length < 2) return []
  // Prefix matches come first from the catalog read itself (see suggestCatalog);
  // a little over-fetch lets "in your leagues" reorder within the prefix set.
  // The global count first (cached ten minutes), so the catalog can read the
  // rostered players ahead of the alphabet — see suggestCatalog's preferIds.
  const counts = await getGlobalRosterCounts()
  const [matches, index] = await Promise.all([
    suggestCatalog(q, limit * 3, { preferIds: [...counts.keys()] }),
    args.userId ? getRosterIndex(args.userId, args.loadLeagueIds) : Promise.resolve(null),
  ])
  const rows: PlayerSuggestion[] = matches.map((m) => ({
    ...m,
    prefix: isPrefixMatch(q, m.name),
    presence: index ? presenceOf(m.sleeperId, index) : null,
    rostered: m.sleeperId ? (counts.get(m.sleeperId) ?? 0) : 0,
  }))
  return foldSamePerson(rankSuggestions(rows)).slice(0, limit)
}
