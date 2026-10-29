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
import { processDueTradeReviews, type TradeReviewSweepResult } from '@/lib/redraft/tradeReviewWindowSweep'
import type { InactiveLineupRunResult } from '@/lib/inactive-manager/inactiveManagerService'
import type { EliminatedLineupRunResult } from '@/lib/eliminated-lineups/eliminatedLineupService'
import type { RookieOrderRoundNoticeRun } from '@/lib/rookie-order/roundNoticeService'
import type { IrAutoMoveRunResult } from '@/lib/ir-activation/irAutoMoveService'
import type { OrphanAuctionRunResult } from '@/lib/orphan-auction/orphanAuctionService'
import type { TaxiStealRunResult } from '@/lib/taxi/taxiStealingService'

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

  /*
   * Pending offers expire once a league's trade deadline passes, on both trade engines, and both sides are
   * told (lib/trade-deadline/expireOffersAtDeadline.ts). Hourly is the deadline's granularity here; the
   * engines refuse acceptance from the deadline itself, so nothing can complete in the gap.
   */
  let deadlineExpiry: unknown = null
  try {
    const { expirePendingOffersAtDeadline } = await import('@/lib/trade-deadline/expireOffersAtDeadline')
    deadlineExpiry = await withSyncJobRun(
      { jobName: 'cron-trade-deadline-expiry', trigger: 'cron' },
      () => expirePendingOffersAtDeadline(),
      (r) => ({
        rowsRead: r.leaguesChecked,
        rowsWritten: r.expiredAf + r.expiredRedraft,
        errors: r.failures.map((f) => `${f.id}: ${f.error}`),
        metadata: { leaguesPastDeadline: r.leaguesPastDeadline, expiredAf: r.expiredAf, expiredRedraft: r.expiredRedraft },
      }),
    )
  } catch (e) {
    console.error('[redraft/waiver-process] trade deadline expiry sweep failed', e)
    deadlineExpiry = { error: e instanceof Error ? e.message : String(e) }
  }

  /*
   * Accepted trades whose review window ended with no veto go through here (lib/redraft/tradeReviewWindow.ts),
   * guarded and on their own job identity for the same reasons as the expiry sweep above.
   */
  let tradeReviews: TradeReviewSweepResult & { error?: string } = { due: 0, processed: 0, waitingOnLock: 0, held: 0, skipped: 0, closed: 0, failures: [] }
  try {
    tradeReviews = await withSyncJobRun(
      { jobName: 'cron-redraft-trade-review-window', trigger: 'cron' },
      () => processDueTradeReviews(),
      (r) => ({
        rowsRead: r.due,
        rowsWritten: r.processed + r.closed,
        errors: r.failures.map((f) => `${f.proposalId}: ${f.error}`),
        metadata: { waitingOnLock: r.waitingOnLock, closed: r.closed },
      }),
    )
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[redraft/waiver-process] trade review window sweep failed', e)
    tradeReviews = { due: 0, processed: 0, waitingOnLock: 0, held: 0, skipped: 0, closed: 0, failures: [], error }
  }

  /*
   * Inactive manager mode (lib/inactive-manager): set the best lineup for teams the commissioner handed
   * to AllFantasy. Hourly keeps it current as injuries and projections move; guarded and on its own job
   * identity, for the same reasons as the sweep above.
   */
  /*
   * The commissioner's opt-in auto-handover (lib/inactive-manager/autoHandover.ts): a team idle for the
   * chosen number of days is handed to AllFantasy (or Chimmy autopilot). Before the lineup run, so a team
   * handed over now gets its lineup set this same hour. Guarded and on its own job identity.
   */
  let autoHandovers: unknown = null
  try {
    const { runAutoHandovers } = await import('@/lib/inactive-manager/inactiveManagerService')
    autoHandovers = await withSyncJobRun(
      { jobName: 'cron-inactive-auto-handover', trigger: 'cron' },
      () => runAutoHandovers(),
      (r) => ({
        rowsRead: r.leagues,
        rowsWritten: r.handedOver,
        errors: r.failures.map((f) => `${f.leagueId}: ${f.error}`),
      }),
    )
  } catch (e) {
    console.error('[redraft/waiver-process] auto handover failed', e)
    autoHandovers = { error: e instanceof Error ? e.message : String(e) }
  }

  let inactiveLineups: InactiveLineupRunResult | { error: string } | null = null
  try {
    const { runInactiveManagerLineups } = await import('@/lib/inactive-manager/inactiveManagerService')
    inactiveLineups = await withSyncJobRun(
      { jobName: 'cron-inactive-manager-lineups', trigger: 'cron' },
      () => runInactiveManagerLineups(),
      (r) => ({
        rowsRead: r.teams,
        rowsWritten: r.set,
        errors: r.failures.map((f) => `${f.leagueId}${f.rosterId ? `/${f.rosterId}` : ''}: ${f.error}`),
        metadata: { leagues: r.leagues, unchanged: r.unchanged, skipped: r.skipped },
      }),
    )
  } catch (e) {
    console.error('[redraft/waiver-process] inactive manager lineups failed', e)
    inactiveLineups = { error: e instanceof Error ? e.message : String(e) }
  }

  /*
   * The free "bench my starters on bye automatically" switch (lib/lineup-automation): hourly, swap a
   * starter whose bye week is this week for the best bench player who can play. Guarded and on its own
   * job identity, like the sweeps around it.
   */
  let autoBenchByes: unknown = null
  try {
    const { runAutoBenchByes } = await import('@/lib/lineup-automation/autoBenchByeService')
    autoBenchByes = await withSyncJobRun(
      { jobName: 'cron-auto-bench-bye', trigger: 'cron' },
      () => runAutoBenchByes(),
      (r) => ({
        rowsRead: r.teams,
        rowsWritten: r.swapped,
        errors: r.failures.map((f) => `${f.leagueId}${f.rosterId ? `/${f.rosterId}` : ''}: ${f.error}`),
        metadata: { unchanged: r.unchanged, skipped: r.skipped },
      }),
    )
  } catch (e) {
    console.error('[redraft/waiver-process] auto bench bye failed', e)
    autoBenchByes = { error: e instanceof Error ? e.message : String(e) }
  }

  /*
   * Fill an empty starting spot before lock (lib/lineup-automation/fillEmptyStartersService): on by
   * default in every weekly-lineup league played on AllFantasy, unless the commissioner switched it off.
   * Fills only empty spots from the bench and tells the commissioner about a spot nobody can play.
   * Guarded and on its own job identity, like the sweeps around it.
   */
  let fillEmptyStarters: unknown = null
  try {
    const { runFillEmptyStarters } = await import('@/lib/lineup-automation/fillEmptyStartersService')
    fillEmptyStarters = await withSyncJobRun(
      { jobName: 'cron-fill-empty-starters', trigger: 'cron' },
      () => runFillEmptyStarters(),
      (r) => ({
        rowsRead: r.teams,
        rowsWritten: r.filled,
        errors: r.failures.map((f) => `${f.leagueId}${f.rosterId ? `/${f.rosterId}` : ''}: ${f.error}`),
        metadata: { leagues: r.leagues, flagged: r.flagged, skipped: r.skipped },
      }),
    )
  } catch (e) {
    console.error('[redraft/waiver-process] fill empty starters failed', e)
    fillEmptyStarters = { error: e instanceof Error ? e.message : String(e) }
  }

  /*
   * Taxi deadline notices (lib/taxi/taxiDeadlineNoticeService): in the week a taxi promotion deadline
   * or lock week closes, every owner is told before it does and the commissioner gets a summary. Leagues
   * with taxi enforcement on (AF Commissioner). Guarded and on its own job identity, like the sweeps around it.
   */
  let taxiDeadlines: unknown = null
  try {
    const { runTaxiDeadlineNotices } = await import('@/lib/taxi/taxiDeadlineNoticeService')
    taxiDeadlines = await withSyncJobRun(
      { jobName: 'cron-taxi-deadline-notices', trigger: 'cron' },
      () => runTaxiDeadlineNotices(),
      (r) => ({
        rowsRead: r.leagues,
        rowsWritten: r.notified,
        errors: r.failures.map((f) => `${f.leagueId}: ${f.error}`),
        metadata: { skipped: r.skipped },
      }),
    )
  } catch (e) {
    console.error('[redraft/waiver-process] taxi deadline notices failed', e)
    taxiDeadlines = { error: e instanceof Error ? e.message : String(e) }
  }

  /*
   * "What AllFantasy did this week" (lib/commissioner-hub/weeklyAutomationRecapService): on Mondays,
   * one message per league to its commissioner summing up the automations' own actions last week.
   * Guarded and on its own job identity, like the sweeps around it.
   */
  let automationRecaps: unknown = null
  try {
    const { runWeeklyAutomationRecaps } = await import('@/lib/commissioner-hub/weeklyAutomationRecapService')
    automationRecaps = await withSyncJobRun(
      { jobName: 'cron-weekly-automation-recap', trigger: 'cron' },
      () => runWeeklyAutomationRecaps(),
      (r) => ({
        rowsRead: r.leagues,
        rowsWritten: r.sent,
        errors: r.failures.map((f) => `${f.leagueId}: ${f.error}`),
        metadata: { nothing: r.nothing, alreadySent: r.alreadySent },
      }),
    )
  } catch (e) {
    console.error('[redraft/waiver-process] weekly automation recap failed', e)
    automationRecaps = { error: e instanceof Error ? e.message : String(e) }
  }

  /*
   * Chimmy autopilot (AF Commissioner): teams on autopilot claim a free agent for a starting slot
   * nobody healthy on the roster can fill. Before the waiver window below, so a claim made now can be
   * processed in the same run. Guarded and on its own job identity, like the sweeps above.
   */
  let autopilotWaivers: unknown = null
  try {
    const { runAutopilotWaivers } = await import('@/lib/inactive-manager/inactiveManagerService')
    autopilotWaivers = await withSyncJobRun(
      { jobName: 'cron-chimmy-autopilot-waivers', trigger: 'cron' },
      () => runAutopilotWaivers(),
      (r) => ({
        rowsRead: r.teams,
        rowsWritten: r.claims,
        errors: r.failures.map((f) => `${f.leagueId}${f.rosterId ? `/${f.rosterId}` : ''}: ${f.error}`),
        metadata: { leagues: r.leagues, skipped: r.skipped },
      }),
    )
  } catch (e) {
    console.error('[redraft/waiver-process] chimmy autopilot waivers failed', e)
    autopilotWaivers = { error: e instanceof Error ? e.message : String(e) }
  }

  /*
   * Lineup minimums for eliminated teams (lib/eliminated-lineups): an AF Commissioner rule. Fills only
   * the short slots of a team out of the race, from its bench, and tells its manager once a week what is
   * still short. Hourly for the same reason as inactive manager mode; guarded and on its own job identity.
   */
  let eliminatedLineups: EliminatedLineupRunResult | { error: string } | null = null
  try {
    const { runEliminatedLineupMinimums } = await import('@/lib/eliminated-lineups/eliminatedLineupService')
    eliminatedLineups = await withSyncJobRun(
      { jobName: 'cron-eliminated-lineup-minimums', trigger: 'cron' },
      () => runEliminatedLineupMinimums(),
      (r) => ({
        rowsRead: r.teams,
        rowsWritten: r.filled + r.notified,
        errors: r.failures.map((f) => `${f.leagueId}${f.rosterId ? `/${f.rosterId}` : ''}: ${f.error}`),
        metadata: { leagues: r.leagues, filled: r.filled, notified: r.notified, skipped: r.skipped },
      }),
    )
  } catch (e) {
    console.error('[redraft/waiver-process] eliminated lineup minimums failed', e)
    eliminatedLineups = { error: e instanceof Error ? e.message : String(e) }
  }

  /*
   * Live rookie order (lib/rookie-order/roundNoticeService): AF Commissioner automation. Refreshes the
   * order of every league that automates it — saving the final order when the title game is decided —
   * and tells the commissioner (and league chat, when chosen) which picks each playoff round locked.
   * Hourly because playoff results land on the score sync's schedule; guarded and on its own job identity.
   */
  let rookieOrderRounds: RookieOrderRoundNoticeRun | { error: string } | null = null
  try {
    const { runRookieOrderRoundNotices } = await import('@/lib/rookie-order/roundNoticeService')
    rookieOrderRounds = await withSyncJobRun(
      { jobName: 'cron-rookie-order-round-notices', trigger: 'cron' },
      () => runRookieOrderRoundNotices(),
      (r) => ({
        rowsRead: r.leagues,
        rowsWritten: r.announced,
        errors: r.failures.map((f) => `${f.leagueId}: ${f.error}`),
        metadata: { refreshed: r.refreshed, notified: r.notified, posted: r.posted, skipped: r.skipped },
      }),
    )
  } catch (e) {
    console.error('[redraft/waiver-process] rookie order round notices failed', e)
    rookieOrderRounds = { error: e instanceof Error ? e.message : String(e) }
  }

  /*
   * IR auto-move (lib/ir-activation): AF Commissioner. An activated player on IR goes to the bench
   * through the ordinary lineup save, or the manager is told why not. Hourly because designations land
   * on the injury sync's schedule; guarded and on its own job identity, like the sweeps above.
   */
  let irAutoMove: IrAutoMoveRunResult | { error: string } | null = null
  try {
    const { runIrAutoMove } = await import('@/lib/ir-activation/irAutoMoveService')
    irAutoMove = await withSyncJobRun(
      { jobName: 'cron-ir-auto-move', trigger: 'cron' },
      () => runIrAutoMove(),
      (r) => ({
        rowsRead: r.teams,
        rowsWritten: r.moved + r.notified,
        errors: r.failures.map((f) => `${f.leagueId}${f.rosterId ? `/${f.rosterId}` : ''}: ${f.error}`),
        metadata: { leagues: r.leagues, moved: r.moved, notified: r.notified, skipped: r.skipped },
      }),
    )
  } catch (e) {
    console.error('[redraft/waiver-process] IR auto-move failed', e)
    irAutoMove = { error: e instanceof Error ? e.message : String(e) }
  }

  /*
   * Orphan team auctions (lib/orphan-auction): AF Commissioner. Every auction whose closing time has
   * passed is awarded — players, picks and FAAB move in one transaction. Hourly, so an auction closes
   * within the hour of its deadline; guarded and on its own job identity, like the sweeps above.
   */
  let orphanAuctions: OrphanAuctionRunResult | { error: string } | null = null
  try {
    const { runOrphanAuctionClose } = await import('@/lib/orphan-auction/orphanAuctionService')
    orphanAuctions = await withSyncJobRun(
      { jobName: 'cron-orphan-auction-close', trigger: 'cron' },
      () => runOrphanAuctionClose(),
      (r) => ({
        rowsRead: r.leagues,
        rowsWritten: r.closed,
        errors: r.failures.map((f) => `${f.leagueId}: ${f.error}`),
        metadata: { leagues: r.leagues, closed: r.closed },
      }),
    )
  } catch (e) {
    console.error('[redraft/waiver-process] orphan auction close failed', e)
    orphanAuctions = { error: e instanceof Error ? e.message : String(e) }
  }

  /*
   * Taxi stealing (lib/taxi/taxiStealing.ts): AF Commissioner. Every claim whose protection window has
   * closed is resolved — the player moves to the claiming team, or the claim ends if they left the
   * taxi squad. Hourly, so a steal lands within the hour of its deadline; on its own job identity.
   */
  let taxiSteals: TaxiStealRunResult | { error: string } | null = null
  try {
    const { runTaxiStealResolution } = await import('@/lib/taxi/taxiStealingService')
    taxiSteals = await withSyncJobRun(
      { jobName: 'cron-taxi-steal-resolve', trigger: 'cron' },
      () => runTaxiStealResolution(),
      (r) => ({
        rowsRead: r.leagues,
        rowsWritten: r.stolen + r.voided,
        errors: r.failures.map((f) => `${f.leagueId}${f.claimId ? `/${f.claimId}` : ''}: ${f.error}`),
        metadata: { leagues: r.leagues, stolen: r.stolen, voided: r.voided },
      }),
    )
  } catch (e) {
    console.error('[redraft/waiver-process] taxi steal resolution failed', e)
    taxiSteals = { error: e instanceof Error ? e.message : String(e) }
  }

  const out = await withSyncJobRun(
    { jobName: JOB, trigger: 'cron' },
    () => processDueWaiverWindows(),
    (r) => ({
      rowsRead: r.results.length,
      metadata: { seasonsProcessed: r.results.length },
    }),
  )

  // The native Exile pool has its own roster snapshots. Reuse the waiver heartbeat, with
  // independent telemetry and failure isolation; a late stat feed must not delay roster release.
  let exileRollover: unknown
  try {
    const { runExileRosterRollover } = await import('@/lib/survivor/survivorExileRollover')
    exileRollover = await withSyncJobRun(
      { jobName: 'cron-survivor-exile-rosters', trigger: 'cron' },
      () => runExileRosterRollover(),
      r => ({ rowsRead: r.processed, rowsWritten: r.released + r.scored,
        status: r.errors.length ? 'partial' : 'success', metadata: { pending: r.pending },
        errors: r.errors.map(e => `${e.leagueId}: ${e.error}`) }),
    )
  } catch (error) {
    exileRollover = { error: error instanceof Error ? error.message : 'Exile rollover failed.' }
  }

  return NextResponse.json({ ...out, tradeExpiry, deadlineExpiry, tradeReviews, autoHandovers, inactiveLineups, autoBenchByes, fillEmptyStarters, taxiDeadlines, automationRecaps, autopilotWaivers, eliminatedLineups, rookieOrderRounds, irAutoMove, orphanAuctions, taxiSteals, exileRollover })
}
