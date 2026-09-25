import { NextResponse, type NextRequest } from 'next/server'
import { processWaiverWindow } from '@/lib/redraft/waiverEngine'
import { prisma } from '@/lib/prisma'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { SCORING_SEASON_STATUSES, engineSeasonScope } from '@/lib/redraft/seasonStatus'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import {
  expireDueRedraftTradeProposals,
  type RedraftTradeExpirySweepResult,
} from '@/lib/redraft/tradeProposalExpiry'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Heartbeat job name, probed by scripts/cron-freshness-check.mjs.
 *
 * This job is CONDITIONAL: with no active/drafting season there is no waiver window to
 * process, so redraft_waiver_claims can sit untouched for months while the schedule is
 * perfectly healthy. Only the SCHEDULED GET records a run — POST is the admin path.
 */
const JOB = 'cron-redraft-waiver-process'

// This branch added its own cron GET here; #284 landed an equivalent one further down
// (kept), so both would have exported `GET` from the same module. Dropped this copy —
// main's is the shipped, reviewed version and does the same work inline.
// `runWaiverProcessing()` stays: POST still calls it.

export async function POST(request: Request) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  return runWaiverProcessing()
}

/**
 * The actual work, as plain data. GET and POST ran byte-identical copies of this inline; it is
 * one function now so the cron path can be wrapped in telemetry without the two drifting.
 */
async function processDueWaiverWindows() {
  // ⚠ THIS FILTERED OUT 242 OF 246 SEASONS AND NOTHING SAID SO. `'in_season'` —
  // what the import materializer writes — matched neither arm, so waiver
  // processing has only ever run for natively drafted leagues. That is a
  // defensible rule; it just was not one anybody had written. `engineSeasonScope`
  // states it: both spellings, native leagues only, shadow behind an argument.
  // Playoff seasons too: waivers keep running in the postseason, as on every host platform, and
  // the playoff teams are the ones who most need them. See SCORING_SEASON_STATUSES.
  //
  // ⚠ ORDERED AND UNCAPPED. This read `take: 20` with no `orderBy`, so once more than twenty
  // seasons were running, the same twenty (by Postgres' physical order) were processed every
  // hour and the rest never ran a waiver. `processWaiverWindow` is a no-op read for a season
  // with no pending claims, so every season is visited instead.
  const seasons = await prisma.redraftSeason.findMany({
    where: engineSeasonScope({ statuses: SCORING_SEASON_STATUSES }),
    orderBy: { id: 'asc' },
  })
  const results: { seasonId: string; processed: unknown[] }[] = []
  for (const s of seasons) {
    const processed = await processWaiverWindow(s.leagueId, s.id)
    results.push({ seasonId: s.id, processed })
  }
  return { results }
}

async function runWaiverProcessing() {
  return NextResponse.json(await processDueWaiverWindows())
}

/**
 * Vercel Cron issues a GET (`vercel.json`: "0 * * * *"), but this route only exported POST,
 * so every hourly run returned 405 and no waiver window was ever processed on schedule.
 *
 * POST keeps its existing `requireAdminOrBearer` gate untouched. GET is gated on
 * `requireCronAuth`, which is what Vercel's scheduler actually presents — and which already
 * accepts BRACKET_ADMIN_SECRET/ADMIN_PASSWORD, so this adds only the cron secrets.
 */
export async function GET(request: Request) {
  // Name CRON_SECRET explicitly, matching #289 — a bare call resolves LEAGUE_CRON_SECRET
  // first (it IS set in prod) and 401s against Vercel's `Bearer $CRON_SECRET`.
  if (!requireCronAuth(request as unknown as NextRequest, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  /*
   * The row is written before the body runs, so an hour with no active season — or a run the
   * platform kills at maxDuration, which executes no user code afterwards and so never closes
   * the row — still leaves a usable started_at for the freshness probe.
   */
  /*
   * REDRAFT TRADE PROPOSALS EXPIRE HERE, BECAUSE NOTHING ELSE EXPIRES THEM (audit #25).
   *
   * A proposal's `expiresAt` was only ever checked when someone acted on it, so dead offers sat `pending`
   * and league votes that never reached a threshold never closed. See lib/redraft/tradeProposalExpiry.ts.
   *
   * ⚠ IT RIDES THIS ROUTE ON PURPOSE. No new API routes (the repo sits against a route ceiling), and
   * `trade-grade-notify` — which hosts the generic scheduled-trade processor — already runs over its own
   * maxDuration. This is the redraft domain's hourly job; review windows are measured in days.
   *
   * ⚠ GUARDED, AND ON ITS OWN JOB IDENTITY. Waiver processing is this route's job, so a sweep failure must
   * never cost the league its waivers, and the sweep's health is judged on its own output rather than
   * inheriting this route's heartbeat.
   */
  let tradeExpiry: RedraftTradeExpirySweepResult & { error?: string } = { due: 0, expired: 0, skipped: 0, failures: [] }
  try {
    tradeExpiry = await withSyncJobRun(
      { jobName: 'cron-redraft-trade-proposal-expiry', trigger: 'cron' },
      () => expireDueRedraftTradeProposals(),
      (r) => ({
        rowsRead: r.due,
        rowsWritten: r.expired,
        errors: r.failures.map((f) => `${f.proposalId}: ${f.error}`),
      }),
    )
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[redraft/waiver-process] trade proposal expiry sweep failed', e)
    tradeExpiry = { due: 0, expired: 0, skipped: 0, failures: [], error }
  }

  const out = await withSyncJobRun(
    { jobName: JOB, trigger: 'cron' },
    () => processDueWaiverWindows(),
    (r) => ({
      rowsRead: r.results.length,
      metadata: { seasonsProcessed: r.results.length },
    }),
  )
  return NextResponse.json({ ...out, tradeExpiry })
}
