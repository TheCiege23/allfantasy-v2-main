/**
 * `/core/waivers` (no league selected) — the seventh surface on the Sports OS foundation, and the
 * simplest key of the seven.
 *
 * `getWaiversBoard` reads every claimed team the account has and then the waiver state behind each
 * one, across every league. Like the trade board it spans the whole portfolio on a screen people
 * open repeatedly during the waiver window.
 *
 * ── 🛑 CLOCK CHECK FIRST, AS AN ENTRY CRITERION ──
 *
 * `waiversBoard.ts` contains no `new Date()` and no `Date.now()`, and `getWaiversBoard(userId)`
 * takes no `now`. That check is what disqualified `home`/`dash34` from a naive summary, and it is
 * run BEFORE choosing a screen rather than discovered afterwards.
 *
 * ⚠ WAIVERS ARE THE MOST CLOCK-ADJACENT SCREEN TO PASS IT, SO THE REASONING IS WORTH STATING.
 * A waiver has a processing time, and a reader is often looking precisely because a deadline is
 * near. But the DEADLINE ITSELF IS A STORED INSTANT on the league's settings, not something this
 * function renders against `now` — it derives no countdown and no "closes in 2 hours" string. The
 * board is a function of rows, and anything time-relative is the component's to render from the
 * instants it is handed. That is the distinction the layer now turns on: a stored instant is data,
 * a rendered countdown is not.
 *
 * ── `{ userId }` AND NOTHING ELSE ──
 *
 * No league (it is the cross-league board), no platform filter, no week: `getWaiversBoard` takes one
 * argument and the whole identity of the board is whose it is. That makes this the one summary here
 * with no second key dimension to get wrong — worth noting only because the previous three each had
 * one, and each needed a test pinning it.
 *
 * ── ⚠ `invalidatedBy` IS EMPTY, AND THE FINGERPRINT IS THE STANDING FOLLOW-UP ──
 *
 * The key carries a userId and no league id, so the `l=<leagueId>&` prefix sweep would match
 * nothing — `weekAllSummary`'s problem, and the reason the TTL carries the correctness.
 *
 * `lib/core-app/homePortfolioSummary.ts` solves this properly with `portfolioFingerprint`: hash
 * every field the joins read from the league list, `lastSyncedAt` included, so a sync changes the
 * hash and the next render rebuilds with nothing plumbed. It is not adopted here for the same
 * sequencing reason `tradesBoardSummary` records: the fingerprint wants to live in the cache key,
 * `SummaryScope` has no field for it, and there are already unmerged changes to
 * `lib/sports-os/summaries.ts` in flight. Adopting it across `career`, `trades` and `waivers` at
 * once, after those land, is the right shape — three TTLs replaced by one precise trigger.
 */

import 'server-only'

import { getWaiversBoard, type WaiversBoardData } from './waiversBoard'
import { portfolioFingerprint } from './homePortfolioSummary'
import type { Dash34LeagueRow } from './dash34'
import { readScreenSummary, registerScreenSummary } from '@/lib/sports-os/summaries'
import { sportsDataCacheTier } from '@/lib/sports-os/durableTier'
import type { Fresh } from '@/lib/sports-os/freshness'

export const WAIVERS_BOARD_SCREEN = 'waivers-board'

/**
 * Two minutes — the SHORTEST of the user-scoped summaries, and the reason is the waiver window.
 *
 * 🛑 AND THE FINGERPRINT DOES NOT LICENSE RAISING IT, THOUGH IT RAISED CAREER'S AND TRADES'.
 * Those two were short only because the TTL was standing in for invalidation on import; once the
 * digest does that job precisely, their TTLs go back to the data's own volatility. **This one is
 * short for a different reason entirely** — a waiver claim can change WITHOUT the league list
 * changing at all (another manager places a bid; nothing about the league row moves), so the digest
 * cannot see it. The reader is usually checking against a deadline and deciding whether to bid, so
 * this is the one staleness on this layer that could change what a user DOES rather than only what
 * they read. Two minutes still collapses the reload burst the claimed-team and per-league waiver
 * reads actually cost.
 */
const TTL_MS = 2 * 60_000

/**
 * Ten minutes, matching the week board's ratio rather than the other user-scoped boards' — the same
 * reasoning as the TTL. A long stale window on a deadline-sensitive screen would reintroduce exactly
 * the staleness the short TTL is buying away.
 */
const STALE_WHILE_REVALIDATE_MS = 10 * 60_000

registerScreenSummary<WaiversBoardData | null>({
  screen: WAIVERS_BOARD_SCREEN,
  /** ⚠ Bump whenever `WaiversBoardData` changes shape — the version is part of the cache key. */
  version: 1,
  ttlMs: TTL_MS,
  staleWhileRevalidateMs: STALE_WHILE_REVALIDATE_MS,
  // See the header: a user-scoped key carries no league id, so a league sweep would match nothing.
  invalidatedBy: [],
  build: async (scope) => {
    const userId = scope.userId ?? ''
    if (!userId) return null
    return getWaiversBoard(userId)
  },
})

/** Read the cross-league waiver board through the summary cache. Scoped on `userId` alone. */
export async function readWaiversBoardSummary(
  userId: string,
  leagueRows: readonly Dash34LeagueRow[],
): Promise<Fresh<WaiversBoardData | null> | null> {
  if (!userId) return null
  return readScreenSummary<WaiversBoardData | null>(
    WAIVERS_BOARD_SCREEN,
    { userId, fingerprint: portfolioFingerprint(leagueRows) },
    { durable: sportsDataCacheTier() },
  )
}
