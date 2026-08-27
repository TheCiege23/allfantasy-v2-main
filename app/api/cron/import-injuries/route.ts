/**
 * GET/POST /api/cron/import-injuries
 *
 * Vercel Cron schedule: every 15 minutes (see vercel.json).
 * Syncs injury reports for EVERY supported sport into the sportsInjury table.
 * InjuryReportRecord rows are written by the sports-data-importer which reads
 * from this table, so freshness here directly affects AI injury context.
 *
 * Optional query params:
 *   sport   — one supported sport code; omitted runs all of them
 *   season  — 4-digit year string (defaults to current season)
 *
 * ⚠ WHY THIS GREW FROM TWO SPORTS TO SEVEN (2026-08-27). Measured on production the same day,
 * `sports_injuries` last moved for MLB, NBA, NHL and SOCCER on 2026-05-01 and for NCAAB on
 * 2026-04-26 — nearly four months stale — because this route only ever iterated NFL and NCAAF.
 * Everything downstream that reads an injury designation (playerUrgency, the projection engine's
 * availability input, Decision OS context) was therefore reading spring rows for five sports
 * while reporting itself healthy.
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { createRunBudget, rotateForFairness } from "@/lib/cron/runBudget"
import { syncRollingInsightsInjuriesToDb } from "@/lib/injuries/rollingInsightsInjuries"
import { espnHasInjuryFeed, syncEspnInjuriesToDb } from "@/lib/injuries/espnInjuries"
import { riSupports } from "@/lib/sports-data/rollingInsightsSupport"
import { SUPPORTED_SPORTS } from "@/lib/sport-scope"

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

type Sport = string

/**
 * ⚠ OMITTING `sport` RUNS EVERY SPORT. This route used to default to NFL, so
 * covering college took a SECOND vercel.json cron entry pointing at this same
 * path with `?sport=NCAAF` on the identical fifteen-minute schedule — two Vercel cron
 * slots for one job. The route iterates the sports itself now and is declared
 * once. An explicit `?sport=` still runs exactly that one and returns the
 * original single-sport response, because admin and manual callers pass it.
 */
const ALL_SPORTS: Sport[] = SUPPORTED_SPORTS.map((s) => String(s))

function resolveSport(param: string | null): Sport {
  const upper = param?.trim().toUpperCase() ?? ""
  return ALL_SPORTS.includes(upper) ? upper : "NFL"
}

function resolveSports(param: string | null): Sport[] {
  if (param) return [resolveSport(param)]
  /*
   * Rotated, not fixed-order. Seven sports against a 240s budget checked BETWEEN sports means a
   * fixed order would refresh NFL every quarter-hour and never reach the tail — the failure mode
   * `rotateForFairness` exists to prevent. NFL still leads most periods by volume of consumers,
   * but no sport can be starved indefinitely.
   */
  return rotateForFairness(ALL_SPORTS)
}

/**
 * Which providers can answer for this sport at all.
 *
 * A sport with NO source is not a failing sport. SOCCER has neither — Rolling Insights documents
 * no injuries endpoint for it and ESPN scopes soccer per competition with no all-competition
 * injuries path — so it reports `providerCoverage: "none"` and stays green. Reporting it red
 * every fifteen minutes forever is how an operator learns to ignore the whole job.
 */
function sourcesFor(sport: Sport): { rollingInsights: boolean; espn: boolean } {
  return { rollingInsights: riSupports("injuries", sport), espn: espnHasInjuryFeed(sport) }
}

