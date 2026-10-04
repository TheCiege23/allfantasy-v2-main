/**
 * GET/POST /api/cron/fantasycalc-warm
 *
 * Keeps the FantasyCalc valuation cache warm so a user request never pays the vendor fetch.
 *
 * 🛑 WHY THIS EXISTS, MEASURED RATHER THAN ASSUMED. Phase timing on `/api/trade-value/analyze`
 * (2026-09-06, two deliberate production calls) attributed a 6,919 ms handler as:
 *
 *     ai            3598 ms   52.0%
 *     fantasycalc   2456 ms   35.5%      <- this
 *     everything else, incl. the actual trade computation, ~865 ms
 *
 * A second call with warm caches ran the whole handler in 508 ms, of which fantasycalc was 502 —
 * so ~1.95 s of that 2.46 s was a COLD VENDOR FETCH, not work. At the time, 20 of the 22 profiles
 * production actually requests were 18 h to 5 d past their last sync, and
 * `getFantasyCalcValuesDbFirst` re-fetches beyond a 6 h tolerance. Every one of those was a
 * two-second wait for whoever asked next.
 *
 * ⚠ THE ALTERNATIVE FIX WAS REJECTED BY THE USER, AND CORRECTLY. Widening `maxStaleMs` would have
 * removed the same 2 s for free, by serving older values. Guap's call: FantasyCalc values should be
 * as fresh as possible. So the cost is paid on a schedule instead of by a person, and this route is
 * what makes the values FRESHER than before rather than merely faster — a served value used to be
 * up to 6 h stale, and is now at most one warm interval old.
 *
 * ⚠ NOT FOLDED INTO `/api/cron/adp-refresh`, THOUGH THAT ROUTE ALREADY TOUCHES FANTASYCALC. It runs
 * `0 10 * * *` — once a day. Warming there would cap freshness at 24 h, which is WORSE than the 6 h
 * tolerance it was meant to improve on. The host was chosen by reading the schedule, not by
 * proximity of subject matter.
 *
 * ⚠ HOURLY IS NOT ARBITRARY. `lib/fantasycalc-fetch.ts` sets `CACHE_TTL = 1 hour` for its own
 * in-process cache — the codebase's existing opinion about how fresh this data needs to be. This
 * matches it rather than inventing a second answer.
 *
 * ⚠ THE VENDOR CALL IS UNAUTHENTICATED AND FREE. `api.fantasycalc.com` takes no key and no token,
 * and no quota is documented anywhere in this repo. ~22 GETs an hour is roughly one every three
 * minutes; that is why a demand-derived list is affordable where a per-request fetch was not.
 * If that ever changes, `limit` is the dial.
 *
 * ⚠ IT ALSO WRITES EACH PROFILE'S DAILY CAPTURE (2026-10-04). The first successful warm of a UTC day
 * stores that profile's board once (`captureFantasyCalcProfileDaily`), so a completed trade graded
 * later is priced on its league's own profile from the trade date. Profiles the warm does not reach
 * (its limit is 60) get the same daily copy from `catchUpFantasyCalcProfileCaptures` after the warm:
 * from their cached row when it was synced today, else one capped fetch. If this cron stops, the captures
 * stop with it and those trades fall back to the 12-team `PlayerValueSnapshot` book — never wrong,
 * just less exact.
 *
 * ⚠ A DEAD CRON HERE DEGRADES SAFELY, WHICH IS THE OPPOSITE OF THE `ingestCFBDStats` CASE.
 * `getFantasyCalcValuesDbFirst` is read-through: if this stops running, the tolerance lapses and
 * the next request fetches live — slower, but still FRESH and still correct. Nothing silently
 * serves nulls. That is also why the read tolerance was tightened rather than removed.
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import {
  catchUpFantasyCalcProfileCaptures,
  warmFantasyCalcCache,
  type FantasyCalcCaptureCatchUpResult,
} from '@/lib/fantasycalc-db'
import { recordSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const JOB_NAME = 'cron-fantasycalc-warm'

async function handle(req: NextRequest) {
  if (!requireCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const url = new URL(req.url)
  const limitParam = Number(url.searchParams.get('limit') ?? '')
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : undefined

  try {
    const result = await warmFantasyCalcCache({
      limit,
      // Comfortably inside `maxDuration` so the deadline, not the platform, ends a slow run —
      // a platform kill would leave no telemetry row and read as "the cron never fired".
      deadlineMs: 210_000,
    })

    /*
     * The daily capture for every profile the warm did not reach (its limit is 60; production holds
     * 73). Contained: a failed catch-up never fails the warm that already succeeded. Its fetches stop
     * at 270 s into this run, inside `maxDuration`; a capture from a row synced today costs no fetch.
     */
    let catchUp: FantasyCalcCaptureCatchUpResult | { error: string }
    try {
      const c = await catchUpFantasyCalcProfileCaptures({ deadlineMs: Math.max(0, 270_000 - (Date.now() - startedAt)) })
      console.log(
        `[fantasycalc-warm] capture catch-up ${c.day}: fromCache=${c.capturedFromCache} fetched=${c.fetched} ` +
          `deferred=${c.deferred} fetchFailed=${c.fetchFailed} captureFailed=${c.captureFailed} ` +
          `alreadyCaptured=${c.alreadyCaptured}/${c.profiles}`,
      )
      catchUp = c
    } catch (error) {
      catchUp = { error: error instanceof Error ? error.message : 'unknown error' }
    }
    const catchUpErrors = 'error' in catchUp ? [`capture catch-up: ${catchUp.error}`] : catchUp.errors

    await recordSyncJobRun(
      { jobName: JOB_NAME, jobScope: 'fantasycalc', trigger: 'cron' },
      {
        rowsRead: result.attempted,
        rowsWritten: result.refreshed,
        rowsSkipped: result.skippedFresh,
        errors: [
          ...result.profiles.filter((p) => !p.ok).map((p) => `${p.cacheKey}: ${p.error}`),
          ...result.profiles.filter((p) => p.captureError).map((p) => `${p.cacheKey} (daily capture): ${p.captureError}`),
          ...catchUpErrors,
        ],
        // A truncated run is `partial`, not `success` — otherwise a vendor slow enough to eat the
        // deadline every time would report green forever while half the profiles went cold.
        ...(result.timedOut ? { status: 'partial' as const } : {}),
        metadata: {
          timedOut: result.timedOut,
          profileCount: result.profiles.length,
          // The daily league-profile capture (`captureFantasyCalcProfileDaily`): written by the first
          // successful warm of each UTC day, so most runs report 0 here, and that is correct.
          profileCaptures: result.captured,
          profileCaptureFailures: result.captureFailed,
          // Profiles the warm did not reach, captured once a day (`catchUpFantasyCalcProfileCaptures`).
          captureCatchUp: 'error' in catchUp
            ? { error: catchUp.error }
            : {
                capturedFromCache: catchUp.capturedFromCache,
                fetched: catchUp.fetched,
                deferred: catchUp.deferred,
                fetchFailed: catchUp.fetchFailed,
                captureFailed: catchUp.captureFailed,
                alreadyCaptured: catchUp.alreadyCaptured,
                profiles: catchUp.profiles,
              },
        },
      },
      Date.now() - startedAt,
    )

    return NextResponse.json({
      ok: result.failed === 0 && !result.timedOut,
      ...result,
      captureCatchUp: catchUp,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    // Record the failure too. A cron that throws and writes nothing is indistinguishable from a
    // cron that was never scheduled — this repo has already been bitten by that.
    await recordSyncJobRun(
      { jobName: JOB_NAME, jobScope: 'fantasycalc', trigger: 'cron' },
      { rowsRead: 0, rowsWritten: 0, errors: [message], status: 'failed' },
      Date.now() - startedAt,
    ).catch(() => {})
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
