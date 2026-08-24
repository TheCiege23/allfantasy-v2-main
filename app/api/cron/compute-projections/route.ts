/**
 * GET/POST /api/cron/compute-projections
 *
 * Phase 2 of the AF Projections Engine: FantasyStatLine (+ weekly logs, depth charts,
 * injuries) -> AFProjectionSnapshot. Runs after import-stat-lines, which supplies the base.
 *
 * Optional query params:
 *   sport         — "NFL" (default)
 *   sourceSeason  — season to read production from (default: newest present)
 *   targetSeason  — season the projection applies to (default: sourceSeason + 1)
 *   format        — ppr | half_ppr | std (default: ppr)
 *   idpPreset     — balanced | tackle_heavy | big_play_heavy (default: balanced)
 *   dryRun        — 1 to compute and report without writing
 *
 * FAILS LOUDLY, same policy as import-stat-lines / import-projections: zero rows written
 * returns ok:false + HTTP 500. A projection job that reports success while writing nothing
 * is the exact failure this engine was built to end.
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { requireCronAuth } from '@/app/api/cron/_auth'
import {
  writeAfProjectionSnapshots,
  type WriteSnapshotsResult,
} from '@/lib/af-projections/writeAfProjectionSnapshots'
import type { ScoringFormat } from '@/lib/af-projections/types'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Above this share of refusals the run is FAILED even though rows were written. Refusing is
 * healthy behaviour — measured baseline is ~15% (251 insufficient_sample + 34 no_scoring_basis
 * of 1,933) — but a sudden jump means an upstream input vanished, and a partial write that
 * reports success would hide it.
 */
const REFUSAL_RATE_FAILURE_THRESHOLD = 0.4

const VALID_FORMATS: ScoringFormat[] = ['ppr', 'half_ppr', 'std']

/**
 * Heartbeat identity in `sync_job_runs`. Must stay in step with PROBES in
 * scripts/cron-freshness-check.mjs -- renaming it here without renaming it there makes the
 * freshness monitor report CONFIG ("no rows for job_name") forever.
 */
const JOB = 'cron-compute-projections'

/**
 * The run’s verdict, derived in ONE place so the HTTP response and the sync_job_runs row can
 * never disagree about whether the run was healthy.
 */
