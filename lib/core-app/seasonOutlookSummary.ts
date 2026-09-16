/**
 * `/core/season-outlook` — the third surface on the Sports OS foundation, and by a wide margin the
 * most expensive thing this app computes inside a request.
 *
 * `getSeasonOutlook` plays each league's remaining schedule out ten thousand times. Its own header
 * states the arithmetic: one production account carries 63 connected leagues at ~78 remaining games
 * each, which is **≈49 million simulated games on a single page load** — and the route is
 * `force-dynamic`, so every visit pays it in full. `TOTAL_GAME_BUDGET` exists to stop that reaching
 * the platform's ~300s edge kill, and it does so by CUTTING ITERATIONS: a heavy account silently
 * drops from 10,000 simulations per league toward the 1,500 floor, and `basis` reports the reduced
 * number. So the cost is not only latency. It is answer quality.
 *
 * That makes this the one screen where a summary buys something the other two do not: a cache hit
 * serves the FULL-ITERATION board that a cold load might not have been able to afford.
 *
 * ── 🛑 CACHING CANNOT CHANGE WHAT THIS PAGE SAYS, ONLY HOW LONG IT TAKES TO SAY IT ──
 *
 * The simulation is seeded, not random: `createRng` is a mulberry32 fed from a hash of the platform
 * league id, with no clock and no `Math.random()` anywhere in the model. Identical rows therefore
 * produce a byte-identical board. That is worth stating because it is the property that makes this
 * summary boring — there is no "the cached numbers differ from a fresh run" failure mode to reason
 * about, and a reader who assumes Monte Carlo means jitter would look for one.
 *
 * ── 🛑 `focusLeagueId` IS PART OF THE KEY, AND OMITTING IT WOULD DROP A CARD SILENTLY ──
 *
 * `getSeasonOutlook`'s third argument is additive: it guarantees the focused league gets its branch
 * simulations even when it is not among the eight most contested. So a board built WITH a focus is a
 * superset of one built without it, and the two are not interchangeable in the direction that
 * matters — serving a focused read a board built cross-league leaves that league's swing card
 * missing, which is exactly the "hole with no explanation" its own comment warns about.
 *
 * Keying on `{ userId, leagueId: focusLeagueId }` keeps them separate scopes. The cost is one extra
 * entry per focused league, which is bounded by how many leagues the user actually opens.
 *
 * ── ⚠ `invalidatedBy` IS DELIBERATELY EMPTY, FOR A SHARPER REASON THAN `weekAllSummary`'s ──
 *
 * The week board's key carries no league id at all, so a league-prefix sweep could not match it.
 * Here HALF the keys carry one — every focused scope — so a sweep WOULD fire, and that is the
 * problem. It would drop the focused board and leave the cross-league board standing, so
 * `/core/standings` with a league held and `/core/standings` with none would print different
 * playoff percentages for the same team until the TTL caught up.
 *
 * `seasonOutlook.ts` names that precise failure at its own head — the reason the cross-league board
 * and the per-league screen share ONE run is so "two surfaces" cannot "give two different answers to
 * 'where do I sit'". A partial sweep would reintroduce it through the cache instead of through the
 * model. Both scopes expiring on the same TTL is the consistent behaviour, so the TTL is the whole
 * correctness bound and it is set against the rows underneath rather than optimistically.
 */

import 'server-only'

import { getSeasonOutlook, type SeasonOutlook } from './seasonOutlook'
import { toPlayedLeagues } from './playedLeagues'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { readScreenSummary, registerScreenSummary } from '@/lib/sports-os/summaries'
import { sportsDataCacheTier } from '@/lib/sports-os/durableTier'
import type { Fresh } from '@/lib/sports-os/freshness'

export const SEASON_OUTLOOK_SCREEN = 'season-outlook'

