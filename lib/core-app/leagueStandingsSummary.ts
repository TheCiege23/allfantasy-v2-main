/**
 * `/core/standings` as a screen-ready summary — the first surface on the Sports OS foundation.
 *
 * `getLeagueStandings` reads EVERY `WeeklyMatchup` row the league has, every team, and the user's
 * own rows, then ranks, computes movement week by week, builds a trend and projects a pace. It is
 * correct and it is the same work on every visit, for every member, all season. This wraps it in
 * `lib/sports-os/summaries.ts` so the twelfth visitor of the minute reads a computed board instead
 * of recomputing it.
 *
 * ⚠ READ-THROUGH, SO THERE IS NO WRITER TO SCHEDULE AND NOTHING TO GO STALE-FOREVER. CLAUDE.md's
 * rule — *"Migrate the read and wire the writer together, or not at all"* — is about a surface
 * pointed at a table nothing refreshes, which is how `DevyPlayer`'s stat columns served nulls while
 * looking correct. That failure is structurally impossible here: a missing or invalidated entry
 * costs one rebuild on the next read. `invalidateLeagueStandings` below is a LATENCY optimisation,
 * and the TTL is the correctness bound.
 *
 * ── Why the scope is keyed on the PLATFORM league id ──────────────────────────
 *
 * 🛑 THIS IS THE ONE DECISION IN THIS FILE THAT IS NOT OBVIOUS, AND REVERSING IT BREAKS
 * INVALIDATION SILENTLY.
 *
 * `WeeklyMatchup.leagueId` holds the PROVIDER's league id, not our UUID — CLAUDE.md records that
 * only 2 of those ids on production match a `League.id`, and that mixing them is how rows get
 * written that nothing can join back. The sync that changes those rows
 * (`syncConnectedSleeperLeague`) holds `connection.externalLeagueId` and has no AF league id in
 * scope at all. And `League.platformLeagueId` has NO standalone index — only
 * `@@unique([userId, platform, platformLeagueId, season])`, which a lookup by platform id alone
 * cannot use as a left prefix.
 *
 * So keying the cache on our UUID would make every invalidation an unindexed scan of `League` on a
 * path that runs once per league per sync. Keying it on the provider's id — the same id the cached
 * DATA is keyed on — makes invalidation a direct bounded prefix delete with no lookup at all.
 *
 * ⚠ AND THE SEASON IS IN THE KEY BECAUSE THE PLATFORM ID ALONE IS NOT UNIQUE ACROSS SEASONS. The
 * board carries the league's display NAME, taken from the AF row; two AF leagues sharing a platform
 * id across two seasons would otherwise collide on one entry and one of them would render the
 * other's name. With `(platformLeagueId, userId, season)` in the key, the repo's own unique
 * constraint guarantees exactly one AF league per entry.
 */

import 'server-only'

import { getLeagueStandings, type LeagueStandingsResult } from './leagueStandings'
import { leagueContextFor, type LeagueContext } from './leagueContext'
import { prisma } from '@/lib/prisma'
import { readScreenSummary, registerScreenSummary, invalidateScreenForLeague } from '@/lib/sports-os/summaries'
import { sportsDataCacheTier } from '@/lib/sports-os/durableTier'
import { EVENT } from '@/lib/events/catalog'
import type { Fresh } from '@/lib/sports-os/freshness'

export const STANDINGS_SCREEN = 'standings'

/**
 * How long a board counts as current.
 *
 * Sized against the thing UNDER it, not picked for feel: `ensureMatchupsCached` only refetches the
 * live week once its rows are older than its own stale threshold (30 min by default), so the
 * underlying `WeeklyMatchup` rows are not live either. A shorter TTL here would rebuild an
 * identical board from identical rows. Two minutes keeps a scoring change visible quickly while
 * collapsing the burst of a whole league opening the page at once.
 */
const TTL_MS = 2 * 60_000

/**
 * Past the TTL, serve the previous board immediately and rebuild behind it.
 *
 * ⚠ TEN MINUTES, NOT UNLIMITED. A board this far past its TTL is served labelled `last-known`, and
 * the screen is expected to say so. Past the window the next reader waits for a real rebuild rather
 * than being handed something arbitrarily old.
 */
const STALE_WHILE_REVALIDATE_MS = 10 * 60_000

type StandingsScope = { leagueId: string; userId: string; seasonId: string }

/**
 * The AF league row for a scope, from the provider's id.
 *
 * ⚠ RESOLVED HERE RATHER THAN SMUGGLED THROUGH THE SCOPE. An earlier draft carried the AF id in the
 * scope's `sport` field to save this query — which put a league id in a cache key under the label
 * `sp=`, a thing no later reader could be expected to understand. This runs on a cache MISS only,
 * immediately before a build that reads every `WeeklyMatchup` row the league has; one indexed
 * lookup is not the cost worth being clever about.
 *
 * `(userId, platformLeagueId, season)` selects exactly one row: the repo's
 * `@@unique([userId, platform, platformLeagueId, season])` differs only by `platform`, and one
 * provider id does not belong to two providers.
 */
async function resolveAfLeagueId(scope: StandingsScope): Promise<string | null> {
  const season = Number(scope.seasonId)
  const row = await prisma.league
    .findFirst({
      where: {
        userId: scope.userId,
        platformLeagueId: scope.leagueId,
        ...(Number.isFinite(season) ? { season } : {}),
      },
      select: { id: true },
    })
    .catch(() => null)
  return row?.id ?? null
}

