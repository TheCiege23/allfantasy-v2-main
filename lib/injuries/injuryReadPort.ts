import 'server-only'

/**
 * Canonical injury read port.
 *
 * WHY THIS EXISTS: every consumer currently runs its own `sportsInjury.findMany`
 * with different rules, so the same player can be described differently on
 * different screens:
 *
 *   app/api/start-sit/injuries      — NO recency filter at all
 *   app/api/news-crawl              — updatedAt >= 48h
 *   server/.../community-insights   — updatedAt >= 48h
 *   app/api/draft/player-detail     — orderBy date desc, take 5, no recency
 *   app/api/sports/injuries         — orderBy fetchedAt desc, take 300
 *
 * None filter by `source`. `SportsInjury` is unique on
 * (sport, externalId, source), so rows from different providers COEXIST — which
 * is how a 17-day-old api_sports row could outrank a fresh rolling_insights one
 * on any surface that orders by `date` instead of `fetchedAt`.
 *
 * This module is the single reader Decision OS, the OS tree, legacy, trade
 * evaluation, waivers and Chimmy all go through. It guarantees three things no
 * ad-hoc query does:
 *
 *   1. ONE row per player — freshest source wins, deterministically.
 *   2. STALENESS IS RETURNED, NOT HIDDEN. An injury status is a claim about
 *      right now. A two-week-old "Questionable" is not stale data, it is a
 *      FALSE statement, and the caller must be able to see that.
 *   3. AMBIGUOUS NAME MATCHES REFUSE. Binding the wrong athlete's injury is the
 *      failure slice 15 exists to prevent (QB Josh Allen vs LB Josh Allen).
 */

