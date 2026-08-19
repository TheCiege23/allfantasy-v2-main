/**
 * GET /api/cron/live-score-tick — scheduled live-scoring tick (G11 Phase 3b).
 *
 * Drives the reusable live-scoring orchestrator for every active redraft season via
 * the real NFL provider: poll only active games, persist only changed stat lines,
 * rescore only affected matchups/standings, broadcast only affected entities over
 * SSE. Cron-auth protected + instrumented (SyncJobRun). Idempotent — an unchanged
 * poll does no writes. The 5-minute full score-sync remains as a reconciliation/
 * correction fallback.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { runLiveScoringForActiveSeasons } from '@/server/services/liveScoring/liveScoreRunner'
import { RollingInsightsLiveProvider } from '@/lib/live/rollingInsightsLiveProvider'
import { runPollLoop, createCadenceGate, LIVE_POLL_INTERVAL_MS, PBP_POLL_INTERVAL_MS, POLL_BUDGET_MS } from '@/lib/live/gamedayPoller'
import { refreshPlayByPlayFeed } from '@/lib/live/playByPlayFeed'

/**
 * Opt-in Rolling Insights live provider, PRESEASON ONLY.
 *
 * ⚠ OFF UNLESS `LIVE_PROVIDER_RI_PRESEASON=1`. This swaps the data source under a
 * live-scoring path that already works: the incumbent NflLiveStatsProvider reads
 * prisma.sportsGame, filled by import-scores from API-Sports. A silent default
 * change here would alter every active league's scoring with no way to attribute
 * a regression. The flag exists so the swap can be turned off in one env edit
 * rather than a redeploy.
 *
 * ⚠ AND THE PROVIDER ITSELF IS SCOPED TO PRESEASON, so even with the flag ON it
 * returns nothing for a regular-season game — belt and braces, because the flag
 * protects the rollout while the scope protects the users.
 *
 * What it buys: PLAYER-LEVEL live stats. The DB path carries team scores; RI's
 * live feed carries per-player box lines, which is what fantasy scoring needs.
 *
 * ⚠ Construction THROWS without ROLLING_INSIGHTS_RSC_TOKEN (CLIENT_SECRET2 is the
 * other-sports credential and 304s forever against NFL). Caught here so a missing
 * token degrades to the incumbent provider instead of failing the whole tick.
 */
function resolveLiveProvider() {
  /*
   * ⚠⚠ HARD-DISABLED PENDING AN ID CROSSWALK. Rolling Insights keys players by its
   * OWN numeric ids, which collide numerically with Sleeper ids while referring to
   * different people (RI 143 = Marcus Mariota; our sleeper:143 = John Carlson).
   * With this provider live, a QB's stats would be credited to a TE — silently,
   * with plausible numbers.
   *
   * The env flag alone is NOT sufficient protection: it is already set in
   * production. This second gate means the flag cannot cause harm even while on,
   * and it is removed only when the crosswalk lands and is coverage-asserted.
   */
  /*
   * Flipped true once scripts/build-ri-player-crosswalk.ts wrote 2,311 rows at
   * 94.9% coverage of active RI players, with the three ids that exposed the
   * original collision now resolving to the right humans (RI 8735 -> Ollie Gordon
   * II, previously Jairon McVea). The provider skips any RI player still
   * unmapped rather than passing the raw id through.
   */
  const ID_CROSSWALK_READY = true
  if (!ID_CROSSWALK_READY) {
    if (process.env.LIVE_PROVIDER_RI_PRESEASON === '1') {
      console.warn(
        '[live-score-tick] LIVE_PROVIDER_RI_PRESEASON is set but the RI provider is disabled: ' +
          'RI player ids are not Sleeper player ids and collide numerically. Using the incumbent provider.'
      )
    }
    return undefined
  }
  if (process.env.LIVE_PROVIDER_RI_PRESEASON !== '1') return undefined
  try {
    return new RollingInsightsLiveProvider({ scope: 'preseason' })
  } catch (err) {
    console.error('[live-score-tick] RI provider unavailable, falling back:', err)
    return undefined
  }
}

export const dynamic = 'force-dynamic'

/**
 * ⚠ RAISED FOR THE IN-INVOCATION POLL LOOP, AND IT MUST EXCEED POLL_BUDGET_MS.
 * INTEGRATION.md §4 asks for a 35s cadence on live data; Vercel cron granularity
 * is one minute, so a single invocation polls several times inside its own
 * lifetime instead of one invocation per poll. The loop budgets 105s against
 * this cron's 120s interval, leaving margin at both ends — under maxDuration so
 * the function is not killed mid-tick, and under the interval so invocation N
 * finishes before N+1 starts.
 */
