import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  claimRotationTick,
  detectAndNotifyAll,
  detectAndNotifyLeague,
  detectAndNotifyRecent,
  type RecentSweepResult,
} from '@/lib/trade-intel/tradeNotifyService'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import {
  processDueScheduledTrades,
  type ScheduledTradeSweepResult,
} from '@/lib/automation/jobs/trades/processDueScheduledTrades'
import {
  sweepProviderTradeOffers,
  type OfferSweepResult,
} from '@/lib/provider-trades/syncProviderTradeOffers'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Trade-completion sweep (cron; cadence in cron-schedule.json). The 5-minute offer sweep runs every
 * tick; the full-feed rotation and offer ledger at most every 15 minutes (`claimRotationTick`):
 *  - Cron mode: `Authorization: Bearer ${CRON_SECRET}` → sweeps every imported
 *    Sleeper league, detects newly completed trades, emails instant grades.
 *  - Manual mode: a signed-in league member may pass ?leagueId=<AF league id>
 *    to run the check for THEIR league right now ("check for new trades").
 *
 * First run per league bootstraps the seen-set silently — no retro spam.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? ''
  const cronSecret = process.env.CRON_SECRET?.trim()
  const isCron = Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`

  /*
   * Taken before any work, so the ledger sweep at the bottom can tell how much of the route's
   * `maxDuration` is already spent. Measured from here rather than from a per-job timer because
   * the limit is on the INVOCATION: what matters to the passenger is what the driver has left.
   */
  const cronStartedAt = Date.now()

  if (isCron) {
    // DELAYED TRADES, SWEPT HERE BECAUSE NOTHING ELSE SWEEPS THEM.
    //
    // A league with `processingDelayHours > 0` parks an accepted trade at `status: 'scheduled'`
    // and waits for someone to press "process" again after the due time. Nothing did. This is the
    // scheduled caller that makes `processDueScheduledTrades` real — see that file's header.
    //
    // ⚠ IT RIDES AN EXISTING ROUTE ON PURPOSE. The standing instruction is that no new API route
    // gets added (the repo sits against a hard route ceiling), so new scheduled work is folded
    // into a route that is already built and already declared in `cron-schedule.json` — this one,
    // every 15 minutes. Delays are configured in HOURS, so that granularity is not the
    // limiting factor.
    //
    // ⚠ GUARDED SO IT CAN NEVER TAKE THE HOST DOWN. Trade grading is this route's job; a sweep
    // failure must not cost the league its grade emails. It gets its OWN `sync_job_runs` identity
    // so a freshness probe can judge it on its own output rather than inheriting the host's
    // heartbeat — a passenger job that reports the driver's health is not reporting anything.
    let scheduledTrades: ScheduledTradeSweepResult & { error?: string } = {
      due: 0,
      processed: 0,
      failures: [],
    }
    try {
      scheduledTrades = await withSyncJobRun(
        { jobName: 'cron-scheduled-trade-processor', trigger: 'cron' },
        () => processDueScheduledTrades(),
        (r) => ({
          rowsRead: r.due,
          rowsWritten: r.processed,
          errors: r.failures.map((f) => `${f.tradeId}: ${f.error}`),
        }),
      )
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.error('[cron/trade-grade-notify] scheduled trade sweep failed', e)
      scheduledTrades = { due: 0, processed: 0, failures: [], error }
    }

    /*
     * PROVIDER TRADE-OFFER LEDGER — the second passenger on this route, for the reason the first
     * one gives: no new API route gets added (the repo sits against a hard route ceiling), and
     * this is already the 30-minute sweep that walks imported Sleeper leagues.
     *
     * ⚠ A ROTATION SLICE, NOT EVERY LEAGUE. Retiring an offer requires having read the WHOLE feed
     * — 18 requests per league — so covering every league here would roughly double this route's
     * provider traffic. The user's call (2026-09-15) was a bounded slice reading the full feed
     * rather than every league reading a narrow window, because a narrow window can never retire
     * anything: a withdrawn offer would sit in someone's "Needs you" bucket indefinitely, which is
     * the stale badge the buckets exist to prevent.
     *
     * ⚠ IT DOES NOT SHARE THE NOTIFY PATH'S FETCHES, DELIBERATELY. `sleeperTradeSync` is uncached
     * because there the completed-trade feed IS the detection signal; routing it through a cache
     * to save this sweep some requests would trade that path's correctness for this one's cost.
     *
     * ⚠ GUARDED AND SEPARATELY IDENTIFIED, like the sweep above. Grading and notifying is this
     * route's job; a ledger failure must not cost a league its grade emails, and a passenger job
     * reporting the driver's heartbeat is not reporting anything.
     */
    let offerLedger: OfferSweepResult & { error?: string; skipped?: string } = {
      leaguesEligible: 0,
      leaguesSwept: 0,
      offersWritten: 0,
      vanished: 0,
      feedIncomplete: 0,
      results: [],
    }

    /*
     * 🛑 THE 5-MINUTE OFFER SWEEP, EVERY TICK (Guap's ruling, 2026-09-25). Every current-season
     * Sleeper league, on the weeks a new offer can be filed under — see `detectAndNotifyRecent`.
     * The rotation below read 20 leagues per 15 minutes, a lap of hours, and 124 of 124 offers in
     * eight days were first seen already accepted.
     *
     * ⚠ IT RUNS FIRST AND IS BUDGETED: it stops STARTING leagues at 120s, so it cannot eat the
     * rotation's time or this route's `maxDuration`. Its own `sync_job_runs` identity, for the same
     * reason as the passengers: a lane that reports the driver's heartbeat reports nothing.
     */
    let offerSweep: (Omit<RecentSweepResult, 'results'> & { leagues: number; newOffers: number; newTrades: number; emailsSent: number; deferred: number }) | { error: string }
    try {
      const sweep = await withSyncJobRun(
        { jobName: 'cron-trade-offer-sweep', trigger: 'cron' },
        () => detectAndNotifyRecent({ deadlineMs: 120_000, concurrency: 6, bootstrapLimit: 5 }),
        (r) => ({
          rowsRead: r.results.length,
          rowsWritten: r.results.reduce((a, x) => a + x.emailsSent, 0),
          errors: r.results.filter((x) => x.error).map((x) => `${x.sleeperLeagueId}: ${x.error}`),
          metadata: {
            newOffers: r.results.reduce((a, x) => a + x.newOffers, 0),
            newTrades: r.results.reduce((a, x) => a + x.newTrades, 0),
            bootstrapped: r.results.filter((x) => x.bootstrap).length,
            deferred: r.results.filter((x) => x.deferred).length,
            unstarted: r.unstarted,
            sports: r.sports,
          },
        }),
      )
      offerSweep = {
        sports: sweep.sports,
        unstarted: sweep.unstarted,
        leagues: sweep.results.length,
        newOffers: sweep.results.reduce((a, x) => a + x.newOffers, 0),
        newTrades: sweep.results.reduce((a, x) => a + x.newTrades, 0),
        emailsSent: sweep.results.reduce((a, x) => a + x.emailsSent, 0),
        deferred: sweep.results.filter((x) => x.deferred).length,
      }
    } catch (e) {
      console.error('[cron/trade-grade-notify] 5-minute offer sweep failed', e)
      offerSweep = { error: e instanceof Error ? e.message : String(e) }
    }

    /*
     * The full-feed rotation and the offer-ledger sweep keep their 15-minute cadence while the route
     * ticks every 5: they read 18 weeks a league, and their cost was sized against 15.
     */
    const rotationDue = await claimRotationTick()

    const results = !rotationDue ? [] : await withSyncJobRun(
      { jobName: 'cron-trade-grade-notify', trigger: 'cron' },
      /* Eight recently viewed leagues every fifteen minutes, plus twelve from the
       * durable cursor rotation. This keeps the route below its 300s budget
       * while moving active-league latency from hours to minutes. */
      () => detectAndNotifyAll(12, 8),
      (rs) => ({
        rowsRead: rs.length,
        rowsWritten: rs.reduce((a, r) => a + r.emailsSent, 0),
        errors: rs.filter((r) => r.error).map((r) => `${r.sleeperLeagueId}: ${r.error}`),
        metadata: {
          newTrades: rs.reduce((a, r) => a + r.newTrades, 0),
          newOffers: rs.reduce((a, r) => a + r.newOffers, 0),
          bootstrapped: rs.filter((r) => r.bootstrap).length,
        },
      }),
    )

    /*
     * 🛑 THE LEDGER SWEEP RUNS LAST, AND IT YIELDS THE ROUTE'S REMAINING BUDGET RATHER THAN TAKING
     * IT. It was added AHEAD of the notify call, which was wrong on a route that is ALREADY OVER
     * its own limit: `scripts/cron-fast-tier-loop.mjs` measures `trade-grade-notify` at p99 359s
     * against `maxDuration = 300`, running alone. A passenger placed first spends budget the
     * driver then does not have, and a timeout does not respect the try/catch around it — the
     * whole invocation dies, and the grade emails that are this route's actual job are what get
     * lost. Being second is the difference between "the ledger waits a cycle" and "nobody was told
     * their trade was graded".
     *
     * ⚠ AND THE CADENCE IS EVERY FIFTEEN MINUTES, NOT THIRTY. `cron-schedule.json` declares this
     * path on a fifteen-minute cron, and the notify comment above says "every fifteen minutes" —
     * while this file's own top docblock still says "every 30 min via vercel.json", which is stale
     * twice over, since `vercel.json` declares no crons at all any more. The sweep was sized
     * against the 30 and was therefore wrong by a factor of two on its request RATE. A skipped
     * cycle costs the ledger about fifteen minutes of freshness, not thirty.
     *
     * (The cron literal is spelled out in words on purpose: it contains the two characters that
     * end a block comment, which is a footgun this repo has already documented.)
     */
    const SWEEP_BUDGET_FLOOR_MS = 120_000
    const elapsedMs = Date.now() - cronStartedAt
    if (!rotationDue) {
      offerLedger = { ...offerLedger, skipped: 'runs with the full-feed rotation, every 15 minutes' }
    } else if (elapsedMs > maxDuration * 1000 - SWEEP_BUDGET_FLOOR_MS) {
      /*
       * Not an error, and reported rather than silent: the ledger is eventually-consistent by
       * design, so a skipped cycle is a normal outcome. A sweep that never reports skipping is
       * indistinguishable from one that never had anything to do.
       */
      offerLedger = { ...offerLedger, skipped: `route had used ${Math.round(elapsedMs / 1000)}s of its ${maxDuration}s budget` }
    } else {
      try {
        offerLedger = await withSyncJobRun(
          { jobName: 'cron-provider-trade-offer-ledger', trigger: 'cron' },
          () => sweepProviderTradeOffers({ maxLeagues: 15 }),
          (r) => ({
            rowsRead: r.leaguesSwept,
            rowsWritten: r.offersWritten,
            errors: r.results.filter((x) => x.error).map((x) => `${x.leagueId}: ${x.error}`),
            /*
             * `feedIncomplete` is reported rather than swallowed: those leagues had nothing retired
             * this run, so a ledger that looks stale for them is explained rather than mysterious.
             */
            metadata: {
              vanished: r.vanished,
              feedIncomplete: r.feedIncomplete,
              eligible: r.leaguesEligible,
            },
          }),
        )
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        console.error('[cron/trade-grade-notify] provider trade-offer sweep failed', e)
        offerLedger = { ...offerLedger, error }
      }
    }

    return NextResponse.json({
      mode: 'cron' as const,
      scheduledTrades,
      offerSweep,
      rotation: rotationDue ? ('ran' as const) : ('not due' as const),
      offerLedger,
      leagues: results.length,
      newTrades: results.reduce((a, r) => a + r.newTrades, 0),
      newOffers: results.reduce((a, r) => a + r.newOffers, 0),
      emailsSent: results.reduce((a, r) => a + r.emailsSent, 0),
      bootstrapped: results.filter((r) => r.bootstrap).length,
      errors: results.filter((r) => r.error).map((r) => ({ league: r.sleeperLeagueId, error: r.error })),
    })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const league = await prisma.league.findFirst({
    where: {
      id: leagueId,
      OR: [{ userId: userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: { platform: true, platformLeagueId: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (league.platform !== 'sleeper' || !league.platformLeagueId) {
    return NextResponse.json({ supported: false as const, platform: league.platform })
  }

  const result = await detectAndNotifyLeague(league.platformLeagueId)
  return NextResponse.json({ mode: 'manual' as const, ...result })
}