import { prisma } from '@/lib/prisma'
import { buildNameIndex, normalizeMatchName, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import type { InjuryDesignation } from '@/lib/injuries/rollingInsightsInjuries'

/**
 * Beyond this, a status is treated as a claim we can no longer stand behind.
 * NFL injury reports move daily and hard on game day; 36h spans a normal
 * report cycle without blessing week-old data.
 */
export const INJURY_STALE_AFTER_HOURS = 36

/** Source preference when the same player appears from multiple providers. */
const SOURCE_RANK: Record<string, number> = {
  rolling_insights: 100,
  api_sports: 50,
}

export interface InjuryFact {
  playerName: string
  /** Null means "no designation stated" — NOT "healthy". Callers must not
   *  collapse the two; see parseInjuryDesignation in the RI ingest. */
  status: InjuryDesignation | string | null
  /** Body part, e.g. "Knee". */
  type: string | null
  description: string | null
  date: Date | null
  week: number | null
  source: string
  fetchedAt: Date
  ageHours: number
  /**
   * True when this row is older than INJURY_STALE_AFTER_HOURS. Callers should
   * suppress or caveat the status rather than render it plainly — a stale
   * injury badge is a confident false statement, which is worse than none.
   */
  stale: boolean
}

export interface InjuryLookup {
  name: string
  position?: string | null
  team?: string | null
}

export interface InjuryResolution {
  /** Keyed by normalized player name. Absent = no injury row (i.e. no news). */
  byPlayer: Map<string, InjuryFact>
  /** Names that matched multiple candidates and were REFUSED, not guessed. */
  ambiguous: string[]
  /** Freshest row seen overall — the feed-level health signal. */
  newestFetchedAt: Date | null
  /** True when the whole feed is stale, i.e. ingestion itself has stopped. */
  feedStale: boolean
}

interface InjuryRow {
  playerName: string
  status: string | null
  type: string | null
  description: string | null
  date: Date | null
  week: number | null
  source: string
  fetchedAt: Date
  team: string | null
  position: string | null
}

function toFact(row: InjuryRow, now: Date): InjuryFact {
  const ageHours = (now.getTime() - row.fetchedAt.getTime()) / 3_600_000
  return {
    playerName: row.playerName,
    status: row.status,
    type: row.type,
    description: row.description,
    date: row.date,
    week: row.week,
    source: row.source,
    fetchedAt: row.fetchedAt,
    ageHours,
    stale: ageHours > INJURY_STALE_AFTER_HOURS,
  }
}

/**
 * Deterministic winner between two rows for the same player.
 * Freshness first (an injury status is a claim about NOW), then source rank as
 * the tiebreak. Never array order — that is how "first hit wins" bugs start.
 */
function preferred(a: InjuryRow, b: InjuryRow): InjuryRow {
  const at = a.fetchedAt.getTime()
  const bt = b.fetchedAt.getTime()
  if (at !== bt) return at > bt ? a : b
  const ar = SOURCE_RANK[a.source] ?? 0
  const br = SOURCE_RANK[b.source] ?? 0
  if (ar !== br) return ar > br ? a : b
  return a
}

/**
 * Resolve injuries for a specific set of players.
 *
 * `players` should carry position and team where the caller has them — they are
 * used ONLY to disambiguate name collisions, never to filter. A player with no
 * injury row simply has no entry; that is "no news", not "healthy", and callers
 * should phrase it accordingly.
 */
export async function resolveInjuryFacts(args: {
  sport: string
  players: readonly InjuryLookup[]
  now?: Date
  /** Include rows past their TTL. Default false — expired rows are excluded so
   *  the legacy api_sports rows retired by the RI ingest stay out. */
  includeExpired?: boolean
}): Promise<InjuryResolution> {
  const now = args.now ?? new Date()
  const sport = args.sport.toUpperCase()
  const empty: InjuryResolution = {
    byPlayer: new Map(),
    ambiguous: [],
    newestFetchedAt: null,
    feedStale: true,
  }
  if (args.players.length === 0) return empty

  let rows: InjuryRow[] = []
  try {
    rows = (await prisma.sportsInjury.findMany({
      where: {
        sport,
        ...(args.includeExpired ? {} : { expiresAt: { gt: now } }),
      },
      select: {
        playerName: true,
        status: true,
        type: true,
        description: true,
        date: true,
        week: true,
        source: true,
        fetchedAt: true,
        team: true,
        position: true,
      },
      orderBy: { fetchedAt: 'desc' },
      take: 5000,
    })) as InjuryRow[]
  } catch {
    return empty
  }

  if (rows.length === 0) return empty

  const newestFetchedAt = rows.reduce<Date | null>(
    (acc, r) => (!acc || r.fetchedAt > acc ? r.fetchedAt : acc),
    null,
  )
  const feedAgeHours = newestFetchedAt ? (now.getTime() - newestFetchedAt.getTime()) / 3_600_000 : Infinity

  // Collapse to one row per player BEFORE name-matching, so a duplicate across
  // providers never presents as an ambiguous collision.
  const bestByExact = new Map<string, InjuryRow>()
  for (const r of rows) {
    const key = `${normalizeMatchName(r.playerName)}|${(r.team ?? '').toUpperCase()}`
    const existing = bestByExact.get(key)
    bestByExact.set(key, existing ? preferred(existing, r) : r)
  }

  const index = buildNameIndex(
    [...bestByExact.values()].map((r) => ({
      name: r.playerName,
      position: r.position,
      team: r.team,
      row: r,
    })),
  )

  const byPlayer = new Map<string, InjuryFact>()
  const ambiguous: string[] = []

  for (const lookup of args.players) {
    const key = normalizeMatchName(lookup.name)
    if (!key) continue
    const res = resolveVerifiedMatch(index, {
      name: lookup.name,
      position: lookup.position ?? null,
      team: lookup.team ?? null,
    })
    if (res.reason === 'ambiguous') {
      // Refusing is the point. RI supplies no position on injury rows, so a
      // genuine same-name collision often CANNOT be split — and a missing
      // injury badge is a gap, while the wrong player's badge is a falsehood.
      ambiguous.push(lookup.name)
      continue
    }
    if (!res.match) continue
    byPlayer.set(key, toFact(res.match.row, now))
  }

  return {
    byPlayer,
    ambiguous,
    newestFetchedAt,
    feedStale: feedAgeHours > INJURY_STALE_AFTER_HOURS,
  }
}

export interface InjuryFactListItem extends InjuryFact {
  /** SportsInjury row id — kept so list consumers (tickers) have a stable key. */
  id: string
  team: string | null
  position: string | null
}

export interface InjuryFactList {
  facts: InjuryFactListItem[]
  newestFetchedAt: Date | null
  /** True when the whole feed is stale, i.e. ingestion itself has stopped. */
  feedStale: boolean
}

/**
 * Canonical LIST reader — for surfaces that render "current injuries" without
 * a player set to resolve against (tickers, league-wide injury tables,
 * insights digests). Same guarantees as `resolveInjuryFacts`: TTL-respected,
 * ONE row per player (freshest source wins deterministically), staleness
 * RETURNED rather than hidden. Exists so those surfaces stop running their
 * own inconsistent `sportsInjury.findMany` variants (no recency filter /
 * 48h / order-by-date-desc — the ordering that let a 17-day-old api_sports
 * row outrank a fresh rolling_insights one).
 */
export async function listInjuryFacts(args: {
  sport: string
  now?: Date
  /** Exact team abbreviation filter (already-normalized by the caller). */
  team?: string | null
  /** Case-insensitive substring match on player name. */
  playerNameContains?: string | null
  /** Only rows fetched within this many hours (e.g. 48 for news tickers). */
  maxAgeHours?: number | null
  /** Only these designations (exact match against stored status). */
  statuses?: readonly string[] | null
  limit?: number
}): Promise<InjuryFactList> {
  const now = args.now ?? new Date()
  const sport = args.sport.toUpperCase()
  const limit = Math.max(1, Math.min(args.limit ?? 300, 1000))
  const empty: InjuryFactList = { facts: [], newestFetchedAt: null, feedStale: true }

  let rows: Array<InjuryRow & { id: string }> = []
  try {
    rows = (await prisma.sportsInjury.findMany({
      where: {
        sport,
        expiresAt: { gt: now },
        ...(args.team ? { team: args.team } : {}),
        ...(args.playerNameContains
          ? { playerName: { contains: args.playerNameContains, mode: 'insensitive' } }
          : {}),
        ...(args.maxAgeHours != null
          ? { fetchedAt: { gte: new Date(now.getTime() - args.maxAgeHours * 3_600_000) } }
          : {}),
        ...(args.statuses && args.statuses.length > 0 ? { status: { in: [...args.statuses] } } : {}),
      },
      select: {
        id: true,
        playerName: true,
        status: true,
        type: true,
        description: true,
        date: true,
        week: true,
        source: true,
        fetchedAt: true,
        team: true,
        position: true,
      },
      orderBy: { fetchedAt: 'desc' },
      take: 5000,
    })) as Array<InjuryRow & { id: string }>
  } catch {
    return empty
  }

  if (rows.length === 0) return empty

  const newestFetchedAt = rows.reduce<Date | null>(
    (acc, r) => (!acc || r.fetchedAt > acc ? r.fetchedAt : acc),
    null,
  )
  const feedAgeHours = newestFetchedAt ? (now.getTime() - newestFetchedAt.getTime()) / 3_600_000 : Infinity

  // One row per player — same collapse rule as resolveInjuryFacts.
  const bestByExact = new Map<string, InjuryRow & { id: string }>()
  for (const r of rows) {
    const key = `${normalizeMatchName(r.playerName)}|${(r.team ?? '').toUpperCase()}`
    const existing = bestByExact.get(key)
    bestByExact.set(key, existing ? (preferred(existing, r) as InjuryRow & { id: string }) : r)
  }

  const facts = [...bestByExact.values()]
    .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())
    .slice(0, limit)
    .map((r) => ({
      ...toFact(r, now),
      id: r.id,
      team: r.team,
      position: r.position,
    }))

  return {
    facts,
    newestFetchedAt,
    feedStale: feedAgeHours > INJURY_STALE_AFTER_HOURS,
  }
}