registerScreenSummary<LeagueStandingsResult>({
  screen: STANDINGS_SCREEN,
  /**
   * ⚠ BUMP THIS WHENEVER `LeagueStandingsResult` CHANGES SHAPE. The version is part of the cache
   * key, so forgetting serves the OLD shape to a renderer expecting the new one — out of a cache
   * that has no idea anything changed. No error, no conflict, wrong screen.
   */
  version: 1,
  ttlMs: TTL_MS,
  staleWhileRevalidateMs: STALE_WHILE_REVALIDATE_MS,
  /**
   * The events that make a points-for board wrong.
   *
   * ⚠ TRADES AND WAIVERS ARE DELIBERATELY ABSENT. This board is built from `WeeklyMatchup.pointsFor`
   * and `LeagueTeam`; moving a player between rosters does not change a week that has already been
   * scored. Listing them would invalidate the whole league on every accepted trade for no change in
   * output — worker load and cache churn bought with nothing.
   */
  invalidatedBy: [
    EVENT.INGEST_LEAGUE_COMPLETED,
    EVENT.INGEST_ROSTERS_REFRESHED,
    EVENT.INGEST_SCORES_REFRESHED,
    EVENT.MATCHUP_FINALIZED,
    EVENT.STANDINGS_UPDATED,
  ],
  /**
   * A domain event names the league by OUR uuid; this cache is keyed on the provider's id. One
   * primary-key lookup bridges them.
   *
   * ⚠ THIS IS THE CHEAP DIRECTION, AND THAT ASYMMETRY IS WHY THE KEY IS WHAT IT IS. Going the other
   * way — provider id to our uuid, which is what the sync would need — has no index to use. Here we
   * hold the primary key, so it is the cheapest query this codebase makes.
   */
  leagueKeyForEvent: async (event) => {
    if (!event.leagueId) return null
    const row = await prisma.league
      .findUnique({ where: { id: event.leagueId }, select: { platformLeagueId: true } })
      .catch(() => null)
    return row?.platformLeagueId ?? null
  },
  build: async (scope) => {
    const leagueId = scope.leagueId ?? ''
    const userId = scope.userId ?? ''
    if (!leagueId || !userId) {
      return { available: false, leagueName: 'Standings', history: [], reason: 'missing league or user scope' }
    }
    const afLeagueId = await resolveAfLeagueId({ leagueId, userId, seasonId: scope.seasonId ?? '' })
    if (!afLeagueId) {
      /*
       * Reachable and not an error: a league the user has since disconnected, or a season row that
       * was removed between the read and the rebuild. `available: false` is the shape the screen
       * already renders for "cannot be drawn", so it degrades into the existing path rather than
       * throwing inside a Suspense boundary.
       */
      return { available: false, leagueName: 'Standings', history: [], reason: 'this league is no longer connected' }
    }
    return getLeagueStandings(afLeagueId, userId)
  },
})

/**
 * Read this league's standings board, through the summary cache.
 *
 * Costs one primary-key lookup plus a cache read on a hit. The lookup is not waste — it is how the
 * AF league id becomes the platform id the cache is keyed on, and `findUnique` on a primary key is
 * the cheapest query this codebase makes.
 *
 * Returns `null` only when the league row itself cannot be read, which is the same signal the page
 * already handles. A BUILD failure rejects, exactly as `getLeagueStandings` would have.
 */
export async function readLeagueStandingsSummary(
  leagueId: string,
  userId: string,
  /**
   * The render's shared league context — see `leagueContext.ts`. The page already holds this row,
   * so on a summary hit the board now costs the cache read alone. A miss rebuilds through
   * `getLeagueStandings` inside the summary builder, which cannot be handed this context.
   */
  ctx?: LeagueContext | null,
): Promise<Fresh<LeagueStandingsResult> | null> {
  const league = await leagueContextFor(leagueId, userId, ctx)
    .league()
    .catch(() => null)
  if (!league?.platformLeagueId) return null

  return readScreenSummary<LeagueStandingsResult>(
    STANDINGS_SCREEN,
    {
      leagueId: league.platformLeagueId,
      userId,
      seasonId: String(league.season ?? ''),
    } satisfies StandingsScope,
    { durable: sportsDataCacheTier() },
  )
}

/**
 * Drop every cached standings board for one platform league — all its members, all its seasons.
 *
 * Called by the sync that has just rewritten this league's `WeeklyMatchup` rows. Bounded: the key
 * space is one league's members × seasons, so the durable sweep is tens of rows.
 *
 * ⚠ NEVER THROWS, AND THE CALLER MUST NOT AWAIT IT FOR CORRECTNESS. A failed invalidation costs at
 * most `TTL_MS` of staleness on a labelled board. Failing a league sync — which has already done
 * its real work — to report a cache miss would be strictly worse than the staleness.
 */
export async function invalidateLeagueStandings(platformLeagueId: string): Promise<number> {
  if (!platformLeagueId) return 0
  try {
    return await invalidateScreenForLeague(STANDINGS_SCREEN, platformLeagueId, sportsDataCacheTier())
  } catch {
    return 0
  }
}