/**
 * Ten minutes, and the bound is the DATA's refresh rate rather than a guess at user patience.
 *
 * This reads the same `WeeklyMatchup` rows the week board does, and those are themselves only
 * refetched once they are older than `ensureMatchupsCached`'s ~30-minute threshold. A TTL shorter
 * than that cannot reveal anything new most of the time — it would just re-run 49 million simulated
 * games to reproduce the previous answer exactly, which the determinism note above guarantees it
 * would. Ten minutes sits comfortably inside that window, so the summary is never the binding
 * staleness constraint; the rows are.
 */
const TTL_MS = 10 * 60_000

/**
 * An hour, which is much longer than the other two summaries allow, and deliberately.
 *
 * Stale-while-revalidate is worth most exactly where a rebuild is most expensive. A user who opens
 * the outlook eleven minutes after the last build should not wait out a full simulation run to see
 * a board that will differ only in whatever scored since; they get the previous one immediately and
 * the rebuild lands behind them.
 */
const STALE_WHILE_REVALIDATE_MS = 60 * 60_000

registerScreenSummary<SeasonOutlook | null>({
  screen: SEASON_OUTLOOK_SCREEN,
  /** ⚠ Bump whenever `SeasonOutlook` changes shape — the version is part of the cache key. */
  version: 1,
  ttlMs: TTL_MS,
  staleWhileRevalidateMs: STALE_WHILE_REVALIDATE_MS,
  // See the header: a partial league sweep would desynchronize the focused and cross-league boards.
  invalidatedBy: [],
  build: async (scope) => {
    const userId = scope.userId ?? ''
    if (!userId) return null

    /*
     * ⚠ THE LEAGUE LIST IS RE-DERIVED HERE, NOT CARRIED IN THE SCOPE — same reason as
     * `weekAllSummary`: a stale-while-revalidate rebuild runs with no request in scope, so there is
     * no page-computed list to borrow. One loader call against a run that simulates tens of
     * millions of games is not a cost worth optimising.
     *
     * ⚠ AND THE LIST IS NOT MERELY A FILTER HERE — IT SETS THE ITERATION COUNT. `chooseIterations`
     * divides `TOTAL_GAME_BUDGET` by total remaining games across every league passed in, so
     * handing this a different set than the page would hand it changes the `basis` line and the
     * precision of every percentage. `toPlayedLeagues` is the shared rule for exactly that reason.
     */
    const payload = await getDashboardLeagueListForUser(userId).catch(() => null)
    if (!payload) return null

    /*
     * ⚠ `DashboardLeagueListPayload.leagues` IS TYPED `unknown[]`, so the shape is asserted here
     * rather than inferred — exactly as `page.tsx` does at its own call sites.
     */
    const played = toPlayedLeagues(payload.leagues) as Array<{
      id?: unknown
      name?: unknown
      platform?: unknown
      platformLeagueId?: string | null
      settings?: unknown
    }>

    return getSeasonOutlook(
      userId,
      played.map((l) => ({
        id: String(l.id ?? ''),
        name: String(l.name ?? ''),
        platform: String(l.platform ?? ''),
        platformLeagueId: l.platformLeagueId ?? null,
        settings: l.settings ?? null,
      })),
      /*
       * ⚠ NORMALISED TO `null`, NOT LEFT `undefined`. `scopeKey` omits a null/undefined field
       * entirely, so both spellings share one cache key — passing `undefined` through here while
       * the key said "no league" would be fine, but passing a DIFFERENT falsy value than the read
       * scope carries is how a key and its payload drift apart. One spelling, both places.
       */
      scope.leagueId ?? null,
    )
  },
})

/**
 * Read the season outlook through the summary cache.
 *
 * `focusLeagueId` is the league being rendered, or null for the cross-league board — it is part of
 * the scope, so the two are separate entries. See the header for why that is not an optimisation to
 * remove.
 */
export async function readSeasonOutlookSummary(
  userId: string,
  focusLeagueId: string | null,
): Promise<Fresh<SeasonOutlook | null> | null> {
  if (!userId) return null
  return readScreenSummary<SeasonOutlook | null>(
    SEASON_OUTLOOK_SCREEN,
    { userId, leagueId: focusLeagueId ?? null },
    { durable: sportsDataCacheTier() },
  )
}
