import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { NFL_VENUE_COORDS } from '@/lib/openweathermap'
import {
  buildWeatherCoordsCacheKey,
  getWeatherForEvent,
  MLB_VENUE_COORDS,
} from '@/lib/weather/weatherService'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { createRunBudget } from '@/lib/cron/runBudget'

/*
 * ⚠ maxDuration IS INERT ON THE CURRENT HOST, AND THIS ROUTE PROVES IT.
 *
 * It declares 60s. Measured 2026-08-23 at 18:04 UTC it returned HTTP 502 at 300,084ms -- five
 * times its own declared limit. maxDuration is a Vercel primitive and production runs on Railway,
 * which does not enforce it; the only real ceiling is the platform edge severing at 300s.
 *
 * So the declaration below is a statement of INTENT, not a control. The wall-clock budget is the
 * control.
 */
export const maxDuration = 60

/*
 * Deliberately BELOW the declared maxDuration, so one number is correct on both hosts:
 *   - Railway today: cuts at 45s, far under the 300s edge that 502d this route.
 *   - Vercel if production moves back: cuts at 45s, under the 60s maxDuration that WOULD then be
 *     enforced -- where a 240s budget would never engage and the route would 504 at 60s instead.
 *
 * A budget above maxDuration is a budget that only works on the host you happened to test.
 */
export const WEATHER_REFRESH_BUDGET_MS = 45_000
export const dynamic = 'force-dynamic'

function resolveVenueCoords(venue: string | null): { lat: number; lng: number } | null {
  if (!venue?.trim()) return null
  const v = venue.trim()
  for (const name of Object.keys(NFL_VENUE_COORDS)) {
    if (v.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(v.toLowerCase())) {
      const c = NFL_VENUE_COORDS[name]!
      return { lat: c.lat, lng: c.lon }
    }
  }
  for (const name of Object.keys(MLB_VENUE_COORDS)) {
    if (v.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(v.toLowerCase())) {
      const c = MLB_VENUE_COORDS[name]!
      return { lat: c.lat, lng: c.lng }
    }
  }
  return null
}

// This branch added its own cron GET here; #284 landed an identical one further down
// (kept), so both would have exported `GET` from the same module. Git auto-merged this
// without a conflict because the two sit in different places — the duplicate export only
// shows up at build time. Dropped this copy; main's is the shipped version and avoids the
// build bug by not writing the literal `0 */3 * * *`, whose `*/` closes a block comment.

