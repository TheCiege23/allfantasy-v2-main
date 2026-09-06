/**
 * Vercel Cron: prewarm DraftPoolCache for all pre_draft/scheduled/paused/in_progress drafts.
 * Runs every 30 minutes so the pool is hot before users open the draft room.
 * Auth: requireCronAuth (CRON_SECRET / LEAGUE_CRON_SECRET).
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { checkDraftPoolCacheFast, ensureDraftPoolReady } from '@/lib/draft-room/ensureDraftPoolReady'
import { runWithConcurrency, withTimeout } from '@/lib/async-utils'
import { recordSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

/**
 * Heartbeat identity, read by PROBES in scripts/cron-freshness-check.mjs.
 *
 * ⚠ DISTINCT FROM THE EXISTING `draft_pool_cache_warm` NAME, DELIBERATELY. That name already
 * exists in sync_job_runs from a non-cron caller and has ZERO cron-triggered runs, so probing it
 * would report this cron healthy on somebody else's invocation — the same shared-identity false
 * green that the query-param modes had. The cron path gets its own name.
 *
 * ⚠ AND A HEARTBEAT IS THE ONLY OPTION HERE: this route WRITES NOTHING DURABLE. It warms a cache,
 * so there is no table whose freshness could stand in for "did the prewarm run".
 */
