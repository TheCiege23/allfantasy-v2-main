/**
 * GET/POST /api/cron/import-standings
 *
 * Vercel Cron schedule: every 4 hours (see vercel.json).
 * Syncs NFL/NCAAF standings from API-Sports into sportsDataCache.
 * Standings freshness drives the "currentFactsStatus" column in the admin
 * Sport Import Matrix and the Power Rankings / Matchup Prep AI tools.
 *
 * Optional query params:
 *   sport   — "NFL" (default) or "NCAAF"
 *   season  — 4-digit year string (defaults to current season)
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import {
  syncAPISportsStandingsToDb,
  clearAPISportsDiagnostics,
  getAPISportsDiagnostics,
} from "@/lib/api-sports"
import { syncEspnStandingsToDb } from "@/lib/standings/espnStandings"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * Heartbeat identity in `sync_job_runs`. Must stay in step with PROBES in
 * scripts/cron-freshness-check.mjs — renaming it here without renaming it there makes the
 * freshness monitor report CONFIG ("no rows for job_name") forever.
 */
const JOB = "cron-import-standings"

type StandingsSport = "NFL" | "NCAAF" | "MLB" | "NBA" | "NHL" | "NCAAB"

/**
 * Which sports one fire covers.
 *
 * 🛑 THE DEFAULT SWEEPS TWO SPORTS BECAUSE IT CANNOT HAVE A SECOND CRON SLOT.
 * MLB standings are the seeding source for the MLB postseason bracket — without
 * them a bracket's seed slots can never be filled with real clubs. The obvious
 * wiring would be a second registry entry with `?sport=MLB`, and that is not
 * available: `cron-budget-check` caps the registry at 60 and `origin/main`
 * declares exactly 60. So the scheduled entry — which carries no `sport`
 * parameter and therefore lands here on the default — has to cover both.
 *
 * ⚠ AN EXPLICIT `?sport=` STILL PINS TO ONE, so the NCAAF and backfill paths
 * behave exactly as they did.
 */
