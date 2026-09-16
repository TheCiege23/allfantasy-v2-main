/**
 * `/core/week` — the second surface on the Sports OS foundation, and the one that pays best.
 *
 * `getWeekAll` reads every `WeeklyMatchup` row across ALL of the user's played leagues and derives
 * the cross-league week board from them. It is loaded twice on a hot path: once as the `week` CARD
 * on the `/core` home (the busiest screen, ~51 renders/day) and once as the `/core/week` board. So
 * unlike standings — one league, ~2 renders/day — this one is recomputed many times a day per user.
 *
 * ── 🛑 THIS SUMMARY IS USER-SCOPED, AND THAT CHANGES WHAT INVALIDATION CAN DO ──
 *
 * Standings is keyed on one league, so `invalidateScreenForLeague` can sweep it with a bounded
 * prefix. This board spans every league the user plays, so its key carries a userId and **no league
 * id at all** — and the sweep is a prefix match on `l=<leagueId>&`.
 *
 * Therefore `invalidatedBy` is DELIBERATELY EMPTY. Listing the score and import events here would
 * look like event-driven invalidation and would be a silent no-op: `planReactions` would name
 * `week`, the consumer would build a prefix from the event's league id, and it would match nothing.
 * Nothing throws, nothing goes red, and every board serves stale until its TTL while appearing to
 * be actively invalidated. **An invalidation that cannot fire is worse than one that is absent**,
 * because the absent one is visible in this file.
 *
 * So the TTL is the whole correctness bound here, and it is short for that reason.
 *
 * ⚠ THE FIX, IF THIS EVER NEEDS TO BE EVENT-DRIVEN, IS NOT TO ADD EVENTS TO THIS LIST. It is either
 * a user-keyed sweep (which needs league→members, a query the reaction path does not have) or
 * splitting the board per league. Both are real work; neither is a one-line edit.
 */

import 'server-only'

import { getWeekAll, type WeekAllData } from './weekAll'
import { toPlayedLeagues } from './playedLeagues'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { readScreenSummary, registerScreenSummary } from '@/lib/sports-os/summaries'
import { sportsDataCacheTier } from '@/lib/sports-os/durableTier'
import type { Fresh } from '@/lib/sports-os/freshness'

export const WEEK_SCREEN = 'week'

/**
 * Sized against the data underneath, exactly as the standings TTL is: `ensureMatchupsCached` only
 * refetches the live week once its rows are older than its own ~30-minute threshold, so the
 * `WeeklyMatchup` rows this reads are not live either. Two minutes keeps a scoring change visible
 * quickly while collapsing the burst of one user reloading the home repeatedly.
 */
const TTL_MS = 2 * 60_000

/** Past the TTL, serve the previous board immediately and rebuild behind it. */
const STALE_WHILE_REVALIDATE_MS = 10 * 60_000

registerScreenSummary<WeekAllData | null>({
  screen: WEEK_SCREEN,
  /** ⚠ Bump whenever `WeekAllData` changes shape — the version is part of the cache key. */
  version: 1,
  ttlMs: TTL_MS,
  staleWhileRevalidateMs: STALE_WHILE_REVALIDATE_MS,
  // See the header: a user-scoped summary cannot be swept by league. Empty on purpose.
  invalidatedBy: [],
  build: async (scope) => {
    const userId = scope.userId ?? ''
    if (!userId) return null

    /*
     * ⚠ THE LEAGUE LIST IS RE-DERIVED HERE, NOT CARRIED IN THE SCOPE. A rebuild can happen on a
     * stale-while-revalidate pass with no request in scope, so there is no page-computed list to
     * borrow. It costs one loader call, and only on a MISS — immediately before a read of every
     * WeeklyMatchup row the user has, which is the expensive part by orders of magnitude.
     *
     * `toPlayedLeagues` is the SHARED rule (lib/core-app/playedLeagues.ts), not a copy: the raw
     * list carries AF Legacy board rows with no schedule to read, and a second implementation of
     * that filter is how the two callers would drift apart.
     */
    const payload = await getDashboardLeagueListForUser(userId).catch(() => null)
    if (!payload) return null

    /*
     * ⚠ `DashboardLeagueListPayload.leagues` IS TYPED `unknown[]`, so the shape is asserted here
     * rather than inferred — exactly as `page.tsx` does at its own call sites. `toPlayedLeagues`
     * keeps `T` free precisely so it does not have to know or flatten this.
     */
    const played = toPlayedLeagues(payload.leagues) as Array<{
      id?: unknown
      name?: unknown
      platform?: unknown
      platformLeagueId?: string | null
    }>

    return getWeekAll(
      userId,
      played.map((l) => ({
        id: String(l.id ?? ''),
        name: String(l.name ?? ''),
        platform: String(l.platform ?? ''),
        platformLeagueId: l.platformLeagueId ?? null,
      })),
    )
  },
})

/**
 * Read the cross-league week board through the summary cache.
 *
 * ⚠ SCOPED ON `userId` ALONE, WHICH IS THE WHOLE IDENTITY OF THIS BOARD. It is not per-league, and
 * it deliberately does NOT cover the `{ previous: true }` variant: both page call sites take the
 * default, and only `lib/core-app/weeklyRoutine.ts` asks for the previous week. Folding a second
 * variant into one key would serve one caller the other's board.
 */
export async function readWeekAllSummary(userId: string): Promise<Fresh<WeekAllData | null> | null> {
  if (!userId) return null
  return readScreenSummary<WeekAllData | null>(WEEK_SCREEN, { userId }, { durable: sportsDataCacheTier() })
}
