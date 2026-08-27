/**
 * GET/POST /api/cron/import-schedules
 *
 * Vercel Cron schedule: weekly on Monday at 03:00 UTC (see vercel.json).
 * Runs a full schedule sync for NFL (and optionally NCAAF) using Rolling
 * Insights (primary) then API-Sports (supplement).  Stores games into the
 * sportsGame table and gameSchedule table where applicable.
 *
 * Optional query params:
 *   sport   — "NFL" (default) or "NCAAF"
 *   season  — 4-digit year string (defaults to current season)
 *   source  — "rolling_insights" | "api_sports" | "all" (default: "all")
 *   rosters — "1" runs ONLY the TheSportsDB roster sweep and skips every other
 *             block. See the roster section below for why it is its own mode.
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { createRunBudget, rotateForFairness } from "@/lib/cron/runBudget"
import { syncNFLScheduleToDb } from "@/lib/rolling-insights"
import {
  syncAPISportsGamesToDb,
  clearAPISportsDiagnostics,
  getAPISportsDiagnostics,
} from "@/lib/api-sports"
import {
  LEAGUES,
  ingestRosters,
  ingestSchedule,
  ingestTeams,
  type IngestSport,
} from "@/lib/sports-data/theSportsDbIngest"

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = "force-dynamic"

export const maxDuration = 300

/** Every league the TheSportsDB ingest covers. */
const TSDB_SPORTS: IngestSport[] = ['NFL', 'NCAAF', 'MLB', 'NBA', 'NHL', 'NCAAB', 'SOCCER']

/**
 * Leagues whose teams come back from ONE `search_all_teams` call.
 *
 * NCAAF is deliberately absent: it cannot be listed by name at all, so its 231
 * teams need 231 individual lookups — about four minutes, which alone would eat
 * this route's 300s budget.
 */
const TSDB_FAST_TEAM_SPORTS: IngestSport[] = ['NFL', 'MLB', 'NBA', 'NHL', 'NCAAB', 'SOCCER']

/**
 * Teams whose rosters one fire will sweep, per league.
 *
 * The four leagues with real rosters carry 30-32 teams each, so 40 finishes a
 * league outright in the normal case and the cap only bites if the provider slows
 * down. `ingestRosters` orders stale-first, so whatever a bounded run does not
 * reach leads the next one.
 */
const ROSTER_TEAMS_PER_RUN = 40

function resolveSport(param: string | null): "NFL" | "NCAAF" {
  if (param?.toUpperCase() === "NCAAF") return "NCAAF"
  return "NFL"
}

/**
 * `?sport=all` runs BOTH sports in one fire, which is what lets a single weekly cron entry
 * replace the two that used to exist (`import-schedules` for NFL and `import-schedules?sport=NCAAF`
 * an hour later). Anything else keeps the previous single-sport behaviour exactly.
 *
 * Order matters: NFL first, so if the 300s budget runs out it is the college sweep that is cut
 * short — the same priority the two separate entries expressed by running NFL an hour earlier.
 */
