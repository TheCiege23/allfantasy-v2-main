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
 * ── 2026-09-17: THE INPUTS ARE IN THE KEY, SO AN EVENT IS A COLD BUILD ──
 *
 * The TTL used to be the only correctness bound, which meant a scored week, a trade or a new injury
 * waited out ten minutes of the previous board — and stale-while-revalidate would then serve that
 * board once more. `seasonOutlookFingerprint` digests cheap stamps of everything the build reads
 * (matchup rows, imported history, team rows, the leagues' settings; and for the league on screen,
 * its rosters, the injury feed's last run and the projection week). Any of those moving changes
 * the key, and the next read is a miss that rebuilds — nothing has to emit an event and no writer
 * has to remember to invalidate anything.
 *
 * A rebuild is cheap now in the common case: each league's simulation is stored and reused until
 * its own inputs change (`seasonOutlookSims.ts`), so a board rebuilt because ONE league scored
 * re-runs one league.
 *
 * ⚠ THE STAMPS OVER-COVER ON PURPOSE. A fingerprint that covers more than the build reads only
 * causes extra rebuilds; one that covers less serves stale.
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

import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getSeasonOutlook, type SeasonOutlook } from './seasonOutlook'
import { latestProjectionWeek } from './playerProjections'
import { toPlayedLeagues } from './playedLeagues'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { readScreenSummary, registerScreenSummary } from '@/lib/sports-os/summaries'
import { sportsDataCacheTier } from '@/lib/sports-os/durableTier'
import type { Fresh } from '@/lib/sports-os/freshness'

export const SEASON_OUTLOOK_SCREEN = 'season-outlook'

/**
 * Thirty minutes. With the inputs in the key, the TTL no longer decides whether a changed input is
 * seen — the fingerprint does. What it still bounds is anything the stamps do not cover (a team
 * renamed on a row whose timestamp did not move), and how long "last updated" can age.
 */
const TTL_MS = 30 * 60_000

/**
 * An hour, which is much longer than the other two summaries allow, and deliberately.
 *
 * Stale-while-revalidate is worth most exactly where a rebuild is most expensive. A user who opens
 * the outlook eleven minutes after the last build should not wait out a full simulation run to see
 * a board that will differ only in whatever scored since; they get the previous one immediately and
 * the rebuild lands behind them.
 */
const STALE_WHILE_REVALIDATE_MS = 6 * 60 * 60_000

registerScreenSummary<SeasonOutlook | null>({
  screen: SEASON_OUTLOOK_SCREEN,
  /** ⚠ Bump whenever `SeasonOutlook` changes shape — the version is part of the cache key. */
  version: 2,
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
  /** From `seasonOutlookFingerprint`. Null keeps the pre-fingerprint key (TTL-only freshness). */
  fingerprint: string | null = null,
): Promise<Fresh<SeasonOutlook | null> | null> {
  if (!userId) return null
  return readScreenSummary<SeasonOutlook | null>(
    SEASON_OUTLOOK_SCREEN,
    { userId, leagueId: focusLeagueId ?? null, fingerprint },
    { durable: sportsDataCacheTier() },
  )
}

type FingerprintLeague = { id: string; platformLeagueId?: string | null; settings?: unknown }

const stamp = (d: Date | null | undefined) => (d ? d.getTime() : 0)

function safe<T>(p: Promise<T>): Promise<T | 'err'> {
  return p.catch(() => 'err' as const)
}

/**
 * A digest of what the outlook build reads, from a handful of aggregate queries.
 *
 * ⚠ NEVER THROWS, AND A FAILED STAMP IS A DISTINCT VALUE, NOT A ZERO. A read that fails puts
 * `err` in its slot, so the fingerprint cannot collide with a healthy one and serve a board that was
 * built on different inputs. The cost of a failure is a cold build, not a stale board.
 */
export async function seasonOutlookFingerprint(
  leagues: readonly FingerprintLeague[],
  focusLeagueId: string | null,
): Promise<string> {
  const pids = leagues
    .map((l) => l.platformLeagueId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  const ids = leagues.map((l) => l.id)

  const [matchups, facts, teams, rosters, injuries, projection] = await Promise.all([
    safe(
      prisma.weeklyMatchup.aggregate({
        where: { leagueId: { in: pids } },
        _max: { updatedAt: true },
        _count: { _all: true },
      }),
    ),
    safe(
      prisma.matchupFact.aggregate({
        where: { leagueId: { in: ids } },
        _max: { createdAt: true },
        _count: { _all: true },
      }),
    ),
    safe(
      prisma.leagueTeam.aggregate({
        where: { league: { platformLeagueId: { in: pids } } },
        _max: { lastUpdatedAt: true },
        _count: { _all: true },
      }),
    ),
    focusLeagueId
      ? safe(prisma.roster.aggregate({ where: { leagueId: focusLeagueId }, _max: { updatedAt: true }, _count: { _all: true } }))
      : Promise.resolve(null),
    focusLeagueId
      ? safe(
          prisma.providerSyncState.findMany({
            where: { provider: 'injuries-cron', entityType: 'injuries' },
            select: { sport: true, lastSuccessAt: true },
          }),
        )
      : Promise.resolve(null),
    focusLeagueId ? safe(latestProjectionWeek()) : Promise.resolve(null),
  ])

  const parts: string[] = [
    ids.join(','),
    pids.join(','),
    matchups === 'err' ? 'err' : `${stamp(matchups._max.updatedAt)}/${matchups._count._all}`,
    facts === 'err' ? 'err' : `${stamp(facts._max.createdAt)}/${facts._count._all}`,
    teams === 'err' ? 'err' : `${stamp(teams._max.lastUpdatedAt)}/${teams._count._all}`,
  ]
  const settings = createHash('sha1')
  for (const l of leagues) settings.update(`${l.id}:${JSON.stringify(l.settings ?? null)}|`)
  parts.push(settings.digest('hex'))

  if (focusLeagueId) {
    parts.push(`f=${focusLeagueId}`)
    parts.push(rosters === 'err' || rosters == null ? 'err' : `${stamp(rosters._max.updatedAt)}/${rosters._count._all}`)
    parts.push(
      injuries === 'err' || injuries == null
        ? 'err'
        : String(
            Math.max(
              0,
              ...injuries.filter((r) => String(r.sport).toUpperCase() === 'NFL').map((r) => stamp(r.lastSuccessAt)),
            ),
          ),
    )
    parts.push(projection === 'err' ? 'err' : projection ? `${projection.season}-${projection.week}` : 'none')
  }

  return createHash('sha1').update(parts.join('#')).digest('hex').slice(0, 16)
}
