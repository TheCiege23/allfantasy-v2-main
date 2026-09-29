import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadPlayerValueHistory } from '@/lib/player-values/playerValueHistory'
import { CROSS_LEAGUE_BOOK, describeValueBook, valueBookFor, type ValueBook } from './valueBook'
import {
  NUDGE_MIN_VALUE,
  TREND_WINDOW_DAYS,
  changeOver,
  moverShareOf,
  nudgeFor,
  type BookTrend,
  type ValueTrend,
} from './valueTrend'

/**
 * Loader for the finder's value-trend card (valueTrend.ts has the rules).
 *
 * DB-first: `PlayerValueSnapshot`, written daily by /api/cron/adp-refresh (measured 2026-09-28: four
 * FantasyCalc books, 38 capture days since 2026-08-16, 29 of the last 30 present), read through the
 * same `loadPlayerValueHistory` the portfolio's movers use.
 *
 * The books are the ones YOUR leagues in scope price on (`valueBookFor`, the one league → book rule);
 * signed out, the labelled cross-league default. The trend and its percentages are free — facts about
 * the market. The buy-low / sell-high nudge is AF Pro, like every move on this card.
 */

const DAY_MS = 86_400_000
const DIST_TTL_MS = 30 * 60_000
const bookKey = (b: ValueBook) => `${b.source}:${b.format}:${b.qbFormat}`

const distCache = new Map<string, { at: number; dist: Promise<number[]> }>()

/** Every priced player's absolute 7-day move in this book, same rule as `changeOver(points, 7)`. */
function bookMoves(book: ValueBook): Promise<number[]> {
  const key = bookKey(book)
  const hit = distCache.get(key)
  if (hit && Date.now() - hit.at < DIST_TTL_MS) return hit.dist
  const dist = prisma
    .$queryRaw<Array<{ move: number }>>(Prisma.sql`
      WITH latest AS (
        SELECT DISTINCT ON ("sleeperId") "sleeperId", value, "capturedAt"
        FROM "PlayerValueSnapshot"
        WHERE source = ${book.source} AND format = ${book.format} AND "qbFormat" = ${book.qbFormat}
          AND "capturedAt" >= now() - interval '3 days'
        ORDER BY "sleeperId", "capturedAt" DESC
      )
      SELECT abs(l.value - b.value)::float8 / b.value AS move
      FROM latest l
      CROSS JOIN LATERAL (
        SELECT p.value FROM "PlayerValueSnapshot" p
        WHERE p."sleeperId" = l."sleeperId" AND p.source = ${book.source} AND p.format = ${book.format}
          AND p."qbFormat" = ${book.qbFormat} AND p."capturedAt" <= l."capturedAt" - interval '7 days'
        ORDER BY p."capturedAt" DESC LIMIT 1
      ) b
      WHERE l.value >= ${NUDGE_MIN_VALUE} AND b.value > 0
    `)
    .then((rows) => rows.map((r) => Number(r.move)).filter((n) => Number.isFinite(n)))
    .catch(() => {
      distCache.delete(key) // a failed read is not cached as "nobody moved"
      return [] as number[]
    })
  distCache.set(key, { at: Date.now(), dist })
  return dist
}

/** Tests only. */
export function clearValueTrendCache(): void {
  distCache.clear()
}

export async function loadValueTrend(args: {
  sleeperId: string | null
  /** Leagues in scope (the card's own league list); empty when signed out. */
  leagueIds: readonly string[]
  /** Leagues where he is on YOUR roster. */
  yourLeagueIds: readonly string[]
  includeNudge: boolean
  now?: Date
}): Promise<ValueTrend | null> {
  if (!args.sleeperId) return null
  const now = args.now ?? new Date()

  const leagues = args.leagueIds.length
    ? await prisma.league
        .findMany({ where: { id: { in: [...args.leagueIds] } }, select: { id: true, settings: true, leagueType: true } })
        .catch(() => [] as Array<{ id: string; settings: unknown; leagueType: string | null }>)
    : []
  const yours = new Set(args.yourLeagueIds)
  const byBook = new Map<string, { book: ValueBook; leagues: number; yours: number }>()
  for (const l of leagues) {
    const book = valueBookFor(l.settings, l.leagueType)
    const k = bookKey(book)
    const e = byBook.get(k) ?? { book, leagues: 0, yours: 0 }
    e.leagues += 1
    if (yours.has(l.id)) e.yours += 1
    byBook.set(k, e)
  }
  if (byBook.size === 0) byBook.set(bookKey(CROSS_LEAGUE_BOOK), { book: CROSS_LEAGUE_BOOK, leagues: 0, yours: 0 })

  const since = new Date(now.getTime() - (TREND_WINDOW_DAYS + 1) * DAY_MS)
  const books = (
    await Promise.all(
      [...byBook.values()].map(async (e): Promise<BookTrend | null> => {
        const history = await loadPlayerValueHistory({ sleeperIds: [args.sleeperId!], book: e.book, since }).catch(() => [])
        const points = history
          .filter((p) => p.sleeperId === args.sleeperId)
          .map((p) => ({ day: p.day, value: p.value }))
          .sort((a, b) => a.day.localeCompare(b.day))
        if (points.length === 0) return null
        const last = points[points.length - 1]
        const change7 = changeOver(points, 7)
        // At least 28 days back so a base exists inside the loaded window; the card labels it with
        // the base's real date ("since Aug 31"), never as an exact "30 days".
        const change30 = changeOver(points, TREND_WINDOW_DAYS - 2)
        const moverShare = change7 ? moverShareOf(Math.abs(change7.pct), await bookMoves(e.book)) : null
        return {
          book: e.book,
          label: describeValueBook(e.book),
          points,
          value: last.value,
          lastDay: last.day,
          change7,
          change30,
          moverShare,
          leagues: e.leagues,
          yours: e.yours,
        }
      }),
    )
  )
    .filter((b): b is BookTrend => b !== null)
    .sort((a, b) => b.yours - a.yours || b.leagues - a.leagues || a.label.localeCompare(b.label))

  if (books.length === 0) return null
  const nudge = nudgeFor(books)
  return { books, nudge: args.includeNudge ? nudge : null, nudgeLocked: !args.includeNudge && nudge !== null }
}