export async function POST(request: NextRequest) {
  if (!requireCronAuth(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  let refreshed = 0
  /*
   * Counted and reported so the fix is verifiable from the cron's own response
   * rather than from a provider bill. Before this change it was structurally
   * always zero.
   */
  let skipped = 0
  // Hoisted beside `refreshed` deliberately: the catch below reports both, and a counter
  // declared inside the try is out of scope exactly where the failure path needs it.
  const budget = createRunBudget(WEATHER_REFRESH_BUDGET_MS)
  let deferred = 0
  try {
    const games = await prisma.sportsGame.findMany({
      where: {
        startTime: { gte: now, lte: horizon },
        sport: { in: ['NFL', 'NCAAF', 'MLB', 'SOCCER'] },
      },
      take: 120,
      orderBy: { startTime: 'asc' },
    })


    for (const g of games) {
      /*
       * Checked BETWEEN games. The existing `startTime: asc` ordering is already the right
       * priority, so this is not starvation: what gets dropped is the FURTHEST-OUT fixture, whose
       * forecast matters least and which this cron will reach on a later fire as it approaches.
       * Games inside 48h are force-refreshed and sort first, so they are never the ones cut.
       */
      if (budget.exhausted()) {
        deferred += 1
        continue
      }
      const coords = resolveVenueCoords(g.venue)
      if (!coords || !g.startTime) continue

      const hoursUntil = (g.startTime.getTime() - now.getTime()) / (1000 * 60 * 60)

      /*
       * ⚠ THIS GATE WAS DEAD CODE AND EVERY GAME WAS REFETCHED EVERY RUN.
       *
       * The key was built as `${lat}_${lng}_${hourBucket}` — underscores,
       * hour-bucketed. Every writer in weatherService uses a colon-prefixed
       * form, and because this cron always supplies an eventId the row is
       * always written as `weather:game:{sport}:{eventId}`. The two formats
       * have never matched, so `findUnique` could not hit: `row` was always
       * null, `stale` was therefore always true, and `if (!force) continue`
       * was unreachable.
       *
       * The second half was worse. `forceRefresh: true` was passed
       * unconditionally, and that flag bypasses the cache check INSIDE the
       * service too — so even a row written eight minutes earlier triggered a
       * live provider call. Up to 120 games, every three hours, all paid for
       * and all discarded.
       *
       * Now: the key is built by the same function that writes it, and the
       * refresh is forced only when it is actually warranted — inside 48 hours
       * of kickoff, or when the stored row has genuinely gone stale.
       *
       * 🛑 AND THAT FIX MADE THE CRON SELF-CONSISTENT WHILE LEAVING IT UNREADABLE.
       *
       * Aligning the gate with the write was right, and it is exactly why this
       * stayed hidden: the cron now reports accurate cache hits on rows NO
       * CONSUMER CAN FIND. `weather:game:{sport}:{externalId}` is written here
       * and read by nothing —
       *
       *   `getGameWeather` (lib/core-app/gameWeather.ts, the My Team surface)
       *      reads `weather:coords:{lat}:{lng}:{utcDay}`
       *   `getCachedGameWeather` (chat enrichment, ai/deterministic, /api/sports/weather)
       *      reads `weather:game:{sport}:{gameId ?? TEAM}` — and NO caller passes
       *      a gameId, so it looks up `weather:game:nfl:KC`
       *
       * Three key spaces, one writer, zero overlap.
       *
       * ⚠ ONLY ONE OF THEM ACTUALLY BREAKS, WHICH IS WHY THIS WRITES THE COORDS
       * KEY AND NOT THE OTHER. `getCachedGameWeather` falls through to
       * `getCachedWeatherByCoords`, which fetches live and writes on a miss — so
       * its callers were paying for calls this cron could have saved, a cost
       * problem, not a correctness one. `getGameWeather` does a bare `findMany`
       * and returns NOTHING on a miss, so My Team has been showing no weather at
       * all while this cron ran every three hours.
       *
       * The coordinates match by construction for NFL: this route resolves them
       * out of `NFL_VENUE_COORDS`, and `resolveVenueForTeam` reaches the same
       * table row via `NFL_TEAM_VENUES[abbrev]`. Same row, same `toFixed(2)`,
       * same UTC day bucket, same key.
       *
       * ⚠ MLB IS NOT COVERED BY THAT ARGUMENT and is deliberately not claimed:
       * this route reads `MLB_VENUE_COORDS` while `resolveVenueForTeam` reads
       * `MLB_TEAM_BALLPARK`. Two tables, so the keys agree only if the
       * coordinates happen to. Prewarming MLB needs those reconciled first.
       */
      const cacheKey = buildWeatherCoordsCacheKey(coords.lat, coords.lng, g.startTime)
      const row = await prisma.weatherCache
        .findUnique({ where: { cacheKey } })
        .catch(() => null)

      const stale =
        !row ||
        row.expiresAt <= now ||
        now.getTime() - row.fetchedAt.getTime() > 3 * 60 * 60 * 1000

      // Near kickoff the forecast moves, so it is worth paying for. Further out
      // a fresh row is a fresh row.
      const nearKickoff = hoursUntil < 48
      if (!stale && !nearKickoff) {
        skipped += 1
        continue
      }

      await getWeatherForEvent({
        lat: coords.lat,
        lng: coords.lng,
        gameTime: g.startTime,
        sport: g.sport,
        eventId: g.externalId,
        /*
         * ⚠ THE OVERRIDE IS LOAD-BEARING, NOT TIDINESS. Without it
         * `getWeatherForEvent` derives its own key, and because `eventId` and
         * `sport` are both present it picks `buildWeatherGameCacheKey` — the
         * space nothing reads. Passing the key the gate just used is what makes
         * the write land where `getGameWeather` will look for it.
         *
         * `eventId`/`sport` stay for the service's own logging and dome checks.
         */
        cacheKey,
        // Only bypass the service's own cache when we established a reason to.
        forceRefresh: stale,
      })
      refreshed += 1
    }
  } catch (e) {
    console.error('[weather/refresh-cron]', e)
    return NextResponse.json(
      { ok: false, error: String(e), refreshed, skipped, deferred },
      { status: 500 },
    )
  }

  console.info(`[weather/refresh-cron] refreshed ${refreshed} cache entries`)
  // Deferred work is reported, never silently dropped: a run that refreshed 12 of 120 and one
  // that found only 12 to do are the same number otherwise.
  return NextResponse.json({
    ok: true,
    refreshed,
    // A healthy run skips most games most of the time. A run that skips nothing
    // means the gate is broken again.
    skipped,
    deferred,
    budgetExhausted: budget.exhausted(),
  })
}

/**
 * Vercel Cron issues a GET, but this route only exported POST — so every scheduled run since
 * it was added returned 405 and refreshed nothing. Measured in production 2026-07-19.
 * Delegates to POST, which already gates on `requireCronAuth`; no auth behaviour changes.
 */
export async function GET(request: NextRequest) {
  return POST(request)
}
