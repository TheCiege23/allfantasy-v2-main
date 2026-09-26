/**
 * `/core/portfolio` — the eighth surface on the Sports OS foundation, and the first whose cost is a
 * SERIAL FAN-OUT rather than a wide join.
 *
 * ── 🛑 CLOCK CHECK FIRST, AS AN ENTRY CRITERION ──
 *
 * `portfolio.ts` contains no `new Date()` and no `Date.now()`, and `getPortfolio(userId)` takes no
 * `now`. So do `crossLeagueValueActions.ts` and `dash3aPanels.ts`, the screen's two side panels.
 * That check is what disqualified a naive `home`/`dash34` summary, and it is run BEFORE choosing a
 * screen rather than discovered afterwards.
 *
 * The portfolio is an INVENTORY — "what do I have", as against home's "what needs me now". An
 * inventory changes when an import runs, not when time passes, which is the same property that made
 * `career` cacheable.
 *
 * ── ⚠ THE COST HERE IS N+2 SERIALIZED QUERIES, NOT ONE BIG ONE ──
 *
 * Worth stating because it is a different shape from every summary before it, and it is why this
 * screen is worth caching despite returning a short list. `getPortfolio` runs:
 *
 *   1. one `leagueTeam.findMany` for the claimed teams,
 *   2. one `leagueTeam.groupBy` for the team counts,
 *   3. **and then `findRosterForTeam` once per claimed team, inside a sequential `for` loop** —
 *      each one a `$queryRaw`, each awaited before the next begins.
 *
 * So an eight-league account pays ten round trips end to end, and they do not overlap. The other
 * user-scoped boards pay a fixed handful of wide reads; this one pays a per-league trip that grows
 * with exactly the people who use the screen most. Collapsing a browsing session's repeats is
 * therefore worth more here than the row count suggests.
 *
 * ⚠ AND THAT LOOP IS NOT A BUG TO FIX ON THE WAY PAST. `findRosterForTeam` tries the durable
 * `source_manager_id` before the direct column — the reason it reaches 96 of 98 claimed teams where
 * the naive join reached 13 — and batching it is a real change to a predicate three surfaces share
 * on purpose (`myTeam.ts`, `playerImpact.ts`). Caching the result does not touch it.
 *
 * ── 🛑 WHAT THIS SUMMARY DELIBERATELY DOES **NOT** COVER ──
 *
 * The screen loads three things in one `Promise.all`: `getPortfolio`, `getCrossLeagueExposure` and
 * `getCrossLeagueValueActions`. **Only the first is summarised here**, and the boundary is forced by
 * the layer's own contract rather than chosen for convenience:
 *
 * | loader | inputs | summarisable |
 * |---|---|---|
 * | `getPortfolio(userId)` | the userId | ✅ buildable from the scope |
 * | `getCrossLeagueExposure(userId, leagueIds, 12)` | the league ID LIST | ❌ |
 * | `getCrossLeagueValueActions(userId, leagueRows, 12)` | league ROWS | ❌ |
 *
 * `ScreenSummaryDefinition.build` takes `(scope: SummaryScope)` and nothing else, and a `SummaryScope`
 * is a handful of short scalars by design — `scopeKey` drops any value over 64 characters. A league
 * list cannot go in it, so the two panels cannot be rebuilt on a miss.
 *
 * ⚠ AND THE OBVIOUS WORKAROUND IS THE BUG. Having `build` re-derive the league list itself would
 * compile, pass every test, and be wrong: the fingerprint in the KEY is computed from the page's
 * list, so a builder that resolved its own could file one portfolio's panels under another
 * portfolio's key. That is exactly the failure `tradesBoardSummary` pins a test against for the
 * week — the builder must take what was keyed, never re-resolve it. A summary that cannot take its
 * input from the scope is a summary that should not exist yet.
 *
 * The honest consequence: this screen gets faster, not free. Widening `build` to accept caller-held
 * inputs is a change to the module every summary depends on and belongs in its own change, with the
 * key/payload agreement worked out first.
 */

import 'server-only'

import { getPortfolio, type PortfolioData } from './portfolio'
import { portfolioFingerprint } from './homePortfolioSummary'
import type { Dash34LeagueRow } from './dash34'
import { readScreenSummary, registerScreenSummary } from '@/lib/sports-os/summaries'
import { sportsDataCacheTier } from '@/lib/sports-os/durableTier'
import type { Fresh } from '@/lib/sports-os/freshness'

export const PORTFOLIO_SCREEN = 'portfolio'

/**
 * Thirty minutes, matching career's and trades' post-fingerprint TTLs — and arrived at the same way
 * rather than copied.
 *
 * An inventory changes on import, and the digest sees an import: a new league, a removed one or a
 * finished sync moves the league list, so the key changes and the next read rebuilds cold. With that
 * covered precisely, the TTL is only a backstop for what the digest cannot see, and the data's own
 * volatility is low — a league's name, artwork and commissioner flag are close to static, and a
 * record moves once a week.
 *
 * 🛑 IT IS NOT SHORT FOR WAIVERS' REASON, AND THAT DISTINCTION IS THE ONE TO KEEP. Waivers stays at
 * two minutes because a claim changes with nothing about the league list moving. Nothing on this
 * screen does that: every field here is derived from rows a sync writes, and a sync moves
 * `lastSyncedAt`. So the digest is not merely a proxy for this board — it genuinely covers it.
 */
const TTL_MS = 30 * 60_000

/**
 * Two hours, matching career's and trades'. A stale window can be long precisely because the
 * fingerprint makes the dangerous case unreachable: a post-import read has a DIFFERENT KEY, so it
 * can never be served the pre-import inventory stale while a rebuild runs behind it.
 */
const STALE_WHILE_REVALIDATE_MS = 2 * 60 * 60_000

registerScreenSummary<PortfolioData | null>({
  screen: PORTFOLIO_SCREEN,
  /** ⚠ Bump whenever `PortfolioData` changes shape — the version is part of the cache key. */
  version: 2,
  ttlMs: TTL_MS,
  staleWhileRevalidateMs: STALE_WHILE_REVALIDATE_MS,
  /*
   * Empty for the reason the other user-scoped boards record: the key carries a userId and no league
   * id, so the `l=<leagueId>&` prefix sweep would match nothing. The fingerprint is what invalidates
   * this screen, and it does it from the key rather than from an event.
   */
  invalidatedBy: [],
  build: async (scope) => {
    const userId = scope.userId ?? ''
    if (!userId) return null
    return getPortfolio(userId)
  },
})

/**
 * Read the league inventory through the summary cache. Scoped on `userId` plus the portfolio digest.
 *
 * ⚠ THE UNFILTERED LIST, NOT `toPlayedLeagues`. `getPortfolio` resolves its own leagues from
 * `LeagueTeam.claimedByUserId` and applies no played/unplayed filter of its own, so digesting the
 * filtered list would miss a change this screen shows. A digest covering MORE than the builder reads
 * costs an extra rebuild — the safe direction; one covering less serves stale silently.
 */
export async function readPortfolioSummary(
  userId: string,
  leagueRows: readonly Dash34LeagueRow[],
): Promise<Fresh<PortfolioData | null> | null> {
  if (!userId) return null
  return readScreenSummary<PortfolioData | null>(
    PORTFOLIO_SCREEN,
    { userId, fingerprint: portfolioFingerprint(leagueRows) },
    { durable: sportsDataCacheTier() },
  )
}
