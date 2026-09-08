/**
 * GET/POST /api/cron/import-news
 *
 * Vercel Cron schedule: every 15 minutes (see vercel.json).
 * Calls runNewsImporter to refresh PlayerNewsRecord rows from provider news
 * feeds (Rolling Insights, ClearSports, ESPN, NewsAPI, API-Sports).
 * PlayerNewsRecord freshness directly feeds FantasyValueSnapshot news context
 * and injury-news aggregation for AI tools.
 *
 * Optional query params:
 *   sport — comma-separated sport codes (e.g. "NFL,NBA") — defaults to all sports
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { createRunBudget, respondBeforeEdge, CRON_HARD_RESPONSE_MS } from "@/lib/cron/runBudget"
import { runNewsImporter } from "@/lib/workers/news-importer"
import { recordSyncJobRun, extractCommonCounts } from "@/lib/production-health/syncJobRunTelemetry"

/**
 * Heartbeat identity for the `?xnews=1` schedule, read by PROBES in
 * scripts/cron-freshness-check.mjs.
 *
 * ⚠ WHY THIS MODE NEEDS ITS OWN NAME. The base schedule and this one are the SAME route writing
 * the SAME `player_news.created_at`, and the base runs every 15 minutes against this one's six
 * hours. A table probe here is therefore satisfied by the base job on every check, so the X pass
 * could stop entirely and the monitor would never notice. Zero new rows is also a legitimate
 * outcome here — X may simply have had nothing in the window — which is the second reason an
 * output probe cannot judge it and a heartbeat can.
 */
const JOB_XNEWS = "cron-import-news-xnews"

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = "force-dynamic"
/**
 * 300 to match the platform's real ceiling, not to buy time.
 *
 * ⚠ THIS WAS 120 AND IT NEVER MEANT ANYTHING. Nothing enforced it — the runs that failed did so
 * at ~300,040ms, which is the edge severing the connection and answering 502 itself, and no value
 * here changes that. `createRunBudget()` and `respondBeforeEdge` below are what actually bound the
 * handler. 300 only stops the declaration contradicting them, and matches `import-players`,
 * `import-schedules` and `import-stat-lines`, which are the same shape of job.
 */
export const maxDuration = 300

