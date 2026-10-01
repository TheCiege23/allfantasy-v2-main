import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { NFL_VENUE_COORDS } from '@/lib/openweathermap'
import {
  buildWeatherCoordsCacheKey,
  getWeatherForEvent,
  MLB_VENUE_COORDS,
} from '@/lib/weather/weatherService'
import { resolveVenueForTeam } from '@/lib/weather/venueResolver'
import { resolveCollegeVenue, venueNamesAgree } from '@/lib/weather/collegeVenue'
import { loadCollegeTeamIndex } from '@/lib/sport-teams/collegeTeamIndexStore'
import type { CollegeTeamIndex } from '@/lib/sport-teams/collegeTeamIdentity'
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

/*
 * Tokens that name a KIND of venue rather than a venue. A provider string reduced to nothing but
 * these ("Stadium", "Field") names no place, and must not be allowed to match a table row.
 */
const GENERIC_VENUE_TOKENS = /\b(stadium|field|park|dome|arena|coliseum|bowl|the|at|of)\b/g

/*
 * 🛑 THIS USED TO MATCH IN BOTH DIRECTIONS, AND THE REVERSE DIRECTION PLACED GAMES IN ARIZONA.
 *
 * `name.includes(venue)` let a provider string of just "Stadium" resolve to the FIRST table row
 * whose name contains it — State Farm Stadium — and write a confident forecast for Glendale onto
 * the key My Team reads for whatever game that row was. Nothing reported it: the row counted as
 * refreshed, not unresolved.
 *
 * The forward direction (the provider string CONTAINS the table name, "GEHA Field at Arrowhead
 * Stadium" ⊇ "Arrowhead Stadium") is safe and kept. The reverse is kept only for a provider string
 * that still says something specific once the generic words are stripped: "Arrowhead" and
 * "Mile High" match, "Stadium" and "Field" do not. Both sides are folded through `venueKey`, so
 * punctuation ("Levi's" vs "Levis", "U.S. Bank" vs "US Bank") no longer decides a match.
 */
function specificVenueKey(venue: string): string {
  return venueKey(venue.toLowerCase().replace(GENERIC_VENUE_TOKENS, ' '))
}

function matchVenueName(venue: string, name: string): boolean {
  const v = venueKey(venue)
  const n = venueKey(name)
  if (!v || !n) return false
  if (v === n || v.includes(n)) return true
  const specific = specificVenueKey(venue)
  return specific.length >= 5 && n.includes(specific)
}

function resolveVenueCoords(venue: string | null): { lat: number; lng: number } | null {
  if (!venue?.trim()) return null
  const v = venue.trim()
  for (const name of Object.keys(NFL_VENUE_COORDS)) {
    if (matchVenueName(v, name)) {
      const c = NFL_VENUE_COORDS[name]!
      return { lat: c.lat, lng: c.lon }
    }
  }
  for (const name of Object.keys(MLB_VENUE_COORDS)) {
    if (matchVenueName(v, name)) {
      const c = MLB_VENUE_COORDS[name]!
      return { lat: c.lat, lng: c.lng }
    }
  }
  return null
}

/*
 * 🛑 THE 120-GAME CAP USED TO BE APPLIED BEFORE ANY GAME WAS CHECKED FOR A LOCATION.
 *
 * The query took the first 120 rows by kickoff across NFL, NCAAF, MLB and SOCCER, and only then
 * asked which of them it could place. Few NCAAF and soccer venues are in either coordinate table,
 * so a busy midweek slate can fill the whole window before the next NFL game is reached.
 * Measured 2026-09-29, the Tuesday after MLB's regular season ended: every run from 01:06Z
 * answered `{"refreshed":0,"skipped":0,"deferred":0}` with HTTP 200, meaning every row it read
 * was unplaceable (or it read none), while `WeatherCache` went stale and the freshness alarm fired hourly. The row mix
 * was not measured (no production read); the counters below are there so the next run says it.
 * A run that found nothing to place looked exactly like a run with nothing to do.
 *
 * So the cap now applies to games the cron CAN place, after duplicates are folded (one game is
 * stored once per source, and every copy maps to the same coords/day key). The scan is bounded
 * separately, and hitting that bound is reported rather than silent.
 */
export const WEATHER_REFRESH_MAX_GAMES = 120
export const WEATHER_REFRESH_SCAN_LIMIT = 5_000

