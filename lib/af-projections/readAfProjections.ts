import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'

/**
 * DB-first read layer for `AFProjectionSnapshot` — the LIST shape.
 *
 * ── WHY THIS IS NOT `loadAfProjectionRows` ─────────────────────────────────────────────────
 * That one answers "what are these specific players projected for", keyed on a set of ids for the
 * trade path. This answers "who is projected highest in this sport right now", which is a
 * different query with different ordering and its own dedupe. Sharing would mean one function
 * with two unrelated modes; the DEDUPE RULE is what actually matters and it is stated once here
 * and matches that reader exactly.
 *
 * ── 🛑 ONE PLAYER HOLDS SEVERAL ROWS, AND PICKING THE WRONG ONE IS SILENT ──────────────────
 * The unique key is `${playerId}|${season}|${week ?? 'w'}|${eventId ?? 'none'}`, so a player has a
 * season-long baseline row (`week: null`) AND a row per scored week. Rendering all of them shows
 * the same player five times at five numbers; picking arbitrarily shows a stale week as though it
 * were current. Week-scoped first, then freshest — the same order `loadAfProjectionRows` uses.
 *
 * ── 🛑 TWO DIFFERENT UNITS LIVE IN THIS TABLE ──────────────────────────────────────────────
 * `afProjection` is PER GAME. `rosProjection` is REST OF SEASON. Confusing them understates a
 * player by roughly the number of weeks remaining — the exact 17× error the whole projections
 * audit began with. They are returned as separate named fields and a consumer that renders them
 * in one column is reintroducing that bug.
 */

export interface AfProjectionListRow {
  playerId: string
  playerName: string
  position: string
  sport: string
  season: number
  /** The week this row is scoped to, or null for the season-long baseline. */
  week: number | null
  /** PER GAME. */
  afProjection: number
  /** The projection before weather. Per game, same unit as `afProjection`. */
  baselineProjection: number
  /** Points weather moved it by. Zero is a real value meaning "considered, no change". */
  weatherAdjustment: number
  /**
   * REST OF SEASON, or null when it was never computed.
   *
   * 🛑 NULL MUST NOT RENDER AS 0. Zero is a real claim — "this player will score nothing" — and
   * the value engine acts on it. The census found this null on all 19,556 rows before the writer
   * was fixed, so a surface that shows `0` here would have told every manager their whole league
   * was worthless.
   */
  rosProjection: number | null
  /** Weeks `rosProjection` covers. Without it a LOW total is indistinguishable from a LATE one. */
  rosWeeksRemaining: number | null
  confidenceLevel: string
  /** Why the number moved, when the engine recorded a reason. */
  adjustmentReason: string | null
  isOutdoorGame: boolean
  computedAt: Date
}

export interface ListAfProjectionsArgs {
  sport: string
  /** Omit to use the newest season present for this sport. */
  season?: number | null
  /** Omit for all positions. Matched case-insensitively against the stored value. */
  position?: string | null
  /**
   * The week in scope. A week-scoped row for THIS week outranks the season baseline; omit and
   * only baseline rows are considered.
   */
  week?: number | null
  limit?: number
}

const MAX_LIMIT = 200

/**
 * The newest season we hold rows for in this sport, or null when we hold none.
 *
 * ⚠ READ, NEVER ASSUMED FROM THE CALENDAR. A September date does not mean September rows exist —
 * the compute cron silently wrote nothing for 13 days, which is what the projections audit found.
 * Defaulting to `new Date().getFullYear()` would have returned an empty list and looked like "no
 * players projected" rather than "we are looking at the wrong year".
 */
export async function newestProjectionSeason(sport: string): Promise<number | null> {
  const row = await prisma.aFProjectionSnapshot.findFirst({
    where: { sport },
    orderBy: { season: 'desc' },
    select: { season: true },
  })
  return row?.season ?? null
}

/**
 * Highest-projected players for a sport, one row per player.
 *
 * Returns `{ rows: [], season: null }` when nothing is stored — an empty list is a real answer and
 * the caller must be able to tell it apart from an error.
 */