const JOB = 'cron-draft-pool-prewarm'

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * ⚠ CONCURRENCY, THE PER-LEAGUE TIMEOUT, AND THE LATEST-START DEADLINE ARE NOT INDEPENDENT.
 *
 * `Promise.all` over every cold league had no per-league bound at all, so ONE stuck league (a
 * hung provider call, a slow write) failed the entire batch: every other league's work was
 * silently discarded when the platform killed the whole function at maxDuration. Measured in
 * production, three runs in a row, right after the fast-tier loop's own 180s client ceiling was
 * removed (which had been hiding this): HTTP 504 / "fetch failed" landing within ~1s of the
 * 300000ms mark every time.
 *
 * PER_LEAGUE_TIMEOUT_MS sits ABOVE the documented normal cost, not below it -- a cold build was
 * already measured at 60-90s even in isolation (see the docblock atop
 * __tests__/draft/pool-prewarm-controls.test.ts, "ensureDraftPoolReady ran a 60-90s synchronous
 * cold build"). A lower number would abort legitimate builds, not just hung ones.
 *
 * LATEST_START_DEADLINE_MS is derived, not guessed: the last league allowed to START must still
 * be able to finish -- or hit its own per-league timeout -- before maxDuration. Once elapsed time
 * passes it, remaining leagues are marked 'deferred' without being attempted; they are picked up
 * on the very next tick (this cron runs every 30 minutes) instead of becoming another 504.
 */
/**
 * 🛑 THE DEADLINE ABOVE WAS DERIVED ASSUMING THE CACHE CHECK IS FREE. IT IS NOT.
 *
 * `checkDraftPoolCacheFast` documents itself as "queries DB in <50 ms, never triggers a cold
 * build", and that is true of the work it issues. It is NOT true of the time it takes, because
 * this process is single-threaded and the check is competing with CONCURRENCY cold builds that
 * the docblock above already measures at 60-90s each.
 *
 * MEASURED IN PRODUCTION, 2026-09-03 12:33Z, on the container serving the site:
 *
 *     [draft-perf] pool fast-check { warm: false, source: 'cold', entryCount: 0, ms: 65841 }
 *     [draft-perf] pool fast-check { ... ms: 65835 }
 *     [draft-perf] pool fast-check { ... ms: 66383 }
 *     [draft-pool-prewarm] league exceeded its per-league timeout ... { timeoutMs: 120000 }  x3
 *
 * 65,841ms against a documented 50ms is not a slow query, it is a starved event loop. And it
 * breaks the arithmetic: a league that spends 65s deciding whether to build, then starts a build
 * budgeted at 120s, needs 185s -- but LATEST_START_DEADLINE_MS only guaranteed it 160s. So the
 * "last league allowed to START must still be able to finish" property the deadline exists to
 * provide was FALSE exactly when the container was under load, which is the only time it matters.
 * That is how this cron reaches maxDuration and 504s, which is the failure the deadline was
 * added to prevent.
 *
 * So the check is bounded, and a check that BLOWS its budget is treated as a load signal rather
 * than as a reason to build. A cache probe that cannot complete in 5s (100x its documented cost)
 * is direct evidence this process cannot afford a 60-90s build right now, and starting one is
 * what turns a slow container into an outage -- measured the same day, the site's own homepage
 * timing out at 30s while /api/health answered in 0.2s.
 *
 * Deferring is already this cron's answer to "not enough budget"; this just teaches it a second
 * way to run out. Deferred leagues are retried on the next tick, 30 minutes later.
 *
 * ⚠ A LEAGUE WHOSE CHECK IS SLOW FOR A NON-LOAD REASON WOULD DEFER EVERY TICK and never warm.
 * Nothing here distinguishes "saturated" from "this one league's query is pathological". The
 * warn log names the league so that case is visible rather than silent; if one leagueId recurs
 * across ticks, the cause is that league, not the container.
 */
const CONCURRENCY = 3
const PER_LEAGUE_TIMEOUT_MS = 120_000
const CACHE_CHECK_TIMEOUT_MS = 5_000
/**
 * A rejection arriving after HALF the check budget is read as saturation rather than as a cache
 * miss. Half is chosen so the two doors cannot disagree: anything slower than this would have
 * tripped the timeout shortly anyway, and anything faster is the immediate error a genuine miss
 * produces. Found in review — the first version of this file mapped EVERY rejection to "build it",
 * which left the outage path open under exactly the load the timeout was added to detect.
 */
const SLOW_REJECTION_MS = CACHE_CHECK_TIMEOUT_MS / 2
const RESPONSE_MARGIN_MS = 20_000
const LATEST_START_DEADLINE_MS =
  maxDuration * 1000 - CACHE_CHECK_TIMEOUT_MS - PER_LEAGUE_TIMEOUT_MS - RESPONSE_MARGIN_MS

async function handle(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sessions = await prisma.draftSession.findMany({
    where: { status: { in: ['pre_draft', 'scheduled', 'paused', 'in_progress'] } },
    select: { leagueId: true },
    distinct: ['leagueId'],
  })

  console.info('[draft-pool-prewarm] cron start', { count: sessions.length })
  const t = Date.now()
  const latestStartAt = t + LATEST_START_DEADLINE_MS

  const results = await runWithConcurrency(sessions, CONCURRENCY, async ({ leagueId }: { leagueId: string }) => {
    if (Date.now() > latestStartAt) {
      return { leagueId, action: 'deferred', error: 'past this run’s start deadline; retried next tick' }
    }

    /*
     * THREE OUTCOMES, NOT TWO — and the third is the one a first pass gets wrong.
     *
     * A check that never RETURNS is saturation. A check that REJECTS is ambiguous: a genuine
     * cache-miss error comes back immediately, but pool exhaustion, a statement timeout and a
     * socket error are ALSO rejections, they are saturation symptoms, and they arrive slow.
     * Mapping every rejection to "not warm" leaves the route with two doors under load, one of
     * which still starts a 60-90s build into a dying process — the exact outage this bounds.
     *
     * So the rejection is TIMED. Fast rejection keeps the old behaviour (build it); a rejection
     * arriving late in the budget goes through the same door as a timeout.
     */
    const checkStartedAt = Date.now()
    let rejectedAfterMs = -1
    const check = await withTimeout(
      checkDraftPoolCacheFast(leagueId)
        .then((readiness) => readiness.warm)
        .catch(() => {
          rejectedAfterMs = Date.now() - checkStartedAt
          return false
        }),
      CACHE_CHECK_TIMEOUT_MS,
    )

    const slowRejection = rejectedAfterMs >= 0 && rejectedAfterMs > SLOW_REJECTION_MS
    if (!check.ok || slowRejection) {
      console.warn('[draft-pool-prewarm] cache check exceeded its budget — deferring rather than building', {
        leagueId,
        timeoutMs: CACHE_CHECK_TIMEOUT_MS,
        reason: check.ok ? 'slow-rejection' : 'timeout',
        rejectedAfterMs: rejectedAfterMs >= 0 ? rejectedAfterMs : null,
      })
      return {
        leagueId,
        action: 'deferred',
        error: `cache check ${check.ok ? `rejected after ${rejectedAfterMs}ms` : `exceeded ${CACHE_CHECK_TIMEOUT_MS}ms`}; container saturated, retried next tick`,
      }
    }

    if (check.value) return { leagueId, action: 'warm' }

    const outcome = await withTimeout(ensureDraftPoolReady(leagueId), PER_LEAGUE_TIMEOUT_MS)
    if (!outcome.ok) {
      console.warn('[draft-pool-prewarm] league exceeded its per-league timeout, retried next tick', {
        leagueId,
        timeoutMs: PER_LEAGUE_TIMEOUT_MS,
      })
      return { leagueId, action: 'timeout', error: `exceeded ${PER_LEAGUE_TIMEOUT_MS}ms` }
    }

    const result = outcome.value
    return {
      leagueId,
      action: result.ok ? result.source : 'error',
      error: result.ok ? undefined : result.error,
    }
  })

  /*
   * WHICH KIND OF DEFERRAL WAS THAT? The discriminator is already in hand at tick end and costs
   * no extra query: load defers EVERY league, a pathological league defers ALONE while its peers
   * succeed. Without this the distinction is only recoverable by a human noticing the same
   * leagueId recur across ticks — an observable becomes a hope. Raised in review.
   */
  const deferred = results.filter((r) => r.action === 'deferred')
  if (deferred.length > 0) {
    console.warn('[draft-pool-prewarm] deferrals this tick', {
      deferred: deferred.length,
      total: results.length,
      diagnosis: deferred.length === results.length ? 'container-saturated' : 'league-specific',
      leagueIds: deferred.map((r) => r.leagueId),
    })
  }

  console.info('[draft-pool-prewarm] cron done', { totalMs: Date.now() - t, results })

  /*
   * Recorded even when every league defers. A deferral is the container being saturated, which is
   * the budget working — and it still proves the job woke up, which is the whole claim a heartbeat
   * makes. Counting deferrals as failure would make this red under exactly the load it is designed
   * to shed.
   */
  await recordSyncJobRun(
    { jobName: JOB, trigger: 'cron' },
    {
      rowsRead: results.length,
      rowsWritten: results.filter((r) => r.action !== 'deferred').length,
      rowsSkipped: deferred.length,
      warnings: deferred.length === results.length && results.length > 0 ? ['container-saturated'] : [],
      metadata: { deferred: deferred.length },
    },
    Date.now() - t,
  )

  return NextResponse.json({ ok: true, results })
}

export async function GET(req: NextRequest) {
  return handle(req)
}