function resolveSports(param: string | null): Array<"NFL" | "NCAAF"> {
  if (param?.toLowerCase() === "all") return ["NFL", "NCAAF"]
  return [resolveSport(param)]
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sports = resolveSports(url.searchParams.get("sport"))
  const sport = sports[0]
  const season = url.searchParams.get("season") ?? undefined
  const source = (url.searchParams.get("source") ?? "all").toLowerCase()
  const rostersOnly = url.searchParams.get("rosters") === "1"

  const startedAt = Date.now()
  const budget = createRunBudget()
  const results: Record<string, unknown> = {}
  const diagnostics: Record<string, unknown> = {}

  try {
    if (!rostersOnly && (source === "all" || source === "rolling_insights") && sports.includes("NFL")) {
      try {
        const riCount = await syncNFLScheduleToDb({ season })
        results.rolling_insights = { synced: riCount, sport: "NFL" }
      } catch (err) {
        results.rolling_insights = { error: String(err).slice(0, 120), sport: "NFL" }
      }
    }

    if (!rostersOnly && (source === "all" || source === "api_sports")) {
      // Per-sport isolation: a provider failure on one sport must not abandon the other, which is
      // a behaviour the two separate cron entries got for free by being separate fires.
      for (const s of sports) {
        clearAPISportsDiagnostics()
        try {
          const asCount = await syncAPISportsGamesToDb({ season, sport: s })
          results[`api_sports_${s}`] = { synced: asCount, sport: s }
        } catch (err) {
          results[`api_sports_${s}`] = { error: String(err).slice(0, 120), sport: s }
        }
        diagnostics[`api_sports_${s}`] = getAPISportsDiagnostics()
      }
    }

    /*
     * TheSportsDB slice.
     *
     * Folded into this existing cron rather than given its own route — the repo
     * sits at Vercel's hard 2048-route ceiling, and a schedule sync already has a
     * home here.
     *
     * ⚠ BOUNDED ON PURPOSE. maxDuration is 300s and a full sweep takes about ten
     * minutes, most of it NCAAF, whose 231 teams have to be looked up one at a
     * time because the provider cannot list them by name. So this runs SCHEDULES
     * only — seven calls, roughly thirty seconds — and teams only for the leagues
     * that list in one request. NCAAF teams stay with the manual script until
     * they have a job that can take the time.
     *
     * `?tsdb=0` opts out; anything else runs it.
     *
     * CADENCE. The weekly Monday entries above run the Rolling Insights and
     * API-Sports sync and pick this up alongside them. A separate vercel.json
     * entry runs `?source=tsdb-only` every six hours: "tsdb-only" matches neither
     * "all" nor "rolling_insights" nor "api_sports", so both of those blocks skip
     * and only this one executes. Six hours is what freshnessPolicy sets for
     * current_schedule — kickoff times flex and lineup locks are computed from
     * them, so weekly would be far too stale.
     */
    /*
     * ⚠ THE COMMENT ABOVE SAYS "roughly thirty seconds". IT IS NOT. Measured 2026-08-23, this
     * route returned HTTP 502 at ~300,200ms on the `?source=tsdb-only` schedule — the platform
     * edge severs the connection at 300s and answers 502 itself, so neither maxDuration nor a
     * client timeout buys more room. Seven schedule calls plus six team sweeps grew past the
     * estimate and nobody re-measured.
     *
     * Budget checked BETWEEN sports, and the list rotated: with a fixed order, whichever sport
     * falls past the cut would be skipped on EVERY run rather than just this one. Rotation by the
     * six-hour cadence, not the default day, because this fires four times daily and a daily
     * rotation would give the same sport the lead on all four.
     */
    if (!rostersOnly && url.searchParams.get('tsdb') !== '0') {
      const tsdb: Record<string, unknown> = {}
      const deferred: string[] = []
      for (const s of rotateForFairness(TSDB_SPORTS, 6 * 60 * 60 * 1000)) {
        if (budget.exhausted()) {
          deferred.push(s)
          continue
        }
        try {
          /*
           * Hand the sport whatever wall-clock is left, minus headroom for the teams call below and
           * for serialising the response. Without this the sport runs unbounded and a single large
           * population (MLB 2,303 events, NCAAF 866) walks the handler into the 300s edge 502.
           */
          const sportBudgetMs = Math.max(0, budget.remainingMs() - 20_000)
          const sched = await ingestSchedule(s, { budgetMs: sportBudgetMs })
          const entry: Record<string, unknown> = { season: sched.season, games: sched.written }
          // A partial sweep is progress, not failure — but it has to SAY so, or a sport that never
          // finishes looks identical to one that had nothing to write.
          if (sched.deferred > 0) entry.deferredEvents = sched.deferred
          // Only the leagues whose teams come back in a single call. NCAAF is
          // excluded by TSDB_FAST_TEAM_SPORTS, not by accident.
          //
          // Re-checked before the SECOND call: the schedule fetch above may have consumed what
          // was left, and a teams sweep started at 239s is exactly how this route hits the edge.
          if (TSDB_FAST_TEAM_SPORTS.includes(s) && !budget.exhausted()) {
            const teams = await ingestTeams(s, { season: sched.season })
            entry.teams = teams.written
          }
          tsdb[s] = entry
        } catch (err) {
          tsdb[s] = { error: String(err).slice(0, 120) }
        }
      }
      if (deferred.length) tsdb.deferredSports = deferred
      results.thesportsdb = tsdb
    }

    /*
     * TheSportsDB ROSTERS.
     *
     * ⚠ THIS EXISTED AND NOTHING RAN IT. `ingestRosters` had zero scheduled callers:
     * this route imported `ingestSchedule` and `ingestTeams` individually,
     * `import-season-stats` imports only `ingestPlayerStats`, and the only path that
     * reaches rosters is `ingestSport`, called from scripts/ingest-thesportsdb.ts by
     * hand. Measured on production 2026-08-27, SportsPlayer's TheSportsDB rows were
     * last written 2026-08-16 — eleven days, exactly the gap since someone last ran
     * the script. Schedules, teams and season stats were all same-day fresh.
     *
     * ITS OWN MODE, NOT AN EXTRA STEP IN THE BLOCK ABOVE. That block already returned
     * HTTP 502 at ~300,200ms once (see the warning above it); rosters are one call per
     * TEAM, so folding them in would push the same fire further past the edge. `?rosters=1`
     * gets the whole 240s budget to itself on its own schedule.
     *
     * NOT A NEW ROUTE, deliberately — the repo sits at Vercel's 2048-route ceiling and a
     * TheSportsDB ingest already has a home here.
     *
     * ONLY THE LEAGUES THAT HAVE ROSTERS. NCAAF and NCAAB are `hasPlayers: false`: the
     * provider returns head coaches and the odd alumnus filed under his alma mater, not a
     * current roster. Sweeping them would spend the budget to write nothing. Devy stays
     * with CFBD.
     */
    if (rostersOnly) {
      const rosters: Record<string, unknown> = {}
      const deferred: string[] = []
      const rosterSports = TSDB_SPORTS.filter((s) => LEAGUES[s].hasPlayers)

      // Rotated on the cron's own daily period, so a league that falls past the cut is not
      // the same league every single run — the starvation this repo already hit once.
      for (const s of rotateForFairness(rosterSports, 24 * 60 * 60 * 1000)) {
        if (budget.exhausted()) {
          deferred.push(s)
          continue
        }
        try {
          const r = await ingestRosters(s, {
            maxTeams: ROSTER_TEAMS_PER_RUN,
            // Headroom for serialising the response, same shape as the schedule block.
            budgetMs: Math.max(0, budget.remainingMs() - 15_000),
          })
          const entry: Record<string, unknown> = { teams: r.teams, players: r.players }
          if (r.skippedNoPlayers > 0) entry.skippedNoPlayers = r.skippedNoPlayers
          if (r.coachesDropped > 0) entry.coachesDropped = r.coachesDropped
          if (r.deferredTeams > 0) entry.deferredTeams = r.deferredTeams
          rosters[s] = entry
        } catch (err) {
          rosters[s] = { error: String(err).slice(0, 120) }
        }
      }
      if (deferred.length) rosters.deferredSports = deferred
      results.thesportsdb_rosters = rosters
    }

    const totalSynced = Object.values(results)
      .map((r) => (typeof (r as Record<string, unknown>).synced === "number" ? Number((r as Record<string, unknown>).synced) : 0))
      .reduce((a, b) => a + b, 0)

    return NextResponse.json({
      ok: true,
      sport,
      season: season ?? "current",
      source,
      totalSynced,
      results,
      diagnostics,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-schedules] failed:", message)
    return NextResponse.json(
      { ok: false, sport, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}
