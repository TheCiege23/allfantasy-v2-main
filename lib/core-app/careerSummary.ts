/**
 * `/core/career` — the fifth surface on the Sports OS foundation, and the one that completes a
 * screen rather than starting a new one: `?view=records` already reads through
 * `careerRecordsSummary`, and this is the default view beside it.
 *
 * `getCareerData` derives the trophy room from everything the account has ever imported, and it
 * reads TWO sources to do it, because neither alone is correct: `legacy_leagues` + `legacy_rosters`
 * carry the rich per-season detail but are Sleeper-only, while `leagues.import_*` is the only source
 * that knows which platform a season came from. Its own header explains why the platform filter
 * forces both to be read — a filter built on the legacy rows alone would silently drop every ESPN
 * and Yahoo season the moment someone picked one.
 *
 * ── 🛑 ZERO CLOCK REFERENCES, WHICH IS THE RULE THIS LAYER NOW CHECKS FIRST ──
 *
 * `career.ts` contains no `new Date()` and no `Date.now()`. A career season is settled history: it
 * changes when an IMPORT runs, not when time passes. That is a weaker dependence on freshness than
 * even `careerRecords` has — records move when a week finalises, whereas this moves only when the
 * user connects or re-syncs a league.
 *
 * It is stated up front because it is the check that disqualified `home`/`dash34` when this layer
 * looked at it: **a summary may cache a payload derived from rows, never one with a clock rendered
 * into it.** `getDash34Data(userId, leagues, now)` takes a clock and bakes countdowns into its
 * output; `getCareerData(userId, platformFilter)` takes no clock at all.
 *
 * ── 🛑 THE PLATFORM FILTER IS PART OF THE KEY, AND THE CASE-FOLD HAS TO MATCH ──
 *
 * `?platform=` narrows the whole board to one provider, so two filters are two different answers and
 * must not share an entry — the same reason `focusLeagueId` is part of the season-outlook key.
 *
 * ⚠ AND THE NORMALISATION HAS TO AGREE WITH THE BUILDER'S, not merely exist. `getCareerData` folds
 * its argument with `.trim().toLowerCase() || null`, and `scopeKey` now folds `platform` the same
 * way. If only one of them folded, `?platform=Sleeper` and `?platform=sleeper` would share a cache
 * entry while being computed as two different reads — a key and its payload disagreeing, which is
 * the failure mode that has no symptom until someone switches the dropdown and sees the wrong board.
 * Normalising ONCE, in `readCareerSummary`, and passing that single value to both the scope and the
 * builder is what keeps them from drifting apart.
 *
 * ── ⚠ `invalidatedBy` IS EMPTY, for `weekAllSummary`'s reason ──
 *
 * The key carries a userId and no league id — a career spans every league the account has ever
 * played — while the sweep is a prefix match on `l=<leagueId>&`. Listing import events here would
 * look like event-driven invalidation and be a silent no-op.
 *
 * ⚠ Worth noting what that costs HERE specifically, because it is the one screen where the TTL is
 * genuinely the wrong instrument: the data changes on import, and an import is exactly the moment a
 * user goes to look. A freshly connected league will not appear on this board until the TTL lapses.
 * That is why the TTL below is minutes rather than the hours the data's own volatility would allow —
 * see its note. The right fix is a user-keyed sweep, which needs league→members and is real work.
 */

import 'server-only'

import { getCareerData, type CareerData } from './career'
import { portfolioFingerprint } from './homePortfolioSummary'
import type { Dash34LeagueRow } from './dash34'
import { readScreenSummary, registerScreenSummary } from '@/lib/sports-os/summaries'
import { sportsDataCacheTier } from '@/lib/sports-os/durableTier'
import type { Fresh } from '@/lib/sports-os/freshness'

export const CAREER_SCREEN = 'career'

/**
 * Thirty minutes — RAISED FROM FIVE, because the reason for five no longer holds.
 *
 * Five minutes was never about the data: career history changes only on import, and on volatility
 * alone this could sit for hours. It was short because a user-scoped key cannot be swept by league,
 * so the TTL was the ONLY thing that would surface a league the user had just imported — and an
 * import is exactly when someone opens this screen.
 *
 * The fingerprint now does that job precisely: an import moves `lastSyncedAt`, the digest changes,
 * the key changes, and the next read rebuilds immediately rather than up to five minutes later. So
 * the TTL goes back to being what it should always have been — a backstop for whatever the digest
 * does not cover — and it is set against the data's real volatility instead of against a guess.
 */
const TTL_MS = 30 * 60_000

/**
 * Two hours, matching `careerRecords`. The reason it was fifteen minutes is the reason the TTL was
 * five — serving a board that predated a just-finished import. The fingerprint removes that case
 * entirely: a post-import read has a different key, so it can never be served the old board stale.
 */
const STALE_WHILE_REVALIDATE_MS = 2 * 60 * 60_000

/** The one place the filter is folded. Both the scope and the builder take THIS value. */
function normalisePlatform(platformFilter: string | null | undefined): string | null {
  return platformFilter?.trim().toLowerCase() || null
}

registerScreenSummary<CareerData | null>({
  screen: CAREER_SCREEN,
  /** ⚠ Bump whenever `CareerData` changes shape — the version is part of the cache key. */
  version: 1,
  ttlMs: TTL_MS,
  staleWhileRevalidateMs: STALE_WHILE_REVALIDATE_MS,
  // See the header: a user-scoped key carries no league id, so a league sweep would match nothing.
  invalidatedBy: [],
  build: async (scope) => {
    const userId = scope.userId ?? ''
    if (!userId) return null
    /*
     * ⚠ READ BACK OFF THE SCOPE, NEVER RE-DERIVED FROM A CLOSURE. The scope is what the key was
     * built from, so taking the filter from anywhere else is how a rebuild could compute one board
     * and file it under another board's key. It is already normalised by `readCareerSummary`, and
     * `getCareerData` folding it again is idempotent.
     */
    return getCareerData(userId, scope.platform ?? null)
  },
})

/**
 * Read the career board through the summary cache.
 *
 * `platformFilter` is `?platform=` — null for "every platform at once", which is the default view.
 * It is folded once here and that single value goes to both the scope and the builder.
 */
export async function readCareerSummary(
  userId: string,
  platformFilter: string | null,
  leagueRows: readonly Dash34LeagueRow[],
): Promise<Fresh<CareerData | null> | null> {
  if (!userId) return null
  const platform = normalisePlatform(platformFilter)
  /*
   * ⚠ THE UNFILTERED LIST, NOT `toPlayedLeagues`. `getCareerData` reads `legacy_leagues` too, and a
   * legacy row is exactly what that filter drops — digesting the filtered list would miss a change
   * this board shows. A digest covering more than the builder reads costs an extra rebuild; one
   * covering less serves stale silently.
   */
  return readScreenSummary<CareerData | null>(
    CAREER_SCREEN,
    { userId, platform, fingerprint: portfolioFingerprint(leagueRows) },
    { durable: sportsDataCacheTier() },
  )
}
