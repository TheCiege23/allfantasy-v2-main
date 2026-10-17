/**
 * `/core/trades` (no league selected) — the sixth surface on the Sports OS foundation.
 *
 * `getTradesBoard` reads every claimed team the account has, then every `LeagueTrade` history row
 * behind them, and re-orients each trade against the reader. It is the cross-league trade board, so
 * it spans the whole portfolio on every render of a screen people open repeatedly.
 *
 * ── 🛑 CLOCK CHECK FIRST, AS AN ENTRY CRITERION ──
 *
 * `tradesBoard.ts` contains no `new Date()` and no `Date.now()`, and `getTradesBoard(userId,
 * currentWeek)` takes no `now`. The week arrives as a plain NUMBER that the caller already resolved,
 * which is a very different thing from a clock: it is an identifier for which slate the board is
 * about, and it belongs in the cache key rather than being re-derived inside a cached payload.
 *
 * ── THE WEEK IS THE KEY'S `period`, AND THAT FIELD ALREADY EXISTED ──
 *
 * `SummaryScope.period` is documented as "a week for NFL, a gameday elsewhere" and was unused until
 * now. A board computed for week 3 is not week 4's board, so the two must not share an entry — the
 * same rule that put `focusLeagueId` in the season-outlook key and `platform` in career's.
 *
 * ⚠ AND `build` TAKES THE WEEK OFF THE SCOPE, NEVER RE-RESOLVES IT. `resolveCurrentWeek` needs the
 * platform league ids, and a stale-while-revalidate rebuild runs with no request in scope — but more
 * importantly, re-resolving could return a DIFFERENT week than the one the key was built from, and
 * then the entry filed under `p=3` would hold week 4's board. Reading `scope.period` is what keeps
 * the key and its payload describing the same thing.
 *
 * ── ⚠ `invalidatedBy` IS EMPTY, AND THERE IS NOW A BETTER TOOL THAN THE TTL FOR THIS ──
 *
 * The key carries a userId and no league id, so the `l=<leagueId>&` prefix sweep would match nothing
 * — `weekAllSummary`'s problem, and the reason the TTL carries the correctness here.
 *
 * 🛑 BUT THE "REAL WORK" THAT NOTE CALLED UNAVOIDABLE HAS SINCE BEEN DONE, BY SOMEONE ELSE.
 * `lib/core-app/homePortfolioSummary.ts` (2026-09-16) invalidates on a FINGERPRINT of the league
 * list — every field its joins read, `lastSyncedAt` included — so a new import, a removed league or
 * a finished sync changes the hash and the next render rebuilds, with no writer having to remember
 * anything and no event plumbing at all. That is strictly better than a TTL for exactly this gap,
 * and trades have the same shape: they appear when a sync imports them.
 *
 * It was adopted later via `SummaryScope.fingerprint` — and then narrowed on 2026-10-03, because
 * `lastSyncedAt` moves on every routine sync and kept the board permanently cold. The key now follows
 * the board's own inputs; see `tradesBoardInputDigest`.
 */

import 'server-only'

import { createHash } from 'node:crypto'
import { getTradesBoard, type TradesBoardData } from './tradesBoard'
import { portfolioFingerprint } from './homePortfolioSummary'
import type { Dash34LeagueRow } from './dash34'
import { prisma } from '@/lib/prisma'
import { readScreenSummary, registerScreenSummary } from '@/lib/sports-os/summaries'
import { sportsDataCacheTier } from '@/lib/sports-os/durableTier'
import type { Fresh } from '@/lib/sports-os/freshness'

export const TRADES_BOARD_SCREEN = 'trades-board'