function assess(r: WriteSnapshotsResult) {
  const considered = r.written + r.refused
  const refusalRate = considered > 0 ? r.refused / considered : 1
  const zeroRows = r.written === 0
  const tooManyRefusals = refusalRate > REFUSAL_RATE_FAILURE_THRESHOLD

  /*
   * ONE CARVE-OUT: the source season has not been played yet.
   *
   * This job projects targetSeason from sourceSeason, and in the months before a season starts
   * EVERY player refuses with `no_games_played` — there is no game data to project from. That is
   * the calendar, not a fault, and it made the cron 500 every day through the offseason. An
   * hourly-or-daily red for a condition that resolves itself in September is a red nobody reads
   * by the time it means something.
   *
   * DELIBERATELY NARROW, and it does not weaken the threshold above. The check exists to catch
   * "an upstream input vanished" (see REFUSAL_RATE_FAILURE_THRESHOLD), and that is still exactly
   * what it does: this only exempts the case where zero rows were written AND every single
   * refusal is `no_games_played`. Any other reason in the map — insufficient_sample,
   * no_scoring_basis, anything new — means real data existed and the engine rejected it, which
   * still fails. So does a mix, because a mix means some players DID have games.
   */
  const reasons = Object.keys(r.refusalsByReason ?? {})
  const noSourceSeasonYet =
    zeroRows && r.refused > 0 && reasons.length === 1 && reasons[0] === 'no_games_played'

  const failed = (zeroRows || tooManyRefusals) && !noSourceSeasonYet
  return { refusalRate, zeroRows, tooManyRefusals, noSourceSeasonYet, failed }
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sport = (url.searchParams.get('sport') ?? 'NFL').toUpperCase()
  const formatParam = (url.searchParams.get('format') ?? 'ppr').toLowerCase()
  const scoringFormat = (VALID_FORMATS as string[]).includes(formatParam)
    ? (formatParam as ScoringFormat)
    : 'ppr'
  const idpPreset = url.searchParams.get('idpPreset') ?? 'balanced'
  const dryRun = ['1', 'true', 'yes'].includes((url.searchParams.get('dryRun') ?? '').toLowerCase())

  const num = (key: string): number | undefined => {
    const raw = url.searchParams.get(key)
    return raw && /^\d{4}$/.test(raw) ? Number(raw) : undefined
  }

  const startedAt = Date.now()
  try {
    const run = () =>
      writeAfProjectionSnapshots({
        sport,
        sourceSeason: num('sourceSeason'),
        targetSeason: num('targetSeason'),
        scoringFormat,
        idpPreset,
        dryRun,
      })

    /*
     * HEARTBEAT -- and the reason the freshness monitor probes this job by heartbeat rather than
     * by output. `withSyncJobRun` writes its sync_job_runs row BEFORE the body runs, so the row
     * lands on every outcome, the offseason no-op below included. That no-op correctly writes no
     * snapshot and so leaves no trace at all in AFProjectionSnapshot, which means an output probe
     * on that table reports a perfectly healthy job as STALE from February to September (see
     * PROBES in scripts/cron-freshness-check.mjs).
     *
     * A dry run records NOTHING, deliberately: the probe matches on job_name alone, so a row
     * written by a hand-issued smoke test would be indistinguishable from a scheduled fire and
     * could hide a dead scheduler.
     */
    const r = dryRun
      ? await run()
      : await withSyncJobRun({ jobName: JOB, trigger: 'cron', sport }, run, (result) => {
          const v = assess(result)
          return {
            rowsRead: result.statLinesRead,
            rowsWritten: result.written,
            rowsSkipped: result.refused,
            // Set explicitly so the offseason no-op is not inferred as a failure from `errors`.
            status: v.failed ? 'failed' : 'success',
            errors: result.errors.slice(0, 10),
            metadata: {
              sourceSeason: result.sourceSeason,
              targetSeason: result.targetSeason,
              refusalRate: Number(v.refusalRate.toFixed(4)),
              refusalsByReason: result.refusalsByReason,
              noSourceSeasonYet: v.noSourceSeasonYet,
            },
          }
        })

    const { refusalRate, zeroRows, tooManyRefusals, noSourceSeasonYet, failed } = assess(r)

    return NextResponse.json(
      {
        // `ok` reports whether PROJECTIONS LANDED; `failed` drives the HTTP status and means
        // "retry this". They come apart only when the source season has not been played: ok:false
        // because nothing was written and claiming otherwise would be a false green, HTTP 200
        // because no retry can conjure games that have not happened.
        ok: !failed && !noSourceSeasonYet,
        sport,
        dryRun,
        sourceSeason: r.sourceSeason,
        targetSeason: r.targetSeason,
        scoringFormat: r.scoringFormat,
        idpPreset: r.idpPreset,
        statLinesRead: r.statLinesRead,
        written: r.written,
        refused: r.refused,
        refusalRate: Number(refusalRate.toFixed(4)),
        refusalRateThreshold: REFUSAL_RATE_FAILURE_THRESHOLD,
        refusalsByReason: r.refusalsByReason,
        basisCounts: r.basisCounts,
        confidenceCounts: r.confidenceCounts,
        /** Projections carrying the measured (estimated) solo/assist tackle split. */
        usedTackleSplitEstimate: r.usedTackleSplitEstimate,
        /** No sleeperId mapped, so weekly logs were unreachable — expect ~47% for NFL. */
        withoutWeeklyData: r.withoutWeeklyData,
        /**
         * Reported even when the run is not a failure, because a coverage gap that leaves no trace
         * is how the last outage stayed invisible for six days. `ok:false` with HTTP 200 says
         * "nothing was produced, and retrying will not change that until the season starts".
         */
        failureReason: noSourceSeasonYet
          ? 'source_season_not_played_yet'
          : zeroRows
            ? 'zero_rows_written'
            : tooManyRefusals
              ? 'refusal_rate_above_threshold'
              : undefined,
        errors: r.errors.length ? r.errors.slice(0, 10) : undefined,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: failed ? 500 : 200 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/compute-projections] failed:', message)
    return NextResponse.json(
      { ok: false, sport, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle(req)
}
