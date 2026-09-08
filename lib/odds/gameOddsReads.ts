/**
 * DB-first reads for `game_odds`.
 *
 * 🛑 NOTHING IN THIS FILE CALLS A PROVIDER, ON ANY PATH — not as a fallback, not
 * on a cache miss. That is what makes it safe for a request path to import, and
 * it is the reason the odds fetch stays in `lib/api-sports.ts` (which the
 * DB-first guard allowlists on a documented caller census). A miss here returns
 * null and the surface renders without odds; it does not reach for the vendor
 * while a user waits.
 *
 * The writer is `syncAPISportsGameOddsToDb`, driven every 6h by
 * `/api/cron/import-schedules?odds=1`. Root CLAUDE.md's `ingestCFBDStats` example
 * is the reason those shipped together: a table nothing refreshes is worse than
 * the live call it replaced, because it fails silently and looks correct.
 *
 * ⚠ ALWAYS CHECK `isStale` BEFORE PRESENTING A NUMBER. Odds are the one feed
 * where a stale value is actively misleading rather than merely old — a spread
 * from before a starting QB was ruled out will look perfectly reasonable and be
 * completely wrong. `readGameOdds` reports staleness rather than hiding rows, so
 * a caller can choose between "show it, marked" and "show nothing"; silently
 * dropping expired rows would leave a surface unable to tell "no line" from
 * "line we failed to refresh".
 */

import { prisma } from '@/lib/prisma'
import { pickPrimaryBookmaker, type NormalizedGameOdds } from './normalizeApiSportsOdds'

export interface GameOddsRow {
  gameExternalId: string
  sport: string
  source: string
  bookmakerId: number
  bookmakerName: string
  season: number | null
  week: number | null
  spreadHome: number | null
  totalPoints: number | null
  moneylineHome: number | null
  moneylineAway: number | null
  impliedHomeTotal: number | null
  impliedAwayTotal: number | null
  homeWinProbability: number | null
  fetchedAt: Date
  expiresAt: Date
}

export interface GameOddsResult {
  /** The most complete bookmaker quote for this game, or null when nothing parsed. */
  primary: GameOddsRow | null
  /** Every bookmaker on file, so a caller can compare or build its own consensus. */
  books: GameOddsRow[]
  /** True when the primary row is past its TTL. See the file header — do not ignore. */
  isStale: boolean
  /** Age of the primary row, or null when there is no row at all. */
  ageMs: number | null
}

const EMPTY: GameOddsResult = { primary: null, books: [], isStale: false, ageMs: null }

const SELECT = {
  gameExternalId: true,
  sport: true,
  source: true,
  bookmakerId: true,
  bookmakerName: true,
  season: true,
  week: true,
  spreadHome: true,
  totalPoints: true,
  moneylineHome: true,
  moneylineAway: true,
  impliedHomeTotal: true,
  impliedAwayTotal: true,
  homeWinProbability: true,
  fetchedAt: true,
  expiresAt: true,
} as const

/*
 * `pickPrimaryBookmaker` scores on the NormalizedGameOdds shape, which carries
 * more fields than a DB row needs to. Rather than widen the read's `select` just
 * to satisfy a type, project the three fields the scorer actually reads. Keeping
 * one ranking implementation matters more than the shim: two copies of "which
 * quote is best" would drift, and the SQL-vs-JS normalizer incident in root
 * CLAUDE.md is exactly what that costs.
 */
function toScorable(row: GameOddsRow): NormalizedGameOdds {
  return {
    bookmakerId: row.bookmakerId,
    bookmakerName: row.bookmakerName,
    spreadHome: row.spreadHome,
    spreadHomeOdd: null,
    spreadAwayOdd: null,
    moneylineHome: row.moneylineHome,
    moneylineAway: row.moneylineAway,
    totalPoints: row.totalPoints,
    overOdd: null,
    underOdd: null,
    impliedHomeTotal: row.impliedHomeTotal,
    impliedAwayTotal: row.impliedAwayTotal,
    homeWinProbability: row.homeWinProbability,
    unrecognizedBets: [],
  }
}

function assemble(rows: GameOddsRow[], now: Date): GameOddsResult {
  if (!rows.length) return EMPTY
  const ranked = pickPrimaryBookmaker(rows.map(toScorable))
  const primary = ranked ? rows.find((r) => r.bookmakerId === ranked.bookmakerId) ?? rows[0] : rows[0]
  return {
    primary,
    books: rows,
    isStale: primary.expiresAt.getTime() < now.getTime(),
    ageMs: now.getTime() - primary.fetchedAt.getTime(),
  }
}

/** Odds for one game, keyed on the PROVIDER's game id (`SportsGame.externalId`). */
export async function readGameOdds(
  sport: string,
  gameExternalId: string,
  opts: { source?: string } = {},
): Promise<GameOddsResult> {
  if (!sport || !gameExternalId) return EMPTY

  const rows = (await prisma.gameOdds.findMany({
    where: {
      sport,
      gameExternalId,
      ...(opts.source ? { source: opts.source } : {}),
    },
    select: SELECT,
  })) as GameOddsRow[]

  return assemble(rows, new Date())
}

/**
 * A whole week's slate in one query, returned as gameExternalId → odds.
 *
 * This is the shape lineup and matchup surfaces want: they already hold a week's
 * games and need the line for each. Doing it per game would be N round trips for
 * a page that renders one table.
 */
export async function readWeekOdds(
  sport: string,
  season: number,
  week: number,
  opts: { source?: string } = {},
): Promise<Map<string, GameOddsResult>> {
  const out = new Map<string, GameOddsResult>()
  if (!sport || !Number.isFinite(season) || !Number.isFinite(week)) return out

  const rows = (await prisma.gameOdds.findMany({
    where: {
      sport,
      season,
      week,
      ...(opts.source ? { source: opts.source } : {}),
    },
    select: SELECT,
  })) as GameOddsRow[]

  const byGame = new Map<string, GameOddsRow[]>()
  for (const row of rows) {
    const list = byGame.get(row.gameExternalId) ?? []
    list.push(row)
    byGame.set(row.gameExternalId, list)
  }

  const now = new Date()
  for (const [gameId, group] of byGame) out.set(gameId, assemble(group, now))
  return out
}

/**
 * Freshness of the odds table itself, for health surfaces.
 *
 * ⚠ Read THIS, not any accessor on the adapter. Root CLAUDE.md records
 * `getValuationCacheAgeMs` reporting "unknown age" for data that was fresh, because
 * a surface migrated to the DB layer while still asking the fetch module's
 * in-process Map how old its cache was. The adapter has no in-process odds cache at
 * all, so the same mistake here would report a permanent unknown that nothing
 * type-checks.
 */
export async function getGameOddsFreshness(
  sport: string,
  opts: { source?: string } = {},
): Promise<{ newestFetchedAt: Date | null; ageMs: number | null; rowCount: number }> {
  const where = { sport, ...(opts.source ? { source: opts.source } : {}) }
  const [newest, rowCount] = await Promise.all([
    prisma.gameOdds.findFirst({
      where,
      select: { fetchedAt: true },
      orderBy: { fetchedAt: 'desc' },
    }),
    prisma.gameOdds.count({ where }),
  ])

  if (!newest) return { newestFetchedAt: null, ageMs: null, rowCount }
  return {
    newestFetchedAt: newest.fetchedAt,
    ageMs: Date.now() - newest.fetchedAt.getTime(),
    rowCount,
  }
}