/**
 * Thirty minutes — RAISED FROM FIVE, for the same reason career's was.
 *
 * Five was never about the data. A trade appears when a sync imports it, and with no sweep reaching
 * a user-scoped key the TTL was the only thing that would surface it — so it was set short enough
 * that "I just traded and it is not here" was a brief wait rather than a long one.
 *
 * The fingerprint does that precisely now: a sync that imports or rewrites a trade changes
 * `tradesBoardInputDigest`, the key changes, and the next read rebuilds. The TTL returns to being a
 * backstop — and is what bounds the fields that digest deliberately leaves out (see it).
 */
const TTL_MS = 30 * 60_000

/**
 * Two hours. It was half an hour to bound how long a post-import board could be served stale; the
 * fingerprint removes that case, because a post-import read has a different key and cannot be served
 * the old board at all.
 */
const STALE_WHILE_REVALIDATE_MS = 2 * 60 * 60_000

registerScreenSummary<TradesBoardData | null>({
  screen: TRADES_BOARD_SCREEN,
  /**
   * ⚠ Bump whenever `TradesBoardData` changes shape — the version is part of the cache key.
   *
   * 2 — `TradeAsset` gained `kind` and picks now appear in `sent`/`received`. A v1 entry is
   * a board with no picks in it and a "latest" trade chosen by the old (season, week) order,
   * and it would be served for up to two hours after the fix ships. The bump is what makes
   * the correction visible on the next render instead of after the stale window.
   *
   * 3 — duplicate league cards are collapsed (`collapseClaimedLeagues`). The payload SHAPE is
   * unchanged, so this bump is not about deserialising an old entry: it is that a v2 entry
   * holds a `windows` list built one-per-COPY rather than one-per-league, and the key's
   * fingerprint is derived from the league list rather than from this rule, so nothing else
   * would evict it.
   *
   * 4 — rows gained `freshTrade` / `oneWayOnFile`, a trade made this week leads the board, and
   * one-way moves in a Pirate league no longer count as trades or headline a card. A v3 entry would keep a new trade
   * off screen for up to its stale window, which is the defect v4 fixes.
   */
  version: 4,
  ttlMs: TTL_MS,
  staleWhileRevalidateMs: STALE_WHILE_REVALIDATE_MS,
  // See the header: a user-scoped key carries no league id, so a league sweep would match nothing.
  invalidatedBy: [],
  build: async (scope) => {
    const userId = scope.userId ?? ''
    if (!userId) return null
    /*
     * ⚠ THE WEEK COMES OFF THE SCOPE. See the header: re-resolving it here could return a different
     * week than the key was built from, filing one week's board under another week's key.
     */
    return getTradesBoard(userId, scope.period ?? null)
  },
})

/**
 * A digest of the rows `getTradesBoard` actually reads that a sync can change: which teams the
 * account has claimed, the CONTENT of every `LeagueTrade` behind them, and the pending AF offers.
 *
 * 🛑 WHY THIS EXISTS (2026-10-03): `lastSyncedAt` IN THE KEY MEANT THE BOARD WAS ALMOST NEVER SERVED
 * FROM CACHE. The fingerprint digested every league row's `lastSyncedAt`, and a routine sync sweep
 * moves it on dozens of leagues several times an hour whether or not it imported anything. Measured
 * on production: the owner's 65 leagues synced in five separate minutes in one hour, and the durable
 * tier held 29 boards for one user and one week, each under a different fingerprint, all written in
 * the same two minutes — every one a full ~30s cold build (40 leagues graded in sequence) that
 * stale-while-revalidate could not cover, because SWR only applies within a key.
 *
 * So the key now follows the board's INPUTS rather than a proxy for "something may have changed":
 * a sync that imports a trade (or rewrites one — `normalize-historical` upserts players, picks,
 * week and date onto an existing row, which is why this hashes content and not `count + max(createdAt)`)
 * changes the digest and still gets the genuinely cold build the fingerprint was introduced for.
 * A sync that imported nothing no longer evicts anything.
 *
 * ⚠ NOT COVERED, DELIBERATELY: manager display names (`LeagueTeam.ownerName`/`teamName`) and player
 * values. Both are cosmetic or market-driven, `LeagueTeam.lastUpdatedAt` is `@updatedAt` and so moves
 * on every sync upsert (it would reintroduce exactly the churn removed here), and the 30-minute TTL
 * — the only correctness this screen had before the fingerprint — bounds them.
 *
 * Measured at 7.7ms execution against production for the owner (95 claimed teams, 733 trade rows),
 * 144ms round trip for the heaviest account. Returns null on any failure; the caller then falls back
 * to the conservative full fingerprint, which over-invalidates rather than serving stale.
 */
