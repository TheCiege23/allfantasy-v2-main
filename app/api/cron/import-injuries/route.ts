/**
 * GET/POST /api/cron/import-injuries
 *
 * Vercel Cron schedule: every 15 minutes (see vercel.json).
 * Syncs NFL/NCAAF injury reports from API-Sports into the sportsInjury table.
 * InjuryReportRecord rows are written by the sports-data-importer which reads
 * from this table, so freshness here directly affects AI injury context.
 *
 * Optional query params:
 *   sport   — "NFL" (default) or "NCAAF"
 *   season  — 4-digit year string (defaults to current season)
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { syncRollingInsightsInjuriesToDb } from "@/lib/injuries/rollingInsightsInjuries"
import { syncEspnInjuriesToDb } from "@/lib/injuries/espnInjuries"

/**
 * PROVIDER MIGRATED 2026-08-10: API-Sports -> Rolling Insights.
 *
 * The API-Sports account is on the **Free** plan, which returns for every
 * current-season request:
 *   {"plan":"Free plans do not have access to this season, try from 2022 to 2024."}
 *
 * Not quota (36/100 used that day), not cadence, not code — injuries have been
 * impossible since the 2025 season opened. Production `sportsInjury` was 17.2
 * days stale on this 15-minute cron and `injuryReportRecord` 103 days stale,
 * while `playerUrgency.ts` kept computing "OUT and still starting, N minutes to
 * lock" from those frozen rows. Projections degrading to null is an absence;
 * this was rendering WRONG statuses with full confidence.
 *
 * Rolling Insights serves `injuries/NFL` (32 team blocks, ~311 players) on
 * credentials already paid for. It also removes the old team-fanout: the
 * previous implementation looped 32 teams per run x 96 runs/day = ~3,072
 * requests/day against a 100/day allowance.
 */

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = "force-dynamic"
/*
 * ⚠ RAISED BECAUSE ONE INVOCATION NOW DOES BOTH SPORTS. This ran per sport in
 * two separate crons, each with its own budget; folding them into one
 * sequential run roughly doubles the worst-case wall time, and the old ceiling
 * would have started timing out the second sport — which fails silently as a
 * partial sync rather than an obvious error. Vercel's ceiling is 300s.
 */
export const maxDuration = 240

type Sport = "NFL" | "NCAAF"

/**
 * ⚠ OMITTING `sport` RUNS EVERY SPORT. This route used to default to NFL, so
 * covering college took a SECOND vercel.json cron entry pointing at this same
 * path with `?sport=NCAAF` on the identical fifteen-minute schedule — two Vercel cron
 * slots for one job. The route iterates the sports itself now and is declared
 * once. An explicit `?sport=` still runs exactly that one and returns the
 * original single-sport response, because admin and manual callers pass it.
 */
const ALL_SPORTS: Sport[] = ["NFL", "NCAAF"]

function resolveSport(param: string | null): Sport {
  if (param?.toUpperCase() === "NCAAF") return "NCAAF"
  return "NFL"
}

function resolveSports(param: string | null): Sport[] {
  return param ? [resolveSport(param)] : ALL_SPORTS
}

async function runOneSport(url: URL, sport: Sport) {
  const season = url.searchParams.get("season") ?? undefined

  const startedAt = Date.now()

  try {
    // Rolling Insights is NFL-only: injuries/NCAAF answers 304-empty, which is
    // why college sat at ONE injury row. ESPN publishes both codes and needs no
    // key, so it runs for NFL as corroboration and for NCAAF as the only source.
    // The upsert key includes the source, so the two feeds coexist and
    // injuryReadPort picks the freshest row per player.
    const [result, espn] = await Promise.all([
      sport === 'NFL'
        ? syncRollingInsightsInjuriesToDb({ sport })
        : Promise.resolve({ fetched: 0, written: 0, unparseableStatus: 0, legacyExpired: 0, errors: [] as string[] }),
      syncEspnInjuriesToDb({ sport }).catch((e) => ({
        sport,
        fetched: 0,
        written: 0,
        skippedNoPlayer: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      })),
    ])

    /**
     * Zero rows written is a FAILURE, not a quiet success. The previous handler
     * returned `ok: true` unconditionally, which is how a 15-minute cron went
     * 17 days without writing anything and nobody was told. Same treatment as
     * import-projections: non-2xx too, because Vercel's cron dashboard keys off
     * the HTTP status and a 200 carrying `ok:false` still reads as healthy.
     */
    // Either feed landing rows counts as success. For NCAAF, ESPN is the only
    // one that can, and reporting failure because RI wrote nothing would be
    // reporting a fact about the wrong provider.
    const failed = result.written === 0 && espn.written === 0
    return {
      body: {
        ok: !failed,
        sport,
        season: season ?? "current",
        source: sport === 'NFL' ? "rolling_insights+espn" : "espn",
        synced: result.written + espn.written,
        fetched: result.fetched + espn.fetched,
        espn: { fetched: espn.fetched, written: espn.written, errors: espn.errors.slice(0, 3) },
        /**
         * RI ships no status field — designations are parsed from prose. This
         * counter is the parser-coverage signal: a rising number means the feed
         * uses phrasing the parser does not recognise, and those players are
         * carrying a null status (availability unknown) rather than a wrong one.
         * Watch it; do not ignore it.
         */
        unparseableStatus: result.unparseableStatus,
        legacyApiSportsRowsExpired: result.legacyExpired,
        errors: [...result.errors, ...espn.errors].length
          ? [...result.errors, ...espn.errors].slice(0, 10)
          : undefined,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      failed,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[cron/import-injuries] ${sport} failed:`, message)
    return {
      body: { ok: false, sport, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      failed: true,
    }
  }
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const explicit = url.searchParams.get("sport")

  /*
   * Sequential rather than concurrent: both sports read the same ESPN feed and
   * NFL additionally hits Rolling Insights, and this cron already exists to be
   * gentle with those. It also keeps the failure accounting per sport.
   *
   * ⚠ ONE SPORT FAILING MUST NOT SUPPRESS THE OTHER — runOneSport catches its
   * own errors, so a Rolling Insights outage on NFL still lets NCAAF write from
   * ESPN. The two separate crons had that isolation for free.
   */
  const results = []
  for (const sport of resolveSports(explicit)) {
    results.push(await runOneSport(url, sport))
  }

  // Explicit single-sport callers keep the exact response they had before.
  if (explicit) {
    const only = results[0]!
    return NextResponse.json(only.body, { status: only.failed ? 500 : 200 })
  }

  /*
   * Zero rows written stays a FAILURE — that property is why this route reports
   * honestly at all (a 15-minute cron once went 17 days writing nothing while
   * returning ok:true). Per sport, so NCAAF writing nothing is still surfaced
   * even when NFL succeeded.
   */
  const anyFailed = results.some((r) => r.failed)
  return NextResponse.json(
    {
      ok: !anyFailed,
      sports: results.map((r) => r.body),
      timestamp: new Date().toISOString(),
    },
    { status: anyFailed ? 500 : 200 },
  )
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}
