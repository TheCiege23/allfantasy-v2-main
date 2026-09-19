import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { prisma } from "@/lib/prisma"
import {
  refreshPlayoffScheduleMetadataForChallenge,
  syncPlayoffChallengeSeries,
} from "@/lib/playoffs/playoffSeriesSyncService"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"
import { redactSecrets } from "@/lib/security/redactSecrets"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Heartbeat job name, probed by scripts/cron-freshness-check.mjs.
 *
 * This job is CONDITIONAL and its output is SHARED: it only acts during the NBA/NHL playoffs,
 * and what it writes lands in SportsGame, which import-scores refreshes every two minutes — so
 * an output probe would read as fresh year-round no matter what this job did. A per-fire run
 * row is the only honest signal, including the (usual) fires that find no active challenge.
 *
 * ⚠ THE JOB NAME IS DELIBERATELY UNCHANGED NOW THAT IT ALSO SYNCS RESULTS. It is
 * matched by string in scripts/cron-freshness-check.mjs PROBES and asserted in
 * __tests__/cron-heartbeat-route-contracts.test.ts; renaming it to something
 * like `cron-playoff-sync` would silently orphan the freshness alarm, which is
 * the precise failure that test exists to prevent. The phase breakdown lives in
 * the run row's metadata instead.
 */
const JOB = "cron-playoff-schedule-refresh"

const booleanLike = z.preprocess((value) => {
  if (typeof value === "string") return value === "true" || value === "1"
  return value
}, z.boolean())

const querySchema = z.object({
  sport: z.enum(["all", "nba", "nhl"]).optional().default("all"),
  provider: z.enum(["espn"]).optional().default("espn"),
  windowDays: z.coerce.number().int().min(1).max(14).optional().default(7),
  dryRun: booleanLike.optional().default(false),
  /*
   * `results` is the phase that actually advances a bracket. It rides this job
   * rather than owning a route, per the standing no-new-routes rule, and rather
   * than owning a second cron slot: the registry is AT its ceiling of 60.
   *
   * ⚠ THE COST OF SHARING THE FIRE IS CADENCE, AND IT IS A REAL LIMITATION.
   * This job is scheduled `0 16-19 * * *` (12:00-15:00 ET), so a series that
   * ends late at night is picked up around midday. That is a large improvement
   * on the status quo — nothing advanced a bracket at all — but it is not
   * good enough for a live World Series. Moving it to an evenly spread cadence
   * is a one-line registry change once a cron slot is free.
   */
  job: z.enum(["all", "schedule", "results"]).optional().default("all"),
})

/**
 * How recent a bracket's own schedule must be for the sweep to touch it.
 *
 * 🛑 THIS BOUND IS NOT AN OPTIMISATION — IT STOPS ACTIVE CORRUPTION. Without it
 * the selector matched on challenge `status` alone, and `status` is never
 * advanced past "open" by anything: all 26 production pools from the 2026
 * NBA/NHL postseasons were still being swept daily in September. Measured
 * 2026-09-19, that had already written NHL PRESEASON games onto finished April
 * playoff series — a first-round series that began 2026-04-18 carrying
 * `next_game_at = 2026-09-24` with that preseason game's venue and broadcast.
 *
 * Cosmetic while only schedule metadata was being written. Not cosmetic once a
 * RESULTS phase reads the same matched games, which is what this change adds:
 * an unbounded sweep would start setting series winners from preseason.
 *
 * 60 days comfortably spans a postseason (MLB ~1 month, NBA/NHL ~2) while
 * excluding a finished one.
 */
const ACTIVE_WINDOW_DAYS = 60

/**
 * Wall-clock budget for the results phase, under the route's `maxDuration = 60`.
 * Work stops being STARTED past this point; whatever is left is reported as
 * skipped rather than silently dropped.
 */
const RESULTS_BUDGET_MS = 40_000

/**
 * Where in the list this fire starts, so a budget cut-off does not starve the
 * same tail forever.
 *
 * ⚠ A STABLE ORDER PLUS A BUDGET IS A STARVATION BUG, not a safe default. The
 * sweep is ordered `updatedAt desc`, so without rotation the challenges past
 * the cut-off would be the SAME ones on every fire and would never sync at
 * all — the failure would be invisible, because the job reports success and
 * the starved pools simply never advance.
 *
 * Rotating by the hour walks the window forward one place per fire, so with
 * four fires a day every challenge reaches the front within a few days even in
 * the worst case. It is deliberately not a persisted cursor: a cursor is the
 * right answer if `resultsSkippedForBudget` is ever routinely non-zero, and
 * building one before that is measured would be guessing at the shape.
 */
function rotateForFairness<T>(items: T[], now = new Date()): T[] {
  if (items.length < 2) return items
  const offset = now.getUTCHours() % items.length
  return [...items.slice(offset), ...items.slice(0, offset)]
}