export async function tradesBoardInputDigest(userId: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ claimed: string; trades: string; pending: string }>>`
      WITH claimed AS (
        SELECT DISTINCT t."leagueId" AS id, l."platformLeagueId" AS pid
        FROM league_teams t JOIN leagues l ON l.id = t."leagueId"
        WHERE t."claimedByUserId" = ${userId}
      ), hist AS (
        SELECT h.id FROM "LeagueTradeHistory" h
        WHERE h."sleeperLeagueId" IN (SELECT pid FROM claimed WHERE pid IS NOT NULL AND pid <> '')
      )
      SELECT
        (SELECT count(*)::text || ':' || md5(coalesce(string_agg(id, ',' ORDER BY id), '')) FROM claimed) AS claimed,
        (SELECT count(*)::text || ':' || md5(coalesce(string_agg(
            concat_ws('|', lt."historyId", lt."transactionId", lt.season, lt.week, lt."tradeDate",
              lt."playersGiven"::text, lt."playersReceived"::text, lt."picksGiven"::text, lt."picksReceived"::text,
              lt."partnerName", lt."partnerRosterId"),
            ',' ORDER BY lt."historyId", lt."transactionId"), ''))
         FROM "LeagueTrade" lt WHERE lt."historyId" IN (SELECT id FROM hist)) AS trades,
        (SELECT count(*)::text || ':' || coalesce(max(a."updatedAt")::text, '')
         FROM af_league_trades a WHERE a."leagueId" IN (SELECT id FROM claimed) AND a.status = 'pending') AS pending`
    const row = rows[0]
    if (!row) return null
    return `${row.claimed}/${row.trades}/${row.pending}`
  } catch {
    return null
  }
}

/**
 * The board's cache fingerprint: the league list WITHOUT `lastSyncedAt` (so an import, a removed
 * league or a rename still changes it) plus the input digest above. With no digest, the full
 * league-list fingerprint — the pre-2026-10-03 behaviour, which errs towards rebuilding.
 */
export function tradesBoardFingerprint(
  leagueRows: readonly Dash34LeagueRow[],
  inputDigest: string | null,
): string {
  if (!inputDigest) return portfolioFingerprint(leagueRows)
  const leagues = portfolioFingerprint(leagueRows.map((row) => ({ ...row, lastSyncedAt: null })))
  return createHash('sha256').update(`${leagues}\n${inputDigest}`).digest('hex').slice(0, 32)
}

/**
 * Read the cross-league trade board through the summary cache.
 *
 * `currentWeek` is the already-resolved slate — null when no league has a `WeeklyMatchup` row to
 * resolve one from, which `getTradesBoard` handles as "no week context" rather than as an error.
 * Null and a number are different scopes, which is correct: a board built with no week context is
 * not the same board as week 3's.
 */
export async function readTradesBoardSummary(
  userId: string,
  currentWeek: number | null,
  leagueRows: readonly Dash34LeagueRow[],
): Promise<Fresh<TradesBoardData | null> | null> {
  if (!userId) return null
  const fingerprint = tradesBoardFingerprint(leagueRows, await tradesBoardInputDigest(userId))
  return readScreenSummary<TradesBoardData | null>(
    TRADES_BOARD_SCREEN,
    { userId, period: currentWeek, fingerprint },
    { durable: sportsDataCacheTier() },
  )
}