async function handle(req: NextRequest) {
  /*
   * ⚠ ONE BUDGET FOR THE WHOLE HANDLER, not one per phase. `lib/cron/runBudget.ts` records why:
   * a budget bolted onto an inner loop leaves the phases free to overrun each other, and the
   * ceiling applies to the request, not to any one phase of it.
   */
  const budget = createRunBudget()
  const url = new URL(req.url)
  const sportParam = url.searchParams.get("sport")

  const sports = sportParam
    ? sportParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : undefined

  // `full` runs the NewsAPI passes on top of ESPN. NewsAPI has a quota, so it must stay at
  // roughly hourly while ESPN stays at */15.
  //
  // This used to need TWO cron entries (a */15 ESPN-only one and a separate hourly `?full=1`).
  // Instead the single */15 cron now decides for itself: the first fire of each hour does the
  // full pass, the other three are ESPN-only. Same two behaviours, same cadences, one schedule.
  //
  // An explicit `?full=` still wins, so manual/admin invocation can force either mode.
  const fullParam = url.searchParams.get('full')
  const full =
    fullParam === null
      ? new Date().getUTCMinutes() < 15
      : ['1', 'true', 'yes'].includes(fullParam.toLowerCase())

  const startedAt = Date.now()

  /*
   * `?xnews=1` — X (xAI x_search) ingestion plus the notification dispatch that turns
   * those rows into something a user actually sees.
   *
   * FOLDED INTO THIS ROUTE rather than given its own, because Vercel has a hard 2048-route
   * ceiling this repo is already at. Same reason `?full=` and `?sport=` live here.
   *
   * ⚠ BOTH HALVES RUN IN ONE INVOCATION ON PURPOSE. Ingesting without dispatching just
   * refreshes rows nobody sees; dispatching without ingesting notifies on stale rows.
   *
   * 🛑 BUT THE DISPATCH HALF IS NOW DEFERRABLE, AND THAT IS NOT A WEAKENING OF THE LINE ABOVE.
   * When that was written this pass was the only dispatcher. The base pass below has since
   * gained the same call on an every-15-minutes schedule, so "rows nobody sees" is no longer
   * what skipping it produces — it produces rows seen up to fifteen minutes later. See the
   * priority note at the call site.
   *
   * 🛑 AND "BOUNDED IN WALL-CLOCK" WAS NEVER TRUE — that claim is why this went unnoticed.
   * Nothing bounded it. A search is not "seconds, not milliseconds" when the model chooses its
   * own retrieval budget, the provider call carried no timeout at all, and the cost of writing
   * results scales with how much news there is. Measured over 40 scheduled runs: a stable
   * ~50s all through the offseason, then 130-280s within a day of the season starting on
   * 2026-09-04, then 502s at the 300s edge ceiling. `createRunBudget()`, the `remainingFor` clamp
   * on each search, and `respondBeforeEdge` at the bottom of this file are what bound it now.
   * `maxDuration` never did.
   *
   * ⚠ SPEND. Each sport costs one xAI x_search call per configured query — roughly 20
   * calls for all seven sports. It defaults to NFL alone so a scheduled run is bounded in
   * cost; widen deliberately via `?sport=`.
   */
  const xnewsParam = url.searchParams.get('xnews')
  if (xnewsParam !== null && ['1', 'true', 'yes'].includes(xnewsParam.toLowerCase())) {
    try {
      const { runXNewsIngestion } = await import('@/lib/workers/x-news-ingestion')
      const { dispatchPendingPlayerNewsNotifications } = await import(
        '@/lib/notifications/PlayerNewsNotificationService'
      )
      /*
       * ⚠ LOWERCASED. `sports` above is upper-cased for runNewsImporter, but
       * SPORT_SEARCH_QUERIES is keyed lower-case and runXNewsIngestion `continue`s past a
       * key it does not recognise — so passing "NFL" would ingest nothing and report a
       * perfectly clean zero.
       */
      const xSports = (sports ?? ['NFL']).map((s) => s.toLowerCase())
      const ingest = await runXNewsIngestion(xSports, budget)

      /*
       * ⚠ INGEST FIRST AND DISPATCH ON THE REMAINDER — the priority is deliberate, and it is a
       * change from what the note above this block used to claim.
       *
       * "Both halves run in one invocation" was written when this pass was the ONLY thing
       * dispatching. It no longer is: the base every-15-minutes pass below calls the same
       * dispatcher with a six-hour lookback and no source filter, so rows written here and left
       * unstamped are picked up within fifteen minutes. Deferring the dispatch costs a short
       * delay; deferring the ingest costs the rows outright, because nothing else writes
       * `x_grok_search`.
       *
       * So when the budget is gone the dispatch is skipped rather than half-run, and the
       * response says so.
       */
      const dispatchResult = budget.exhausted()
        ? { scanned: 0, notified: 0, recipients: 0, noRoster: 0, deferred: null as number | null,
            skipped: 'run budget exhausted before phase start' }
        : await dispatchPendingPlayerNewsNotifications({ budget })

      await recordSyncJobRun(
        { jobName: JOB_XNEWS, jobScope: xSports.join(','), trigger: 'cron' },
        { ...extractCommonCounts(ingest), errors: ingest.errors.map((e) => String(e)) },
        Date.now() - startedAt
      )

      return NextResponse.json(
        {
          ok: ingest.errors.length === 0,
          mode: 'xnews',
          sports: xSports,
          ingest,
          dispatch: dispatchResult,
          /*
           * ⚠ DEFERRAL IS NOT AN ERROR AND MUST NOT READ AS ONE. A truncated run did real work
           * and the next fire continues it; reporting 500 here would make a working job look
           * broken on a schedule, which is how a team learns to ignore the alarm. Surfaced as
           * its own field so a red run and a short run stay distinguishable.
           */
          budget: {
            exhausted: budget.exhausted(),
            elapsedMs: budget.elapsedMs(),
            remainingMs: budget.remainingMs(),
          },
          durationMs: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        },
        // Unlike the ESPN pass, zero new rows is a legitimate outcome here — X may simply
        // have had nothing new in the window. Only a provider error is a failure.
        { status: ingest.errors.length === 0 ? 200 : 500 }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[cron/import-news] xnews failed:', message)
      // A failed fire still heartbeats — see the note on JOB_XNEWS. "Scheduled but throwing" and
      // "not scheduled at all" are different problems and must not read the same.
      await recordSyncJobRun({ jobName: JOB_XNEWS, trigger: 'cron' }, { errors: [message] }, Date.now() - startedAt)
      return NextResponse.json(
        { ok: false, mode: 'xnews', error: message.slice(0, 240), durationMs: Date.now() - startedAt },
        { status: 500 }
      )
    }
  }

  try {
    // Ingest FIRST. runNewsImporter re-reads sports_news, so without a preceding
    // fetch it can only recycle whatever is already there — which is exactly how
    // this job reported ok:true for 107 days while advancing nothing.
    const { syncEspnNewsOnly, syncFullNewsCoverage } = await import('@/app/api/sports/news/sync-helper')
    let fetched: { total: number; breakdown: Record<string, number> } | null = null
    let fetchError: string | null = null
    try {
      fetched = full ? await syncFullNewsCoverage() : await syncEspnNewsOnly()
    } catch (err) {
      // A provider outage must not also block the normalize step from running
      // over rows already present, but it must be visible in the response.
      fetchError = err instanceof Error ? err.message : String(err)
      console.error('[cron/import-news] source sync failed:', fetchError)
    }

    const result = await runNewsImporter({ sports })

    /*
     * DISPATCH ON EVERY RUN, not just the xnews pass. This route is where ESPN, NewsAPI
     * and ClearSports land — ~3,400 player_news rows a week against X's zero — so gating
     * notifications on `?xnews=1` would have left almost all real news silent. Measured
     * before wiring: 680 undispatched rows in 24h, of which 0 had EVER been dispatched.
     *
     * ⚠ SIX-HOUR LOOKBACK, not the 24 the xnews pass uses, and the difference is
     * deliberate. This runs every 15 minutes, so a row would have to be missed 24 times
     * to age out — while the shorter window caps how STALE a notification can be. Nobody
     * gets pinged about yesterday's news because a backlog drained slowly.
     *
     * ⚠ ITS FAILURE MUST NOT FAIL THE IMPORT. Notification delivery is downstream of the
     * job's actual purpose, and `ok` below is the freshness signal that went unnoticed for
     * 107 days — folding a dispatch error into it would make that signal mean two things.
     * Reported in the response instead.
     */
    let dispatch: unknown = null
    let dispatchError: string | null = null
    try {
      const { dispatchPendingPlayerNewsNotifications } = await import(
        '@/lib/notifications/PlayerNewsNotificationService'
      )
      // Same budget object as the ingest above, so the two phases cannot overrun each other.
      dispatch = await dispatchPendingPlayerNewsNotifications({ lookbackHours: 6, budget })
    } catch (err) {
      dispatchError = err instanceof Error ? err.message : String(err)
      console.error('[cron/import-news] notification dispatch failed:', dispatchError)
    }

    // `imported` counts rows OFFERED to createMany, not rows inserted
    // (skipDuplicates), so it cannot stand in for freshness. `articlesFetched` is
    // the number that actually moves sports_news forward.
    const articlesFetched = fetched?.total ?? 0
    const ok = fetchError === null && articlesFetched > 0

    return NextResponse.json(
      {
        ok,
        mode: full ? 'full' : 'espn-only',
        articlesFetched,
        sourceBreakdown: fetched?.breakdown ?? null,
        sourceError: fetchError,
        normalizedOffered: result.imported,
        sports: result.sports,
        dispatch,
        dispatchError,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      // Zero fetched articles means the feed is not advancing. Reporting 200 here
      // is what hid this for 107 days.
      { status: ok ? 200 : 500 }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-news] failed:", message)
    return NextResponse.json(
      { ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 }
    )
  }
}

/**
 * 🛑 THE 240s BUDGET GATES ENTRY TO A UNIT AND CANNOT BOUND THE UNIT ITSELF, so it is not enough
 * on its own — the same conclusion `import-players`, `import-schedules` and `import-stat-lines`
 * reached on 2026-09-07 after all three 502'd at the edge WITH a budget already in place.
 *
 * This route's units are smaller than theirs and every provider call it makes is now clamped by
 * `remainingFor`, so the budget should hold here where it did not there. This wrapper is the
 * backstop for the case that reasoning is wrong: the notification fanout calls
 * `dispatchNotification`, which reaches email and SMS providers that take no signal, and a fanout
 * entered at 239s is bounded by nothing this file controls.
 *
 * ⚠ WHY THIS LOSES NO TELEMETRY THAT THE 502 DID NOT ALREADY LOSE. Today a run that overruns is
 * severed by the edge with no heartbeat written at all — `recordSyncJobRun` is the last thing
 * `handle` does — so the freshness probe reports this job stale even on runs that wrote rows.
 * Answering at 270s does not make that worse; it is the only way the run gets recorded at all.
 *
 * ⚠ 200, NOT 5xx — the `deferredForBudget` convention `import-stat-lines` established. A deferral
 * is designed behaviour for a budgeted job; 5xx would make a job that is merely late read broken.
 *
 * 🛑 AND `ok: true` HERE DOES NOT MEAN WHAT `ok` MEANS INSIDE `handle`. Down there it is the
 * freshness signal — `articlesFetched > 0` — and reporting 200 over a feed that had stopped
 * advancing is precisely what hid this job for 107 days. Here it means only "the request was
 * handled as designed", which is why `deferredForBudget` is on the same object: the two must
 * never be read as the same claim. A stalled feed is still caught, because the base schedule's
 * probe in `scripts/cron-freshness-check.mjs` is a TABLE probe on `player_news.created_at` and
 * does not read this response at all. Do not "simplify" that probe to a heartbeat.
 */
async function handleBoundedByEdge(req: NextRequest) {
  const startedAt = Date.now()
  const { result, overran } = await respondBeforeEdge<NextResponse | null>(
    () => handle(req),
    () => null,
    CRON_HARD_RESPONSE_MS,
    'import-news',
  )
  if (!overran && result) return result

  return NextResponse.json(
    {
      ok: true,
      deferredForBudget: true,
      note: 'stopped at the response deadline; rows already written are committed and the next fire continues from the rotation',
      elapsedMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  )
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handleBoundedByEdge(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handleBoundedByEdge(req)
}