/*
 * NFL only, and only when the row carries NO venue. A named venue that does not resolve is
 * usually a neutral or international site, and forecasting the home team's stadium for a London
 * game would write a confident wrong answer. `resolveVenueForTeam` is also what the My Team reader
 * uses, so this lands on the same coords key by construction (see the note in the loop below).
 */
function resolveGameCoords(g: {
  sport: string
  venue: string | null
  homeTeam: string | null
}): { lat: number; lng: number } | null {
  const byVenue = resolveVenueCoords(g.venue)
  if (byVenue) return byVenue
  if (g.sport === 'NFL' && !g.venue?.trim()) {
    const byTeam = resolveVenueForTeam({ sport: 'NFL', teamAbbrev: g.homeTeam })
    if (byTeam.kind === 'coords') return { lat: byTeam.lat, lng: byTeam.lng }
  }
  return null
}

/*
 * 🛑 COLLEGE FOOTBALL IS OFF BY DEFAULT, AND THE OFF STATE STILL MEASURES.
 *
 * Measured 2026-09-29: 544 of the 600 rows this cron scanned were NCAAF, and none could be placed,
 * because no venue table covered college stadiums. Since 2026-09-30 the stadium comes from the CFBD
 * team directory (664 teams, every FBS school) through `resolveCollegeVenue` — the SAME resolver
 * My Team's `getGameWeather` reads NCAAF through, so the prewarmed row lands on the reader's key.
 *
 * ⚠ EVERY NCAAF ROW GOES THROUGH HERE, INCLUDING ONES AT AN NFL STADIUM. They used to be placed by
 * `resolveGameCoords` from the NFL table first — Miami at Hard Rock, Pitt at Acrisure — which both
 * bypassed this flag (paid calls with college prewarming off) and wrote NFL-table coordinates that
 * need not round to the same key as the CFBD ones the reader uses.
 *
 * Every placed game is a paid provider call on nearly every run (a row older than 3h is stale and
 * this runs every 3h), and that spend is the owner's call, not this route's. So unless
 * `WEATHER_REFRESH_NCAAF` is exactly "true", NCAAF rows are only COUNTED: how many would be placed,
 * the calls/day that implies, and samples of the two ways a row fails to place. The response says
 * what enabling would cost before anyone enables it.
 *
 * A NAMED VENUE MUST AGREE WITH THE HOME TEAM'S STADIUM. College football plays neutral-site games
 * (kickoff classics, rivalry games, bowls), and forecasting the home campus for one would write a
 * confident wrong answer onto the key My Team reads. A row with no venue is accepted on the team.
 */
export function ncaafWeatherEnabled(): boolean {
  return process.env.WEATHER_REFRESH_NCAAF === 'true'
}

const RUNS_PER_DAY = 8 // every 3 hours — see cron-schedule.json

function venueKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

type NcaafResolution =
  | { kind: 'placed'; lat: number; lng: number }
  | { kind: 'unknown_team' }
  | { kind: 'venue_mismatch'; stadium: string }