function resolveSports(param: string | null): StandingsSport[] {
  const raw = param?.toUpperCase()
  if (raw === "NCAAF") return ["NCAAF"]
  if (raw === "MLB") return ["MLB"]
  if (raw === "NFL") return ["NFL"]
  if (raw === "NBA") return ["NBA"]
  if (raw === "NCAAB") return ["NCAAB"]
  if (raw === "NHL") return ["NHL"]
  /*
   * NCAAF, NBA and NHL joined the default 2026-09-22. NCAAF's writer existed but ran only on an
   * explicit `?sport=NCAAF` that no registry entry passes, so college standings were never
   * written; NBA/NHL had no writer at all. Same one-slot constraint as above. The whole sweep is
   * ~260 upserts (NCAAF 138 entries), well inside maxDuration.
   */
  /*
   * NCAAB joined 2026-09-22 too: it had no writer, and the admin grounding panel listed
   * "Standings" missing for it. 365 teams makes it the largest sport in the sweep; the whole
   * fire is ~630 sequential upserts, ~45s at the ~70ms/row the slowest recent run measured
   * (4.4s for 62 rows), inside maxDuration. Batch the writes before adding another sport.
   */
  return ["NFL", "MLB", "NCAAF", "NBA", "NHL", "NCAAB"]
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sports = resolveSports(url.searchParams.get("sport"))
  /*
   * The first sport keeps the top-level response fields it has always had, so
   * anything reading `sport` / `synced` / `espn` keeps working. Per-sport detail
   * is additive, in `bySport`.
   */
  const sport = sports[0]
  const season = url.searchParams.get("season") ?? undefined

  const startedAt = Date.now()

  const runSync = async () => {
    clearAPISportsDiagnostics()

    /*
     * ⚠ ESPN FIRST. API-Sports CANNOT ANSWER FOR THE CURRENT SEASON AND HAS NOT SINCE APRIL.
     *
     * This job ran every four hours and reported `ok: true` every time while writing nothing.
     * Measured 2026-08-30: every `*:standings:*` row in SportsDataCache was 2025-season, written
     * 2026-04-25, and all of them expired 2026-07-24. The account is on API-Sports' Free plan,
     * which answers every current-season request with "Free plans do not have access to this
     * season, try from 2022 to 2024" — a billing limit that `lib/scores/gameScoreProviders.ts`
     * and `/api/cron/import-injuries` had already hit and migrated away from. Standings was the
     * one feed that never did.
     *
     * ESPN needs no key, publishes both football codes, and was verified live returning season
     * 2026 with 32 NFL team entries. API-Sports is kept as a SECOND attempt rather than deleted:
     * it is the only source here for a historical `?season=` backfill, which is the one request
     * the Free plan can still serve.
     */
    const perSport: Array<{
      sport: StandingsSport
      espn: Awaited<ReturnType<typeof syncEspnStandingsToDb>>
      count: number
      provider: string | null
    }> = []

    for (const current of sports) {
      const espn = await syncEspnStandingsToDb({ sport: current, season })

      let count = espn.written
      let provider: string | null = "espn"
      if (count === 0) {
        /*
         * ⚠ API-SPORTS IS THE FOOTBALL-ONLY FALLBACK. `syncAPISportsStandingsToDb`
         * takes the same sport string, but the account's Free plan cannot answer
         * for a current season at all (see the note above), and baseball was never
         * wired into it. Attempting it for MLB would spend a request to learn
         * nothing, so the fallback stays where it already works.
         */
        const canFallBack = current === "NFL" || current === "NCAAF"
        const apiSports = canFallBack ? await syncAPISportsStandingsToDb({ season, sport: current }) : 0
        if (apiSports > 0) {
          count = apiSports
          provider = "api_sports"
        } else {
          provider = null
        }
      }

      perSport.push({ sport: current, espn, count, provider })
    }

    const primary = perSport[0]
    return {
      perSport,
      espn: primary.espn,
      count: primary.count,
      provider: primary.provider ?? "espn",
      // Zero for ANY requested sport is a failure — see the rule below. Reported
      // as a list so the response names which one, not just that one failed.
      emptySports: perSport.filter((entry) => entry.count === 0).map((entry) => entry.sport),
      totalWritten: perSport.reduce((sum, entry) => sum + entry.count, 0),
      diagnostics: getAPISportsDiagnostics(),
    }
  }

  try {
    /*
     * Heartbeat, and it records on every SCHEDULED fire including the failures — `withSyncJobRun`
     * writes its `running` row before the work and closes it after, so a run that ends in the
     * zero-rows failure below is still visible as a run that happened.
     *
     * ⚠ IT IS A HEARTBEAT AND NOT A TABLE PROBE FOR A REASON WORTH KEEPING. This job writes
     * `SportsDataCache` under `<SPORT>:standings:<season>:<abbrev>` keys — NOT a `standings`
     * table, which has never held a row and is what the old NO_PROBE note pointed at. But
     * SportsDataCache is written by many jobs, so a table probe on it would be satisfied by any
     * of them and report this one healthy while it wrote nothing. That is the same shared-probe
     * false green recorded against ?rosters=1 and the sync-player-images variants.
     */
    const { espn, count, provider, diagnostics, perSport, emptySports, totalWritten } = await withSyncJobRun(
      /*
       * jobScope carries every sport in the fire; `jobName` is untouched because
       * scripts/cron-freshness-check.mjs matches this probe on the job name alone
       * and renaming it would orphan the alarm.
       */
      { jobName: JOB, jobScope: sports.join("+"), sport, trigger: "cron" },
      runSync,
      (r) => ({
        rowsRead: r.perSport.reduce((sum, entry) => sum + entry.espn.fetched, 0),
        rowsWritten: r.totalWritten,
        rowsSkipped: r.perSport.reduce((sum, entry) => sum + entry.espn.skipped, 0),
        // Zero rows is the documented failure below; the telemetry must agree with the response.
        status: r.emptySports.length > 0 ? ("failed" as const) : ("success" as const),
        metadata: {
          sports: r.perSport.map((entry) => ({ sport: entry.sport, written: entry.count, provider: entry.provider })),
        },
      }),
    )

    /*
     * ZERO ROWS IS A FAILURE, and saying so is the point. The previous handler returned
     * `ok: true` unconditionally, which is exactly how four months of silence went unnoticed.
     * Non-2xx too: the cron dashboard keys off HTTP status, so a 200 carrying `ok:false` still
     * reads as healthy.
     */
    const failed = emptySports.length > 0

    return NextResponse.json(
      {
        ok: !failed,
        sport,
        season: season ?? "current",
        synced: count,
        provider: failed ? null : provider,
        espn: { fetched: espn.fetched, written: espn.written, skipped: espn.skipped, errors: espn.errors.slice(0, 3) },
        // Additive: which sports this fire covered, and which (if any) wrote nothing.
        sports,
        totalWritten,
        emptySports,
        bySport: perSport.map((entry) => ({
          sport: entry.sport,
          written: entry.count,
          fetched: entry.espn.fetched,
          skipped: entry.espn.skipped,
          provider: entry.provider,
          errors: entry.espn.errors.slice(0, 3),
        })),
        diagnostics,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: failed ? 500 : 200 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-standings] failed:", message)
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
