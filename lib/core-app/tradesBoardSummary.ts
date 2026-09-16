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
 * It is NOT adopted here, deliberately and only for sequencing: the fingerprint wants to be part of
 * the cache key, `SummaryScope` has no field for it, and PR #943 already has an unmerged change to
 * `lib/sports-os/summaries.ts` adding `platform`. A second concurrent edit to that shared file would
 * put two of my own branches in conflict over the one module every summary depends on. So the TTL
 * below is the interim bound and the fingerprint is the named follow-up, recorded here rather than
 * left for someone to rediscover.
 */

import 'server-only'

import { getTradesBoard, type TradesBoardData } from './tradesBoard'
import { readScreenSummary, registerScreenSummary } from '@/lib/sports-os/summaries'
import { sportsDataCacheTier } from '@/lib/sports-os/durableTier'
import type { Fresh } from '@/lib/sports-os/freshness'

export const TRADES_BOARD_SCREEN = 'trades-board'

/**
 * Five minutes, matching career's, and for the same reason rather than by copying the number.
 *
 * A trade appears here when a sync imports it, and checking straight after a trade is exactly when
 * someone opens this board. With no sweep available the TTL is the only thing that surfaces it, so
 * it is short enough that "I just traded and it is not here" is one brief wait. Five minutes still
 * collapses the repeated loads of one browsing session, which is where the claimed-team and trade
 * history reads actually cost something.
 */
const TTL_MS = 5 * 60_000

/** Half an hour. Past the TTL the previous board serves instantly while the rebuild runs behind it. */
const STALE_WHILE_REVALIDATE_MS = 30 * 60_000

registerScreenSummary<TradesBoardData | null>({
  screen: TRADES_BOARD_SCREEN,
  /** ⚠ Bump whenever `TradesBoardData` changes shape — the version is part of the cache key. */
  version: 1,
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
): Promise<Fresh<TradesBoardData | null> | null> {
  if (!userId) return null
  return readScreenSummary<TradesBoardData | null>(
    TRADES_BOARD_SCREEN,
    { userId, period: currentWeek },
    { durable: sportsDataCacheTier() },
  )
}