export async function listAfProjections(
  args: ListAfProjectionsArgs,
): Promise<{ rows: AfProjectionListRow[]; season: number | null }> {
  const sport = args.sport.trim().toUpperCase()
  if (!sport) return { rows: [], season: null }

  const season = args.season ?? (await newestProjectionSeason(sport))
  if (season == null) return { rows: [], season: null }

  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(args.limit ?? 100)))
  const position = args.position?.trim()

  /*
   * ⚠ OVER-FETCHED ON PURPOSE. The dedupe below collapses several rows per player, so slicing to
   * `limit` in SQL would return fewer than `limit` players. Three rows per player is generous for
   * a table keyed by week; the cap keeps a pathological case bounded.
   */
  const rows = await prisma.aFProjectionSnapshot.findMany({
    where: {
      sport,
      season,
      ...(position && position.toLowerCase() !== 'all'
        ? { position: { equals: position, mode: 'insensitive' as const } }
        : {}),
      ...(args.week != null ? { OR: [{ week: args.week }, { week: null }] } : { week: null }),
    },
    /*
     * Week-scoped first (nulls last), then freshest, then by size — so the first row seen per
     * player is the best-informed one, and the final list reads high-to-low.
     */
    orderBy: [{ week: 'desc' }, { computedAt: 'desc' }, { afProjection: 'desc' }],
    take: Math.min(MAX_LIMIT * 3, limit * 3),
    select: {
      playerId: true,
      playerName: true,
      position: true,
      sport: true,
      season: true,
      week: true,
      afProjection: true,
      baselineProjection: true,
      weatherAdjustment: true,
      rosProjection: true,
      rosWeeksRemaining: true,
      confidenceLevel: true,
      adjustmentReason: true,
      isOutdoorGame: true,
      computedAt: true,
    },
  })

  const seen = new Set<string>()
  const deduped: AfProjectionListRow[] = []
  for (const r of rows) {
    if (seen.has(r.playerId)) continue
    seen.add(r.playerId)
    deduped.push(r)
  }

  /*
   * Sorted by the per-game number AFTER dedupe. Sorting in SQL would rank a player by whichever of
   * his rows happened to be largest rather than by the one actually shown.
   */
  deduped.sort((a, b) => b.afProjection - a.afProjection)

  return { rows: deduped.slice(0, limit), season }
}

/**
 * The longest run of letters in a name, used to narrow the SQL query before matching properly.
 *
 * ⚠ SPLIT ON NON-LETTERS, NOT ON SPACES. `playerName` is stored raw — "Ja'Marr Chase",
 * "A.J. Brown", "Patrick O'Brien" — and a `contains` on the user's punctuation would miss all
 * three. Taking the longest LETTER run gives "Chase", "Brown" and "Brien", each of which is a
 * substring of the stored value whichever way the apostrophes and periods fall.
 *
 * Returns '' when the input has no letters, which the caller treats as "cannot narrow".
 */
function longestLetterRun(raw: string): string {
  const parts = String(raw).split(/[^A-Za-z]+/).filter(Boolean)
  return parts.reduce((best, p) => (p.length > best.length ? p : best), '')
}

/**
 * Every projection row for ONE player, found by name.
 *
 * ── 🛑 NARROWED IN SQL, MATCHED IN JS, AND THE SPLIT IS DELIBERATE ─────────────────────────
 * `AFProjectionSnapshot` has no index on `playerName` — only `[playerId, week, season]` and
 * `[sport, week, season]` — so a name query alone is a scan. Narrowing on the indexed
 * `sport` + `season` first, then a `contains` on one letter-run, cuts it to a handful of rows.
 *
 * The final match is `normalizePlayerName`, in JavaScript, because that is where the identity
 * rules live: apostrophes and periods stripped, adjacent single letters collapsed, and
 * generational suffixes KEPT so Marvin Harrison Jr. never collapses into his father. CLAUDE.md
 * records what reimplementing that in SQL costs — a copy disagreed with the real one on 7.2% of
 * 500 rows, on exactly these cases.
 */
export async function findAfProjectionsByName(args: {
  playerName: string
  sport: string
  season?: number | null
  week?: number | null
}): Promise<{ rows: AfProjectionListRow[]; season: number | null }> {
  const sport = args.sport.trim().toUpperCase()
  const target = normalizePlayerName(args.playerName)
  if (!sport || !target) return { rows: [], season: null }

  const season = args.season ?? (await newestProjectionSeason(sport))
  if (season == null) return { rows: [], season: null }

  const token = longestLetterRun(args.playerName)
  if (!token) return { rows: [], season }

  const rows = await prisma.aFProjectionSnapshot.findMany({
    where: {
      sport,
      season,
      playerName: { contains: token, mode: 'insensitive' as const },
      ...(args.week != null ? { OR: [{ week: args.week }, { week: null }] } : {}),
    },
    // Same order as the list reader: week-scoped first, then freshest.
    orderBy: [{ week: 'desc' }, { computedAt: 'desc' }],
    take: 50,
    select: {
      playerId: true,
      playerName: true,
      position: true,
      sport: true,
      season: true,
      week: true,
      afProjection: true,
      baselineProjection: true,
      weatherAdjustment: true,
      rosProjection: true,
      rosWeeksRemaining: true,
      confidenceLevel: true,
      adjustmentReason: true,
      isOutdoorGame: true,
      computedAt: true,
    },
  })

  /*
   * ⚠ THE `contains` IS A NET, NOT AN ANSWER. Searching "Chase" also returns "Chase Brown" and
   * "Chase Young"; only the normalized comparison decides. Returning the SQL hits directly would
   * answer a question about a different player, confidently.
   */
  const matched = rows.filter((r) => normalizePlayerName(r.playerName) === target)

  const seen = new Set<string>()
  const deduped: AfProjectionListRow[] = []
  for (const r of matched) {
    if (seen.has(r.playerId)) continue
    seen.add(r.playerId)
    deduped.push(r)
  }

  return { rows: deduped, season }
}