async function runOneSport(url: URL, sport: Sport) {
  const season = url.searchParams.get("season") ?? undefined

  const startedAt = Date.now()

  const sources = sourcesFor(sport)

  try {
    /*
     * Two feeds, each run only where the provider actually documents the sport.
     *
     * Rolling Insights covers NFL, NBA, MLB and NHL (support_matrix.injuries) and nothing else —
     * `injuries/NCAAF` answers 304-empty, which is why college once sat at ONE injury row. ESPN
     * publishes both football codes plus NBA, NCAAB, MLB and NHL, needs no key, and so acts as
     * corroboration where RI also answers and as the only source where it does not.
     *
     * The upsert key includes the source, so the two feeds coexist and injuryReadPort picks the
     * freshest row per player rather than one overwriting the other.
     */
    const [result, espn] = await Promise.all([
      sources.rollingInsights
        ? syncRollingInsightsInjuriesToDb({ sport })
        : Promise.resolve({
            fetched: 0,
            written: 0,
            unparseableStatus: 0,
            legacyExpired: 0,
            unsupported: true,
            notModified: false,
            errors: [] as string[],
          }),
      sources.espn
        ? syncEspnInjuriesToDb({ sport }).catch((e) => ({
            sport,
            fetched: 0,
            written: 0,
            skippedNoPlayer: 0,
            errors: [e instanceof Error ? e.message : String(e)],
          }))
        : Promise.resolve({ sport, fetched: 0, written: 0, skippedNoPlayer: 0, errors: [] as string[] }),
    ])

    /**
     * Zero rows written is a FAILURE, not a quiet success. The previous handler
     * returned `ok: true` unconditionally, which is how a 15-minute cron went
     * 17 days without writing anything and nobody was told. Same treatment as
     * import-projections: non-2xx too, because Vercel's cron dashboard keys off
     * the HTTP status and a 200 carrying `ok:false` still reads as healthy.
     */
    /*
     * Either feed landing rows counts as success. For NCAAF, ESPN is the only one that can, and
     * reporting failure because RI wrote nothing would be reporting a fact about the wrong
     * provider.
     *
     * TWO OUTCOMES ARE EXPLICITLY NOT FAILURES:
     *   - no provider covers the sport at all (SOCCER) — nothing to write, nothing broken;
     *   - Rolling Insights answered 304 through a cache-busted retry and ESPN did not cover the
     *     sport. Per the unresolved `304_conflict` that means UNCHANGED-or-empty and the contract
     *     refuses to say which, so the existing rows stand. Calling that a failure would be
     *     asserting the reading the contract declines to make.
     */
    const noCoverage = !sources.rollingInsights && !sources.espn
    const unchangedOnly = result.notModified && !sources.espn

    /*
     * A PROVIDER THAT ANSWERS 200 WITH ZERO ROWS IS NOT A FAILING PROVIDER.
     *
     * Measured 2026-08-27: ESPN returns HTTP 200 and `injuries: []` for college basketball,
     * because the season starts in November and nobody is hurt yet. Treating that as a failure
     * meant this route 500'd for NCAAB and would keep doing so for three months — the exact
     * "red light that can never go green" this file already refuses to ship elsewhere.
     *
     * ⚠ THIS MUST NOT WEAKEN THE GUARD THAT CAUGHT THE 17-DAY OUTAGE. That outage was API-Sports
     * returning a plan-restriction PAYLOAD, which lands in `errors` — so the discriminator is
     * whether a provider ERRORED, not whether rows arrived. Errors still fail. Rows fetched but
     * none written still fails, because that is a write bug. Only a clean, silent, error-free zero
     * from every configured provider is allowed through, and it is reported explicitly rather than
     * blending into a green.
     */
    const providerErrored = result.errors.length > 0 || espn.errors.length > 0
    const cleanEmpty =
      !providerErrored && result.fetched === 0 && espn.fetched === 0 && !result.notModified

    const failed =
      !noCoverage && !unchangedOnly && !cleanEmpty && result.written === 0 && espn.written === 0

    const providerLabel = noCoverage
      ? "none"
      : [sources.rollingInsights ? "rolling_insights" : null, sources.espn ? "espn" : null]
          .filter(Boolean)
          .join("+")

    return {
      body: {
        ok: !failed,
        sport,
        season: season ?? "current",
        source: providerLabel,
        providerCoverage: noCoverage ? "none" : "partial_or_full",
        /** Every configured provider answered 200 with zero rows and no error — an out-of-season
         *  feed, not an outage. Surfaced so it is legible rather than an unexplained green. */
        providerReturnedEmpty: cleanEmpty || undefined,
        /** RI answered 304 through the retry: unchanged-or-empty, existing rows untouched. */
        rollingInsightsNotModified: result.notModified || undefined,
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
  /*
   * ⚠ SEVEN SPORTS NEED A BUDGET; TWO DID NOT. The loop is sequential and each sport makes up to
   * two provider calls, so the worst case scales with the sport count against a fixed platform
   * ceiling. `createRunBudget` stops BETWEEN sports and names what it did not reach, so a slow
   * provider costs the tail this run and the rotation gives it the lead next run — instead of a
   * 502 at 300s that writes nothing and records no telemetry at all.
   */
  const budget = createRunBudget(200_000)
  const results = []
  const deferred: string[] = []
  for (const sport of resolveSports(explicit)) {
    if (!explicit && budget.exhausted()) {
      deferred.push(sport)
      continue
    }
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
      /** Named, not silent: a sport the budget cut is a fact the operator needs, and the
       *  rotation means it leads the next period rather than never running. */
      deferredForBudget: deferred.length ? deferred : undefined,
      budgetMsRemaining: budget.remainingMs(),
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
