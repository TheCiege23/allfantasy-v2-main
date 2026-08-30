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
import { createRunBudget, rotateForFairness } from '@/lib/cron/runBudget'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
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

/**
 * Compute and persist projections for ONE sport.
 *
 * Extracted from `handle` so the route can iterate every sport without duplicating the assessment
 * and telemetry logic — the two things that must never disagree about whether a run was healthy.
 *
 * @param sportExplicit true when the caller named this sport via `?sport=`. Gates `?week=`, which
 *   is meaningless across a rotation — see the note on the week parsing below.
 */
async function runOneSport(
  url: URL,
  sport: string,
  sportExplicit: boolean,
): Promise<{ body: Record<string, unknown>; failed: boolean }> {
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

  // Optional explicit week (1-18). When present it also forces weekly snapshot rows — the
  // manual backfill path; scheduled runs let the writer resolve the week from Sleeper state.
  const weekRaw = url.searchParams.get('week')
  const parsedWeek = weekRaw && /^\d{1,2}$/.test(weekRaw) ? Number(weekRaw) : undefined
  const requestedWeek = parsedWeek != null && parsedWeek >= 1 && parsedWeek <= 18 ? parsedWeek : undefined

  /*
   * ⚠ A BARE `?week=` FANS OUT ACROSS EVERY SPORT, AND A WEEK NUMBER IS NOT SPORT-NEUTRAL.
   *
   * Omitting `?sport=` runs the whole rotation, and `handle()` passes each sport the SAME `url`
   * object — so `?week=3` alone stamped week 3 onto NCAAF, NCAAB, NBA, NHL and MLB rows using a
   * number that only ever meant the NFL's week. College weeks do not line up with NFL weeks, and
   * the other codes have no football week at all. Not hypothetical: the header on `handle()`
   * records that NCAAF's existing AFProjectionSnapshot rows came from "a manual backfill", which
   * is this path.
   *
   * A DELIBERATE, SCOPED BACKFILL IS STILL ALLOWED — `?sport=NCAAF&week=3` names both halves and
   * is an operator saying what they mean. What is refused is the UNSCOPED form, where the week
   * reaches sports the caller never mentioned.
   *
   * ⚠ THE AUTOMATIC PATH WAS NEVER EXPOSED, and this is worth recording because it was reported
   * as the bug. `writeAfProjectionSnapshots` gates its Sleeper season-state lookup on
   * `sport === 'NFL'` (line ~120), so `inRegularSeason` stays null for every other sport and
   * `writeWeekly` stays false regardless of what the NFL calendar does. Only this hand-run
   * override could ever cross sports, which is why the guard belongs here and not there.
   */
  const weekApplies = requestedWeek != null && sportExplicit
  const targetWeek = weekApplies ? requestedWeek : undefined
  const weekIgnoredReason =
    requestedWeek != null && !weekApplies
      ? `week=${requestedWeek} ignored: a week number is sport-specific, and no ?sport= was given. ` +
        `Re-run as ?sport=${sport}&week=${requestedWeek} if that is what you meant.`
      : null

  const startedAt = Date.now()
  try {
    const run = () =>
      writeAfProjectionSnapshots({
        sport,
        sourceSeason: num('sourceSeason'),
        targetSeason: num('targetSeason'),
        scoringFormat,
        idpPreset,
        targetWeek,
        ...(targetWeek != null ? { writeWeeklySnapshots: true } : {}),
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
              weeklyWritten: result.weeklyWritten ?? 0,
              weeklyWeek: result.weeklyWeek ?? null,
              mirroredProjections: result.mirroredProjections ?? 0,
            },
          }
        })

    const { refusalRate, zeroRows, tooManyRefusals, noSourceSeasonYet, failed } = assess(r)

    return {
      failed,
      body: {
        // `ok` reports whether PROJECTIONS LANDED; `failed` drives the HTTP status and means
        // "retry this". They come apart only when the source season has not been played: ok:false
        // because nothing was written and claiming otherwise would be a false green, HTTP 200
        // because no retry can conjure games that have not happened.
        ok: !failed && !noSourceSeasonYet,
        sport,
        dryRun,
        /**
         * Present only when a `?week=` was supplied but dropped because the run was unscoped.
         * Reported rather than swallowed: an operator who asked for a weekly backfill and
         * silently got a season baseline would reasonably believe the backfill happened.
         */
        ...(weekIgnoredReason ? { weekIgnored: weekIgnoredReason } : {}),
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
        /** Week-scoped rows written alongside the season baseline (regular season only). */
        weeklyWritten: r.weeklyWritten,
        weeklyWeek: r.weeklyWeek,
        weeklySkippedReason: r.weeklySkippedReason ?? undefined,
        /** AF weekly numbers mirrored into FantasyProjection as source='allfantasy'. */
        mirroredProjections: r.mirroredProjections,
        mirrorSkippedNoSleeperId: r.mirrorSkippedNoSleeperId,
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
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    /*
     * "no fantasy_stat_lines found for sport=X" is the writer's own precondition, not a fault.
     *
     * It is thrown for a sport whose stat-line base has not been ingested yet — which for five of
     * the seven sports is the CURRENT state, because `PlayerIdentityMap` was NFL-only until the
     * multi-sport backfill in import-stat-lines started filling it. Reporting that as a 500 every
     * night would make this cron permanently red for reasons the operator cannot act on, and it
     * would drown the one sport that IS genuinely broken. `ok:false` keeps it honest; HTTP 200
     * says "no retry will help until the base exists".
     */
    const awaitingBase = /no fantasy_stat_lines found for sport=/i.test(message)
    if (awaitingBase) {
      console.warn(`[cron/compute-projections] ${sport}: awaiting stat-line base`)
      return {
        failed: false,
        body: {
          ok: false,
          sport,
          written: 0,
          failureReason: 'awaiting_stat_line_base',
          note: 'import-stat-lines has not yet written fantasy_stat_lines for this sport',
          durationMs: Date.now() - startedAt,
        },
      }
    }

    console.error(`[cron/compute-projections] ${sport} failed:`, message)
    return {
      failed: true,
      body: { ok: false, sport, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
    }
  }
}

/**
 * ⚠ OMITTING `sport` NOW RUNS EVERY SPORT.
 *
 * This route projected NFL and nothing else, so `AFProjectionSnapshot` held rows for exactly two
 * sports (NFL 1,576 and NCAAF 4,528, the latter written by a manual backfill) while five others
 * had none — even though the stat-line pipeline underneath is sport-parameterised and always was.
 * An explicit `?sport=` still runs exactly that one and returns the original single-sport
 * response, because admin and manual callers pass it.
 */
async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const explicit = url.searchParams.get('sport')

  if (explicit) {
    const one = await runOneSport(url, explicit.toUpperCase(), true)
    return NextResponse.json(one.body, { status: one.failed ? 500 : 200 })
  }

  /*
   * Rotated and budgeted for the same reason every other multi-sport cron here is: the loop is
   * sequential, each sport reads its whole stat-line base, and a fixed order against a platform
   * ceiling means the tail is never reached rather than merely late.
   */
  const budget = createRunBudget()
  const results: Array<{ body: Record<string, unknown>; failed: boolean }> = []
  const deferred: string[] = []

  for (const sport of rotateForFairness(SUPPORTED_SPORTS.map((s) => String(s)))) {
    if (budget.exhausted()) {
      deferred.push(sport)
      continue
    }
    results.push(await runOneSport(url, sport, false))
  }

  const anyFailed = results.some((r) => r.failed)
  return NextResponse.json(
    {
      ok: !anyFailed,
      sports: results.map((r) => r.body),
      deferredForBudget: deferred.length ? deferred : undefined,
      timestamp: new Date().toISOString(),
    },
    { status: anyFailed ? 500 : 200 },
  )
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