function resolveNcaafCoords(
  g: { venue: string | null; homeTeam: string | null },
  index: CollegeTeamIndex | null,
): NcaafResolution {
  const byTeam = resolveCollegeVenue(g.homeTeam, index)
  if (!byTeam) return { kind: 'unknown_team' }
  const venue = g.venue?.trim()
  if (venue && !venueNamesAgree(venue, byTeam.label)) {
    return { kind: 'venue_mismatch', stadium: byTeam.label }
  }
  return { kind: 'placed', lat: byTeam.lat, lng: byTeam.lng }
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
  let scanned = 0
  let unresolved = 0
  const unresolvedBySport: Record<string, number> = {}
  /*
   * The NFL venue strings that matched nothing, verbatim. The first run of the 2026-09-29 fix
   * reported 22 unresolved NFL rows without saying which, and the table can only be corrected from
   * the names the providers actually send. NFL only: the NCAAF and soccer misses are expected (no
   * coordinate table covers them) and would crowd the dispatcher's 1,500-character log echo.
   */
  const unresolvedNflVenues = new Set<string>()
  const ncaafOn = ncaafWeatherEnabled()
  // One directory read per run; null (never ingested, or a store failure) places no NCAAF row.
  const collegeIndex = await loadCollegeTeamIndex().catch(() => null)
  /** Distinct coords/day keys NCAAF rows place on — refreshed when on, only counted when off. */
  const ncaafKeys = new Set<string>()
  const ncaafUnknownTeams = new Set<string>()
  const ncaafVenueMismatches = new Set<string>()
  let duplicates = 0
  let overCap = 0
  let scanLimitHit = false
  try {
    const rows = await prisma.sportsGame.findMany({
      where: {
        startTime: { gte: now, lte: horizon },
        sport: { in: ['NFL', 'NCAAF', 'MLB', 'SOCCER'] },
      },
      select: { sport: true, externalId: true, venue: true, homeTeam: true, startTime: true },
      take: WEATHER_REFRESH_SCAN_LIMIT,
      orderBy: { startTime: 'asc' },
    })
    scanned = rows.length
    scanLimitHit = rows.length >= WEATHER_REFRESH_SCAN_LIMIT

    const games: Array<{
      sport: string
      externalId: string
      startTime: Date
      coords: { lat: number; lng: number }
      cacheKey: string
    }> = []
    const seenKeys = new Set<string>()
    for (const r of rows) {
      if (!r.startTime) continue
      // NCAAF never takes the NFL/MLB venue tables — see the note above `ncaafWeatherEnabled`.
      let coords = r.sport === 'NCAAF' ? null : resolveGameCoords(r)
      if (r.sport === 'NCAAF') {
        const res = resolveNcaafCoords(r, collegeIndex)
        if (res.kind === 'placed') {
          ncaafKeys.add(buildWeatherCoordsCacheKey(res.lat, res.lng, r.startTime))
          if (ncaafOn) coords = { lat: res.lat, lng: res.lng }
        } else if (res.kind === 'unknown_team') {
          ncaafUnknownTeams.add(String(r.homeTeam ?? '(none)'))
        } else {
          ncaafVenueMismatches.add(`${r.homeTeam} @ ${r.venue?.trim()} (home: ${res.stadium})`)
        }
      }
      if (!coords) {
        unresolved += 1
        unresolvedBySport[r.sport] = (unresolvedBySport[r.sport] ?? 0) + 1
        if (r.sport === 'NFL') unresolvedNflVenues.add(r.venue?.trim() || `(no venue; home ${r.homeTeam})`)
        continue
      }
      const cacheKey = buildWeatherCoordsCacheKey(coords.lat, coords.lng, r.startTime)
      if (seenKeys.has(cacheKey)) {
        duplicates += 1
        continue
      }
      seenKeys.add(cacheKey)
      if (games.length >= WEATHER_REFRESH_MAX_GAMES) {
        overCap += 1
        continue
      }
      games.push({ sport: r.sport, externalId: r.externalId, startTime: r.startTime, coords, cacheKey })
    }

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
      const { coords, cacheKey } = g

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
      { ok: false, error: String(e), refreshed, skipped, deferred, scanned, unresolved },
      { status: 500 },
    )
  }

  const nflVenueMisses = [...unresolvedNflVenues].slice(0, 12)
  /*
   * Ahead of the NFL venue list in the response on purpose: the dispatcher echoes only the first
   * 1,500 characters of the body into the Actions log, and this block is the measurement the owner
   * needs before `WEATHER_REFRESH_NCAAF` is turned on. `estCallsPerDay` is an upper bound: it
   * assumes every placeable game is refetched on every run, which is what a 3h staleness window
   * on a 3h schedule does in steady state.
   */
  const ncaaf = {
    enabled: ncaafOn,
    placeable: ncaafKeys.size,
    estCallsPerDay: ncaafKeys.size * RUNS_PER_DAY,
    unknownTeam: ncaafUnknownTeams.size,
    venueMismatch: ncaafVenueMismatches.size,
    unknownTeamSamples: [...ncaafUnknownTeams].slice(0, 6),
    venueMismatchSamples: [...ncaafVenueMismatches].slice(0, 4),
  }
  console.info(
    `[weather/refresh-cron] refreshed ${refreshed} cache entries ` +
      `(scanned ${scanned}, unresolved ${unresolved}, duplicates ${duplicates}, overCap ${overCap})` +
      (nflVenueMisses.length ? ` unresolved NFL venues: ${nflVenueMisses.join(' | ')}` : '') +
      ` ncaaf: ${JSON.stringify(ncaaf)}`,
  )
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
    ncaaf,
    // How the window was spent before any refresh: rows read, rows with no location, copies of a
    // game already queued, and placeable games past the cap. `refreshed: 0` with a large
    // `unresolved` is the 2026-09-29 failure; with `scanned: 0` it is an empty schedule.
    scanned,
    unresolved,
    unresolvedBySport,
    unresolvedNflVenues: nflVenueMisses,
    duplicates,
    overCap,
    scanLimitHit,
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