function isPlayoffCronAuthorized(request: NextRequest) {
  return requireCronAuth(request, "CRON_SECRET")
}

async function getActivePlayoffChallengeIds(sport: "all" | "nba" | "nhl") {
  const sports = sport === "all" ? ["nba", "nhl"] : [sport]
  const activeSince = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const rows = await (prisma as any).playoffBracketChallenge.findMany({
    where: {
      sport: { in: sports },
      status: { in: ["open", "locked", "live"] },
      /*
       * "Active" cannot be read off `status` — see ACTIVE_WINDOW_DAYS. It is
       * read off the bracket's own schedule instead:
       *
       *   - some series starts inside the window  → the postseason is current;
       *   - every series has NO start date at all → the pool was just created
       *     and is waiting for its first schedule sync, so it must be swept or
       *     it can never get one.
       *
       * ⚠ THE SECOND ARM NEEDS THE FRESHNESS TEST, AND THIS WAS MEASURED.
       * 10 of the 26 dead production pools have every `startsAt` null (198
       * such series in total) because they were created and never successfully
       * synced. On the never-scheduled arm alone they would be swept forever.
       * `updatedAt` is the right companion because nothing in the sync path
       * writes the challenge row — it still means "a human last touched this".
       */
      OR: [
        { series: { some: { startsAt: { gte: activeSince } } } },
        {
          AND: [
            { series: { every: { startsAt: null } } },
            { updatedAt: { gte: activeSince } },
          ],
        },
      ],
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  })
  return rows.map((row: { id: string }) => row.id)
}

/**
 * Delegates to the shared redactor. This used to cover only `Bearer` and `key=`, which misses
 * `RSC_token=` — and this message is returned to the CALLER, not just logged.
 */
function sanitizeErrorMessage(error: unknown) {
  return redactSecrets(error)
}

type RefreshInput = z.infer<typeof querySchema>

/**
 * The sweep across every active challenge, as plain totals, so the scheduled path can be
 * wrapped in telemetry without changing the response body a byte.
 */
async function refreshActiveChallenges(input: RefreshInput) {
  const challengeIds = await getActivePlayoffChallengeIds(input.sport)
  const warnings: string[] = []
  let updatedSeries = 0
  let scheduleGamesSeen = 0
  let scheduleGamesMatched = 0
  let liveGamesMatched = 0
  let broadcastFieldsFound = 0
  let venueFieldsFound = 0

  if (input.job !== "results") {
    for (const challengeId of challengeIds) {
      const result = await refreshPlayoffScheduleMetadataForChallenge({
        challengeId,
        provider: input.provider,
        windowDays: input.windowDays,
        dryRun: input.dryRun,
      })
      updatedSeries += result.updatedSeries
      scheduleGamesSeen += result.scheduleGamesSeen
      scheduleGamesMatched += result.scheduleGamesMatched
      liveGamesMatched += result.liveGamesMatched
      broadcastFieldsFound += result.broadcastFieldsFound
      venueFieldsFound += result.venueFieldsFound
      warnings.push(...result.warnings.map((warning) => `${challengeId}: ${warning}`))
    }
  }

  /*
   * ── RESULTS ──────────────────────────────────────────────────────────────
   *
   * The phase that advances a bracket. Nothing scheduled did this before, for
   * ANY sport: `syncPlayoffChallengeSeries` had exactly one caller, a manual
   * admin POST, so a live pool stayed frozen unless a human pressed a button.
   *
   * 🛑 `results_only` IS THE ONLY MODE THIS MAY RUN, AND NOT FOR TIDINESS.
   * The service's default is `official_bracket`, which REWRITES team names
   * from the provider (`shouldUpdateOfficialTeams = !resultsOnly`). Letting a
   * cron do bracket discovery unattended would let one bad provider match
   * rename a series people have already picked. `results_only` sets winners,
   * wins and status and leaves the matchup alone — which is also why the
   * route's existing "no series discovery" contract is preserved rather than
   * dropped.
   *
   * ⚠ A DRY RUN MUST NOT REACH IT. `syncPlayoffChallengeSeries` has no dryRun
   * parameter and always writes, so the guard is the caller's job.
   */
  const runResults = input.job !== "schedule" && !input.dryRun
  const resultsStartedAt = Date.now()
  const resultsErrors: string[] = []
  const resultsSkippedForBudget: string[] = []
  let resultsChallengesSynced = 0
  let resultsSeriesUpdated = 0
  let winnersUpdated = 0

  if (runResults) {
    for (const challengeId of rotateForFairness(challengeIds)) {
      if (Date.now() - resultsStartedAt > RESULTS_BUDGET_MS) {
        resultsSkippedForBudget.push(challengeId)
        continue
      }
      /*
       * Per-challenge isolation: one pool whose provider match fails must not
       * cost every later pool its results. The sweep already does this for the
       * schedule phase by collecting warnings instead of throwing.
       */
      try {
        const result = await syncPlayoffChallengeSeries({
          challengeId,
          providerPreference: input.provider,
          mode: "results_only",
        })
        resultsChallengesSynced += 1
        resultsSeriesUpdated += result.seriesUpdated ?? 0
        winnersUpdated += result.winnersUpdated ?? 0
        warnings.push(...(result.warnings ?? []).map((warning) => `${challengeId} (results): ${warning}`))
      } catch (error) {
        resultsErrors.push(`${challengeId}: ${redactSecrets(error)}`)
      }
    }
  }

  return {
    challengeIds,
    warnings,
    updatedSeries,
    scheduleGamesSeen,
    scheduleGamesMatched,
    liveGamesMatched,
    broadcastFieldsFound,
    venueFieldsFound,
    resultsRan: runResults,
    resultsChallengesSynced,
    resultsSeriesUpdated,
    winnersUpdated,
    resultsSkippedForBudget,
    resultsErrors,
  }
}

export async function GET(request: NextRequest) {
  if (!isPlayoffCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  const input = parsed.data
  const syncedAt = new Date().toISOString()

  try {
    const sweep = () => refreshActiveChallenges(input)
    /*
     * A dry run changes nothing and is only ever issued by hand, so it deliberately records no
     * heartbeat: the probe matches on job_name alone, and a row written here would make a
     * manual check indistinguishable from a scheduled fire.
     *
     * Every real fire records one. The row is written before the sweep starts, so a playoff-less
     * night with no active challenge still counts as a run — as does one the platform kills at
     * maxDuration, after which no user code runs to close the row and only started_at survives.
     */
    const {
      challengeIds,
      warnings,
      updatedSeries,
      scheduleGamesSeen,
      scheduleGamesMatched,
      liveGamesMatched,
      broadcastFieldsFound,
      venueFieldsFound,
      resultsRan,
      resultsChallengesSynced,
      resultsSeriesUpdated,
      winnersUpdated,
      resultsSkippedForBudget,
      resultsErrors,
    } = input.dryRun
      ? await sweep()
      : await withSyncJobRun(
          { jobName: JOB, trigger: "cron", sport: input.sport, provider: input.provider },
          sweep,
          (r) => ({
            rowsRead: r.scheduleGamesSeen,
            rowsWritten: r.updatedSeries + r.resultsSeriesUpdated,
            rowsSkipped: r.scheduleGamesSeen - r.scheduleGamesMatched,
            /*
             * Per-challenge warnings are collected, not thrown — the sweep still completed.
             * A results phase that THREW for a challenge is also partial rather than a
             * failure, for the same reason: the other challenges were still served, and
             * a hard failure here would red the whole job over one bad provider match.
             */
            status: r.warnings.length > 0 || r.resultsErrors.length > 0 ? "partial" : "success",
            warnings: [...r.warnings, ...r.resultsErrors].slice(0, 25),
            metadata: {
              challengeCount: r.challengeIds.length,
              updatedSeries: r.updatedSeries,
              scheduleGamesMatched: r.scheduleGamesMatched,
              liveGamesMatched: r.liveGamesMatched,
              resultsRan: r.resultsRan,
              resultsChallengesSynced: r.resultsChallengesSynced,
              resultsSeriesUpdated: r.resultsSeriesUpdated,
              // The number that says a bracket actually moved.
              winnersUpdated: r.winnersUpdated,
              // Non-zero means the 60s budget is too tight for the live field
              // and this needs a real drain cursor, not a bigger number.
              resultsSkippedForBudget: r.resultsSkippedForBudget.length,
            },
          }),
        )

    return NextResponse.json({
      ok: true,
      job: "playoff_schedule_refresh",
      sport: input.sport,
      provider: input.provider,
      challengeCount: challengeIds.length,
      updatedSeries,
      scheduleGamesSeen,
      scheduleGamesMatched,
      liveGamesMatched,
      broadcastFieldsFound,
      venueFieldsFound,
      warnings,
      dryRun: input.dryRun,
      windowDays: input.windowDays,
      // Additive only — the existing body shape is a contract other callers read.
      jobPhase: input.job,
      resultsRan,
      resultsChallengesSynced,
      resultsSeriesUpdated,
      winnersUpdated,
      resultsSkippedForBudget,
      resultsErrors,
      syncedAt,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        job: "playoff_schedule_refresh",
        sport: input.sport,
        provider: input.provider,
        error: "playoff_schedule_refresh_failed",
        message: sanitizeErrorMessage(error),
        syncedAt,
      },
      { status: 500 }
    )
  }
}
