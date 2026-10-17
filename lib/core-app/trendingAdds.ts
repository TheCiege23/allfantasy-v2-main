import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveSleeperPlayers, type SleeperPlayer } from './sleeperPlayerRefs'

/**
 * "Most added this week" on the Player Finder: the players the most leagues picked up over the last
 * seven days, across the leagues synced from Sleeper. An aggregate — no league, team or manager is
 * named — so it shows to everyone, signed in or not.
 *
 * DB-first: `dw_transaction_facts`, written by the Sleeper transaction sync. Three things measured on
 * 2026-09-29 decide how it is read, and each one gets a wrong list if skipped:
 *
 *   1. THE ADDED PLAYER IS `payload.adds`, NOT `playerId`. On a waiver row `playerId` was null; on a
 *      free-agent row it was the DROPPED player.
 *   2. WHEN IT HAPPENED IS `payload.createdAt`, NOT THE ROW'S `createdAt`. The historical sync re-inserts
 *      old transactions: a row written 09-29 carried a claim made 09-23.
 *   3. ONE SLEEPER LEAGUE IS SEVERAL AF LEAGUE ROWS (one per importer), so a league is counted by
 *      (platform, platformLeagueId), and a transaction once per (league, sleeperTransactionId).
 *
 * ⚠ SEVEN DAYS, AND THE LIST SAYS HOW FRESH IT IS. A 24-hour window was measured and is empty most of
 * the week (waivers clear midweek) and the newest days lag the sync — Sep 25–28 read 100, 91, 74, 2 adds
 * against 400–850 on a waiver day. So the window is a rolling week, and the card prints the newest
 * transaction on file ("through Sep 27") instead of claiming "today".
 */

export const TRENDING_WINDOW_DAYS = 7
/** A player added in one league is noise, not a trend. */
export const TRENDING_MIN_LEAGUES = 2
export const TRENDING_LIMIT = 8
const TTL_MS = 15 * 60_000

export type TrendingAdd = SleeperPlayer & { leagues: number }
export type TrendingAdds = {
  rows: TrendingAdd[]
  /** Distinct leagues with any add in the window — the denominator for "added in N". */
  activeLeagues: number
  /** The newest transaction on file in the window, ISO; the list is "through" this. */
  through: string | null
}

type Row = { sid: string; leagues: number; active_leagues: number; newest: Date | null }

let cached: { at: number; value: Promise<TrendingAdds | null> } | null = null

/** Tests only. */
export function clearTrendingAddsCache(): void {
  cached = null
}

export function loadTrendingAdds(now: Date = new Date()): Promise<TrendingAdds | null> {
  if (cached && now.getTime() - cached.at < TTL_MS) return cached.value
  const value = read(now).catch(() => {
    cached = null // a failed read is not cached as "nobody added anyone"
    return null
  })
  cached = { at: now.getTime(), value }
  return value
}

async function read(now: Date): Promise<TrendingAdds | null> {
  const since = new Date(now.getTime() - TRENDING_WINDOW_DAYS * 86_400_000)
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    WITH tx AS (
      SELECT DISTINCT ON (lower(l.platform), l."platformLeagueId", t.payload->>'sleeperTransactionId')
             l."platformLeagueId" AS league, t.payload->'adds' AS adds,
             (t.payload->>'createdAt')::timestamptz AS happened
      FROM dw_transaction_facts t
      JOIN leagues l ON l.id = t."leagueId"
      WHERE t.type IN ('free_agent', 'waiver')
        AND lower(l.platform) = 'sleeper'
        AND l."platformLeagueId" IS NOT NULL
        AND coalesce(t.payload->>'status', 'complete') = 'complete'
        AND t.payload->>'createdAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        AND jsonb_typeof(t.payload->'adds') = 'array'
        AND (t.payload->>'createdAt')::timestamptz >= ${since}
        AND (t.payload->>'createdAt')::timestamptz <= ${now}
    ),
    adds AS (SELECT tx.league, tx.happened, a.sid FROM tx, jsonb_array_elements_text(tx.adds) AS a(sid))
    SELECT sid, count(DISTINCT league)::int AS leagues,
           (SELECT count(DISTINCT league) FROM adds)::int AS active_leagues,
           (SELECT max(happened) FROM adds) AS newest
    FROM adds
    GROUP BY sid
    HAVING count(DISTINCT league) >= ${TRENDING_MIN_LEAGUES}
    ORDER BY leagues DESC, sid
    LIMIT ${TRENDING_LIMIT + 8}
  `)
  if (rows.length === 0) return { rows: [], activeLeagues: 0, through: null }
  // A margin past the limit: an id with no catalog row (a team defense, a retired id) drops out.
  const players = await resolveSleeperPlayers(rows.map((r) => r.sid))
  const out: TrendingAdd[] = []
  for (const r of rows) {
    const p = players.get(r.sid)
    if (p) out.push({ ...p, leagues: Number(r.leagues) })
    if (out.length === TRENDING_LIMIT) break
  }
  return {
    rows: out,
    activeLeagues: Number(rows[0].active_leagues) || 0,
    through: rows[0].newest ? new Date(rows[0].newest).toISOString() : null,
  }
}