export const maxDuration = 120

export async function GET(request: NextRequest) {
  // `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`, and
  // LEAGUE_CRON_SECRET is set in production — so a BARE call compares Vercel's
  // `Authorization: Bearer $CRON_SECRET` against the wrong variable and 401s. This route is
  // scheduled `*/2` and was doing exactly that: 60 invocations / 60 x 401 in a 2h production
  // sample, never once running. Naming CRON_SECRET explicitly is the same fix as #289.
  if (!requireCronAuth(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const provider = resolveLiveProvider()

    /*
     * One tick is exactly what this route used to do per invocation. The loop
     * repeats it at the live cadence while games are on, and stops after a
     * single pass when nothing is — so a quiet Tuesday costs what it always did
     * and a Sunday gets 35s coverage.
     */
    let loop: Awaited<ReturnType<typeof runPollLoop>> | null = null
    let pbp: Awaited<ReturnType<typeof refreshPlayByPlayFeed>> | null = null

    const report = await withSyncJobRun(
      {
        jobName: 'cron-live-score-tick',
        trigger: 'cron',
        // Telemetry records WHICH provider ran, so a scoring anomaly can be
        // attributed to the swap rather than guessed at.
        provider: provider ? 'rolling_insights_preseason' : 'sleeper',
        sport: 'NFL',
      },
      async () => {
        /*
         * Scores and plays are polled in the SAME tick, at the same 35s cadence
         * INTEGRATION.md §4 specifies for both. They are separate endpoints —
         * /live returns the whole slate in one call, /play-by-play needs a
         * game_id each — so a Sunday is 1 + N calls per cycle. The vendor has
         * confirmed no quota (GAPS N-03), and this is the ~85% of call volume
         * that estimate was about.
         *
         * ⚠ PLAYS MUST NEVER TAKE DOWN SCORING. The feed is a retention feature;
         * the score is the product. If play-by-play throws, the tick still
         * returns the scoring result and the loop keeps going.
         */
        /*
         * ⚠ PLAYS RUN ON THEIR OWN CLOCK, NOT ONCE PER TICK. The loop now ticks
         * at the live cadence, which is faster than the play-by-play cadence on
         * purpose: `/live` is one call for the whole slate, `/play-by-play` is
         * one call PER LIVE GAME. Refreshing plays on every tick would multiply
         * the expensive endpoint by the cheap one's frequency — on a 13-game
         * Sunday that is 13 extra requests every 10 seconds, for plays the
         * contract says arrive every 35.
         */
        const pbpDue = createCadenceGate(PBP_POLL_INTERVAL_MS)
        const tickOnce = async () => {
          const scored = await runLiveScoringForActiveSeasons(prisma, provider ? { provider } : {})
          if (pbpDue()) pbp = await refreshPlayByPlayFeed().catch(() => pbp)
          return scored
        }
        let last = await tickOnce()
        loop = await runPollLoop(async () => {
          last = await tickOnce()
        })
        return last
      },
      (r) => ({
        rowsRead: r.ticked,
        rowsUpdated: r.summaries.reduce((s, x) => s + x.affectedMatchups, 0),
        status: 'success',
        metadata: {
          seasonsTicked: r.ticked,
          seasonsPolled: r.polled,
          liveProvider: provider ? 'rolling_insights_preseason' : 'sleeper',
          /* Recorded so a quiet Sunday can be told apart from a broken loop:
             ticks=1 with 'no-active-games' is correct on a Tuesday and a bug at
             4pm on a Sunday. */
          pollTicks: loop?.ticks ?? 1,
          pollStoppedBecause: loop?.stoppedBecause ?? 'no-active-games',
          pollElapsedMs: loop?.elapsedMs ?? 0,
          pollIntervalMs: LIVE_POLL_INTERVAL_MS,
          pbpIntervalMs: PBP_POLL_INTERVAL_MS,
          pollBudgetMs: POLL_BUDGET_MS,
          /* `pbpSkipped: 'no-token'` is a configuration problem; 'no-live-games'
             is a Tuesday. Distinguishing them in telemetry is the difference
             between an alert and a shrug. */
          pbpGamesPolled: pbp?.gamesPolled ?? 0,
          pbpNewEvents: pbp?.newEvents ?? 0,
          pbpSkipped: pbp?.skipped ?? null,
        },
      }),
    )
    return NextResponse.json({ ok: true, ...report, ranAt: new Date().toISOString() })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'live-score-tick failed' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
