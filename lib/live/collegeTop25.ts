/**
 * College scores show the current Top 25 — plus your own teams (founder, 2026-10-08).
 *
 * An NCAAF Saturday is 50–80 games and an NCAAB night can be more; a scores page listing all of them
 * is a wall nobody reads. The college tabs on /core/live, and college fixtures on the /core home,
 * show a game only when:
 *
 *   1. either team is in the current Top 25 (ESPN's `curatedRank`, the AP poll in football);
 *   2. either team is one the user follows (`team_follows` — the "favorite team" control); or
 *   3. a player the user rosters is in it (the live page's tie-ins) — those are already "your" games.
 *
 * ⚠ FAIL OPEN WHEN WE HOLD NO RANKS AT ALL. Ranks come from the scoreboard fetch the live service
 * already makes (no new provider call); before the first ranked fetch of a season the store is empty,
 * and filtering against an empty poll would blank every college tab. "No ranks yet" shows the slate
 * unfiltered, which is exactly what it showed before this rule existed.
 *
 * Pure and client-safe — the store (lib/live/collegeTop25Store.ts) does the reading and writing.
 */

/** Sports whose slates are filtered to the Top 25. Baseball polls exist but are not tracked here. */
export const TOP25_SPORTS = new Set(['NCAAF', 'NCAAB'])

export function isTop25Sport(sport: string | null | undefined): boolean {
  return TOP25_SPORTS.has(String(sport ?? '').toUpperCase())
}

/** ESPN reports an unranked team as 99. Anything outside 1–25 is "not in the Top 25". */
export function top25Rank(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return Number.isInteger(n) && n >= 1 && n <= 25 ? n : null
}

export type RankEntry = { rank: number; seenAt: string }

/** team key (ESPN id `id:333`, abbreviation `ab:ALA`) → its last observed Top-25 rank. */
export type RankBook = { updatedAt: string; teams: Record<string, RankEntry> }

export type RankObservation = {
  teamId?: string | null
  abbrev?: string | null
  /** ESPN's display name ("Pittsburgh Panthers") — lets a name-keyed fixture row find its rank. */
  name?: string | null
  /** number = ranked; null = observed UNRANKED; undefined = the feed said nothing about rank. */
  rank: number | null | undefined
}

/** How long a rank stands without being seen again — a week's poll, plus slack for a bye. */
export const RANK_TTL_MS = 10 * 24 * 60 * 60 * 1000

function norm(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function keysOf(o: { teamId?: string | null; abbrev?: string | null; name?: string | null }): string[] {
  const keys: string[] = []
  if (o.teamId) keys.push(`id:${String(o.teamId)}`)
  if (o.abbrev) keys.push(`ab:${String(o.abbrev).trim().toUpperCase()}`)
  if (o.name && norm(o.name)) keys.push(`nm:${norm(o.name)}`)
  return keys
}

/**
 * Fold a scoreboard's observations into the book. A team seen ranked takes that rank; a team seen
 * UNRANKED is removed (it dropped out of the poll); a team not seen keeps its rank until RANK_TTL_MS.
 * Returns null when the observations carried no rank information at all — nothing to write.
 */
export function mergeRankBook(prev: RankBook | null, observations: RankObservation[], now: Date): RankBook | null {
  const informative = observations.filter((o) => o.rank !== undefined)
  if (informative.length === 0) return null
  const nowIso = now.toISOString()
  const teams: Record<string, RankEntry> = {}
  for (const [key, entry] of Object.entries(prev?.teams ?? {})) {
    if (now.getTime() - new Date(entry.seenAt).getTime() <= RANK_TTL_MS) teams[key] = entry
  }
  for (const o of informative) {
    for (const key of keysOf(o)) {
      if (o.rank == null) delete teams[key]
      else teams[key] = { rank: o.rank, seenAt: nowIso }
    }
  }
  return { updatedAt: nowIso, teams }
}

export function rankOf(
  book: RankBook | null,
  team: { teamId?: string | null; abbrev?: string | null; name?: string | null },
): number | null {
  if (!book) return null
  for (const key of keysOf(team)) {
    const hit = book.teams[key]
    if (hit) return hit.rank
  }
  /*
   * A fixture row from another feed may carry only the school ("Pittsburgh") where ESPN said
   * "Pittsburgh Panthers". A word-boundary prefix finds it; a false hit only shows one extra game.
   */
  const n = norm(team.name)
  if (n) {
    for (const [key, entry] of Object.entries(book.teams)) {
      if (key.startsWith('nm:') && key.slice(3).startsWith(`${n} `)) return entry.rank
    }
  }
  return null
}

export type FollowedTeam = { teamAbbr: string; teamName: string }

/**
 * Does the user follow this side? Follows store `sports_core_teams` abbreviations and names while
 * the scoreboard speaks ESPN's, so both are tried; a name matches when one contains the other
 * ("Ohio State" vs "Ohio State Buckeyes").
 */
export function isFollowedSide(side: { abbrev?: string | null; name?: string | null }, follows: FollowedTeam[]): boolean {
  const ab = String(side.abbrev ?? '').trim().toUpperCase()
  const name = norm(side.name)
  return follows.some((f) => {
    if (ab && f.teamAbbr.trim().toUpperCase() === ab) return true
    const fn = norm(f.teamName)
    return Boolean(fn && name && (name === fn || name.startsWith(`${fn} `) || fn.startsWith(`${name} `)))
  })
}

export type Top25Side = { teamId?: string | null; abbrev?: string | null; name?: string | null; rank?: number | null }

/**
 * Should this college game show? `book` null with no row ranks means we hold no poll — fail open.
 */
export function showCollegeGame(
  game: { home: Top25Side; away: Top25Side; yours?: boolean },
  book: RankBook | null,
  follows: FollowedTeam[],
  pollKnown: boolean,
): boolean {
  if (!pollKnown) return true
  if (game.yours) return true
  for (const side of [game.home, game.away]) {
    if ((side.rank != null && side.rank <= 25) || rankOf(book, side) != null) return true
    if (isFollowedSide(side, follows)) return true
  }
  return false
}

/**
 * Whether a poll is in hand: the book has teams, or a row carries rank information at all.
 *
 * ⚠ `null` IS INFORMATION, `undefined` IS NOT. A row from ESPN's college scoreboard says `null` for a
 * team it reports as unranked (curatedRank 99); a row from any other feed has no rank field. This
 * tested `typeof === 'number'`, so a slate of nothing but unranked teams — a Thursday — read as "no
 * poll" and was shown unfiltered (measured live 2026-10-08: four unranked games through the filter).
 */
export function pollIsKnown(book: RankBook | null, rows: Array<{ homeRank?: number | null; awayRank?: number | null }>): boolean {
  if (book && Object.keys(book.teams).length > 0) return true
  return rows.some((r) => r.homeRank !== undefined || r.awayRank !== undefined)
}
