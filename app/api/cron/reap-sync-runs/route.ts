import {maintainDraftResults} from '@/lib/draft-archive/ingestion/maintenance'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { requireCronAuth } from '../_auth'
import { purgeExpiredCache } from '@/lib/enrichment-cache'
import { refreshPrivateRelayRanges } from '@/lib/geo/privateRelayIngest'
import { prisma } from '@/lib/prisma'
import { reapAllAbandonedRuns, recordSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { runTradeAgentPass, type TradeAgentPassResult } from '@/lib/decision-os/trade/tradeAgentPass'
import { runComprehensiveBackgroundAnalysis, type TradeLearningPassResult } from '@/lib/comprehensive-trade-learning'
import { runTradeCalibrationPass, type TradeCalibrationPassResult } from '@/lib/trade-engine/calibrationPass'
import {
  runRelationshipRefreshPass,
  type RelationshipRefreshPassResult,
} from '@/lib/relationship-insights/relationshipRefreshPass'

/**
 * Heartbeat identity, read by PROBES in scripts/cron-freshness-check.mjs.
 *
 * ⚠ RECORDED WITH `recordSyncJobRun`, NEVER `withSyncJobRun`, AND THE DISTINCTION IS THE WHOLE
 * REASON THIS IS SAFE. The note below rules out `withSyncJobRun` because it calls `startRun`
 * first and `finishRun` later, so a sweep killed in between leaves behind the exact `running`
 * row this route exists to remove — a reaper that can orphan itself. `recordSyncJobRun` writes a
 * SINGLE already-terminal row, with startedAt and completedAt both set in one insert. There is no
 * window in which it can leave a `running` row, so the objection does not reach it.
 *
 * Worth having because the alternative was no monitoring at all: this sweep is what restores the
 * failed → very-stale escalation for every job that will never fire again, so a reaper that
 * silently stops firing takes the whole board's escalation with it and nothing says so.
 */
const JOB = 'cron-reap-sync-runs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/*
 * 300, not 30, only for the nightly trade-agent pass below: the reap and the purge are unchanged and
 * still finish in seconds. Outside 03:00–10:59 UTC the pass returns at once and so does the route.
 */
export const maxDuration = 300

/** The trade-agent pass stops by here, leaving the platform's 300s kill well clear. */
const ROUTE_BUDGET_MS = 240_000
/** Below this, the trade-learning pass is skipped for the hour rather than run too short to finish a batch. */
const LEARNING_MIN_BUDGET_MS = 20_000
/** Below this, the calibration pass waits for the next hour; each of its steps is a bounded read. */
const CALIBRATION_MIN_BUDGET_MS = 10_000
/** Below this, the rivalry/drama refresh waits for the next hour; one league is a few bounded reads. */
const RELATIONSHIP_MIN_BUDGET_MS = 10_000

/**
 * GET /api/cron/reap-sync-runs
 *
 * Marks `SyncJobRun` rows stuck in `running` as `failed`, across every job name, then deletes a
 * bounded batch of expired `SportsDataCache` rows (see the note at the purge below).
 *
 * WHY THIS EXISTS. `withSyncJobRun` already reaps abandoned rows, but only for the job that is
 * firing, at the moment it fires. So a job self-heals exactly as long as it keeps running — and
 * the job that stopped running is the one whose telemetry is worth trusting. Its last row stays
 * `running` forever, and `computeJobHealth` checks `runningTooLong` BEFORE its freshness
 * branches, so the deadest job on the board reports amber "appears stuck" instead of escalating
 * to red. Worse, for the first `stuckAfterH` (2h) after each fire it reports healthy outright, so
 * a job that dies nightly looks green every morning.
 *
 * This sweep restores the normal failed → very-stale escalation for jobs that will never fire
 * again. It is the piece that could not be built while the repo sat at Vercel's 2048-route
 * ceiling under a standing no-new-routes rule; production moved to Railway on 2026-09-02 and the
 * rule was retired on 2026-09-05.
 *
 * DELIBERATELY NOT WRAPPED IN `withSyncJobRun`. The reaper is the thing that cleans up orphaned
 * `running` rows; instrumenting it would let it create the exact row it exists to remove, and a
 * reaper that can orphan itself is worse than no reaper. Its observability is this response body
 * and the GitHub Actions run log instead.
 */
export async function GET(request: NextRequest) {
  if (!requireCronAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const { available, reaped, cutoff } = await reapAllAbandonedRuns()

  // `reaped: 0` is ambiguous on its own — it reads the same for "nothing was stale" and "the
  // model was unreachable". Report which, so a silently blind sweep cannot pass for a clean one.
  if (!available) {
    return NextResponse.json(
      {
        ok: false,
        reaped: 0,
        cutoff,
        error: 'sync-job telemetry unavailable — the sweep could not run, this is NOT a clean zero',
      },
      { status: 503 },
    )
  }

  /*
   * The second sweep: expired `SportsDataCache` rows, which nothing deleted before 2026-09-17.
   * It rides here because this is the hourly housekeeping job, and it runs only past the guard
   * above — an unreachable telemetry model means an unreachable database.
   *
   * Its outcome never changes the reaper's: a purge that could not run is reported as a warning
   * (status `partial`, which the freshness check surfaces as a caveat) and in `cachePurge`, never
   * as a failed reap. Bounded inside `purgeExpiredCache` to 10s of this route's 30s.
   */
  const cachePurge = await purgeExpiredCache(prisma)
  const purgeWarnings =
    cachePurge.available || cachePurge.error === 'disabled' ? [] : [`cache purge: ${cachePurge.error ?? 'unavailable'}`]

  /*
   * The third job: Apple's iCloud Private Relay egress ranges, which let the VPN
   * gate PLACE a relay user by state instead of refusing them
   * (lib/geo/privateRelayRanges). Called every hour, acts at most once a day —
   * see lib/geo/privateRelayIngest for why it rides here (the cron schedule is
   * at its ceiling). Like the purge, its outcome is a warning, never a failed reap;
   * a failed refresh keeps the last good set, and the stored set retires itself
   * after 30 days without one, returning relay users to "blocked".
   */
  const privateRelay = await refreshPrivateRelayRanges().catch((err: unknown) => ({
    status: 'failed' as const,
    error: String((err as Error)?.message ?? err),
    keptFetchedAt: null,
  }))
  if (privateRelay.status === 'failed') purgeWarnings.push(`private relay ranges: ${privateRelay.error}`)

  // Recorded AFTER the `available` guard above, so an unreachable telemetry model cannot write a
  // clean-looking heartbeat for a sweep that never swept. The 503 path deliberately records
  // nothing: if the model is unreachable, this insert would fail anyway.
  await recordSyncJobRun(
    { jobName: JOB, trigger: 'cron' },
    { rowsUpdated: reaped, warnings: purgeWarnings, metadata: { cutoff, cachePurge, privateRelay } },
    Date.now() - startedAt,
  )

  /*
   * The nightly trade agent rides here (design step 9, 2026-09-27) because `cron-schedule.json` is at
   * its 60-job ceiling and docs/crons.md says to extend an existing handler first. It runs AFTER the
   * heartbeat above, so it can never delay or fail the reap, and a failure is reported beside the
   * reap's result, never as one. It records its own telemetry row (`cron-trade-agent`).
   */
  const tradeAgent: TradeAgentPassResult | { ran: false; reason: string } = await runTradeAgentPass({
    budgetMs: ROUTE_BUDGET_MS - (Date.now() - startedAt),
  }).catch((error) => ({ ran: false as const, reason: error instanceof Error ? error.message.slice(0, 160) : 'the pass failed' }))

  /*
   * The trade-learning writer rides here too (2026-09-30), for the same ceiling reason, AFTER the
   * agent so it only ever gets the budget the agent left. It is the only writer of
   * `TradeLearningInsight`, which four live AI paths read and which had never been written (see
   * runComprehensiveBackgroundAnalysis). Market values only — owner's ruling. Its own telemetry row
   * (`cron-trade-learning`) makes a stalled writer visible instead of an empty context looking fine.
   */
  const learningStartedAt = Date.now()
  const learningBudgetMs = ROUTE_BUDGET_MS - (learningStartedAt - startedAt)
  const tradeLearning: TradeLearningPassResult | { ran: false; reason: string } =
    learningBudgetMs < LEARNING_MIN_BUDGET_MS
      ? { ran: false as const, reason: `only ${Math.round(learningBudgetMs / 1000)}s of budget left` }
      : await runComprehensiveBackgroundAnalysis({ budgetMs: learningBudgetMs }).catch((error) => ({
          ran: false as const,
          reason: error instanceof Error ? error.message.slice(0, 160) : 'the pass failed',
        }))
  if ('valued' in tradeLearning) {
    try {
      await recordSyncJobRun(
        { jobName: 'cron-trade-learning', trigger: 'cron' },
        {
          rowsUpdated: tradeLearning.valued + tradeLearning.refused,
          warnings: tradeLearning.error ? [tradeLearning.error] : [],
          metadata: { ...tradeLearning },
        },
        Date.now() - learningStartedAt,
      )
    } catch {
      // Telemetry for the learning pass must never fail the reap it rides.
    }
  }

  /*
   * The calibration cycle rides here last (2026-09-30): feedback calibration, drift detection and
   * the outcome-event backfill that the retired /api/internal/analyze-trades pipeline used to run
   * after valuing trades. Same trigger it had there — only when the learning pass valued something
   * or re-aggregated — so an idle hour costs nothing. Its own telemetry row (`cron-trade-calibration`)
   * carries each step's failure as a warning; none of it can fail the reap.
   */
  const calibrationStartedAt = Date.now()
  const calibrationBudgetMs = ROUTE_BUDGET_MS - (calibrationStartedAt - startedAt)
  const calibrationDue = 'valued' in tradeLearning && (tradeLearning.valued > 0 || tradeLearning.aggregated)
  const tradeCalibration: TradeCalibrationPassResult | { ran: false; reason: string } = !calibrationDue
    ? { ran: false as const, reason: 'nothing newly valued or aggregated' }
    : calibrationBudgetMs < CALIBRATION_MIN_BUDGET_MS
      ? { ran: false as const, reason: `only ${Math.round(calibrationBudgetMs / 1000)}s of budget left` }
      : await runTradeCalibrationPass({ budgetMs: calibrationBudgetMs }).catch((error) => ({
          ran: false as const,
          reason: error instanceof Error ? error.message.slice(0, 160) : 'the pass failed',
        }))
  if (tradeCalibration.ran) {
    try {
      await recordSyncJobRun(
        { jobName: 'cron-trade-calibration', trigger: 'cron' },
        {
          rowsUpdated: tradeCalibration.outcomesLogged ?? 0,
          warnings: tradeCalibration.errors,
          metadata: { ...tradeCalibration },
        },
        Date.now() - calibrationStartedAt,
      )
    } catch {
      // Telemetry for the calibration pass must never fail the reap it rides.
    }
  }

  /*
   * The rivalry + drama writer rides here last (2026-10-01). It is the ONLY scheduled writer of
   * rivalry_records and drama_events, which the commissioner storyline/rivalry feeds read — both were
   * empty in production because nothing ran it. Change-driven (only leagues whose matchup facts moved),
   * window-gated like the trade agent, and it records its own telemetry row (`cron-relationship-refresh`).
   * Gets only the budget left after everything above, so it can never delay the reap.
   */
  const relationshipBudgetMs = ROUTE_BUDGET_MS - (Date.now() - startedAt)
  const relationshipRefresh: RelationshipRefreshPassResult =
    relationshipBudgetMs < RELATIONSHIP_MIN_BUDGET_MS
      ? { ran: false as const, reason: `only ${Math.round(relationshipBudgetMs / 1000)}s of budget left` }
      : await runRelationshipRefreshPass({ budgetMs: relationshipBudgetMs }).catch((error) => ({
          ran: false as const,
          reason: error instanceof Error ? error.message.slice(0, 160) : 'the pass failed',
        }))

  // Draft archive refresh rides the existing hourly pass after all earlier work.
  // Reserve response/telemetry time and do not start a source with insufficient headroom.
  const draftStartedAt = Date.now()
  const draftBudgetMs = ROUTE_BUDGET_MS - (draftStartedAt - startedAt)
  const draftMaintenance = draftBudgetMs < 140_000
    ? { ran: false as const, reason: 'insufficient remaining maintenance budget' }
    : await maintainDraftResults(Math.min(180_000, draftBudgetMs - 30_000)).catch(() => ({
        ran: false as const, reason: 'draft maintenance failed',
      }))
  try {
    await recordSyncJobRun({jobName:'draft-analysis-maintenance',sport:'NFL',provider:'sleeper',trigger:'cron'}, {
      rowsRead:'inventory' in draftMaintenance ? draftMaintenance.inventory : 0,
      rowsWritten:'ready' in draftMaintenance ? draftMaintenance.ready + draftMaintenance.partial : 0,
      warnings:'failed' in draftMaintenance && draftMaintenance.failed ? ['Some draft sources need evidence or retry'] : 'ran' in draftMaintenance && !draftMaintenance.ran ? [draftMaintenance.reason] : [],
      metadata:{...draftMaintenance},
    },Date.now()-draftStartedAt)
  } catch {
    // Draft telemetry cannot fail the completed reap.
  }

  return NextResponse.json({
    ok: true,
    reaped,
    cutoff,
    cachePurge,
    privateRelay,
    tradeAgent,
    tradeLearning,
    tradeCalibration,
    relationshipRefresh,
    draftMaintenance,
  })
}