/**
 * Feed-level health, for the control room / per-feed health chip and for any
 * surface that needs to caveat itself before rendering injury data at all.
 */
export async function getInjuryFeedHealth(sport = 'NFL', now = new Date()): Promise<{
  newestFetchedAt: Date | null
  ageHours: number | null
  stale: boolean
  rowsLive: number
  bySource: Array<{ source: string; rows: number; newestFetchedAt: Date | null }>
}> {
  const s = sport.toUpperCase()
  try {
    const grouped = await prisma.sportsInjury.groupBy({
      by: ['source'],
      where: { sport: s, expiresAt: { gt: now } },
      _count: { _all: true },
      _max: { fetchedAt: true },
    })
    const bySource = grouped.map((g) => ({
      source: g.source,
      rows: g._count._all,
      newestFetchedAt: g._max.fetchedAt ?? null,
    }))
    const rowsLive = bySource.reduce((a, b) => a + b.rows, 0)
    const newest = bySource.reduce<Date | null>(
      (acc, b) => (b.newestFetchedAt && (!acc || b.newestFetchedAt > acc) ? b.newestFetchedAt : acc),
      null,
    )
    const ageHours = newest ? (now.getTime() - newest.getTime()) / 3_600_000 : null
    return {
      newestFetchedAt: newest,
      ageHours,
      stale: ageHours == null || ageHours > INJURY_STALE_AFTER_HOURS,
      rowsLive,
      bySource,
    }
  } catch {
    return { newestFetchedAt: null, ageHours: null, stale: true, rowsLive: 0, bySource: [] }
  }
}
