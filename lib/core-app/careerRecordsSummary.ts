/**
 * `/core/career?view=records` — the fourth surface on the Sports OS foundation, and the one with
 * the cleanest correctness story of the four.
 *
 * `getCareerRecords` reads **every played roster-week this account has ever had**, across every
 * league it has ever imported, and derives the personal bests and worsts from them. `page.tsx` gates
 * it behind `?view=records` for exactly that reason — "it reads every played week this account has
 * and no other tab needs it".
 *
 * ── 🛑 ZERO CLOCK REFERENCES, WHICH IS WHY THIS ONE IS SAFE TO CACHE FOR A LONG TIME ──
 *
 * `careerRecords.ts` contains no `new Date()` and no `Date.now()` anywhere. A career record is an
 * all-time extreme over completed games: it can only change when a week FINALIZES, never with the
 * passage of time. So staleness here costs at most "your new personal best has not appeared yet on a
 * page you opened twice in half an hour" — not a wrong number, and not a number that drifts while
 * you look at it.
 *
 * That is worth stating explicitly because it is the property that DISQUALIFIED the candidate this
 * layer's own notes named next. See below.
 *
 * ── ⚠ WHY NOT `home` / `dash34`, WHICH `FOUNDATION.md` LISTED AS THE NEXT CANDIDATE ──
 *
 * `getDash34Data(userId, leagues, now)` takes a clock and bakes it into its OUTPUT: `countdown` is
 * `formatCountdown(nextGame.startTime - now)`, `next24` is a window ending at `now + 24h`,
 * `reportedAgo` is `formatAgo(now - reportedAt)`, and the injury-staleness filter compares against
 * `now`. Caching the assembled result would serve a rendered countdown reading "12 minutes" when the
 * game kicks off in two, and would keep already-started games in `firstLock`.
 *
 * `dash34.ts` has already solved its own caching at the right granularity, and its comment states
 * the rule this summary would have broken: *"THE CLOCK INSIDE THE CACHED READ IS ITS OWN. `now`
 * cannot be part of the cache key — a millisecond timestamp would defeat the cache — so each query
 * filters on its own `new Date()` and the wrapper re-filters against the caller's `now`, dropping
 * games that started inside the revalidation window."* It caches the three SHARED, user-independent
 * queries through `unstable_cache` and deliberately leaves the user-scoped reads and the assembly
 * uncached. A screen summary over the top would defeat that re-filter.
 *
 * **The rule that generalises: a summary may cache a payload derived from rows, never one that has a
 * clock rendered into it.** Check for `now` in the signature before reaching for this layer.
 *
 * ── ⚠ AND WHY NOT `rankings`, THE OTHER CANDIDATE EXAMINED ──
 *
 * `getRankingsData` has no clock either, but it is the wrong SHAPE: it blends a global read
 * (`loadRankedProfiles`, an uncached `$queryRaw` over every ranked manager on the product, run on
 * every request to three views) with per-viewer fields (`you`, `reconciliation`, `scope`). Caching
 * the blend per user would store one copy of the whole ladder PER VIEWER — the global scan is a
 * shared-read problem, and its fix is a shared cache around `loadRankedProfiles`, not this layer.
 * Recorded so the next session does not mistake "expensive" for "summary-shaped".
 *
 * ── ⚠ `invalidatedBy` IS EMPTY, for `weekAllSummary`'s reason rather than `seasonOutlookSummary`'s ──
 *
 * The key carries a userId and **no league id at all** — records span every league the account has
 * ever played — while the sweep is a prefix match on `l=<leagueId>&`. Listing finalization events
 * here would look like event-driven invalidation and be a silent no-op. The TTL is the whole bound,
 * and the note above is why a generous one is defensible here and was not on the home screen.
 */

import 'server-only'

import { getCareerRecords, type CareerRecordsData } from './careerRecords'
import { readScreenSummary, registerScreenSummary } from '@/lib/sports-os/summaries'
import { sportsDataCacheTier } from '@/lib/sports-os/durableTier'
import type { Fresh } from '@/lib/sports-os/freshness'

export const CAREER_RECORDS_SCREEN = 'career-records'

/**
 * Thirty minutes — far longer than the other three, and the justification is the determinism above
 * rather than optimism about traffic.
 *
 * The underlying value moves at most once per scored week. A shorter TTL would re-read every played
 * roster-week the account has ever had in order to reproduce the identical board, which is the
 * definition of paying for nothing.
 */
const TTL_MS = 30 * 60_000

/**
 * Two hours. `/core/career?view=records` is a screen someone opens deliberately and occasionally, so
 * a short stale window would mean nearly every visit is a cold read and the layer buys nothing. A
 * board up to ~2.5 hours old is acceptable here in a way it would not be on a live surface: the
 * worst case is one newly-finalized week missing from an all-time list.
 */
const STALE_WHILE_REVALIDATE_MS = 2 * 60 * 60_000

registerScreenSummary<CareerRecordsData | null>({
  screen: CAREER_RECORDS_SCREEN,
  /** ⚠ Bump whenever `CareerRecordsData` changes shape — the version is part of the cache key. */
  version: 1,
  ttlMs: TTL_MS,
  staleWhileRevalidateMs: STALE_WHILE_REVALIDATE_MS,
  // See the header: a user-scoped key carries no league id, so a league sweep would match nothing.
  invalidatedBy: [],
  build: async (scope) => {
    const userId = scope.userId ?? ''
    if (!userId) return null
    /*
     * ⚠ NO LEAGUE LIST TO RE-DERIVE HERE, UNLIKE THE OTHER THREE. `getCareerRecords` resolves its
     * own leagues from `LeagueTeam.claimedByUserId`, so there is no `toPlayedLeagues` call to keep
     * in step with the page — one less place for the two paths to drift.
     */
    return getCareerRecords(userId)
  },
})

/**
 * Read the career records board through the summary cache.
 *
 * ⚠ SCOPED ON `userId` ALONE, WHICH IS THE WHOLE IDENTITY OF THIS BOARD. The page only reads it when
 * no league is selected (`!selectedLeagueId`), so there is no focused variant to fold in — and if one
 * is ever added it must become part of the scope, exactly as `focusLeagueId` did for the outlook.
 */
export async function readCareerRecordsSummary(
  userId: string,
): Promise<Fresh<CareerRecordsData | null> | null> {
  if (!userId) return null
  return readScreenSummary<CareerRecordsData | null>(
    CAREER_RECORDS_SCREEN,
    { userId },
    { durable: sportsDataCacheTier() },
  )
}
