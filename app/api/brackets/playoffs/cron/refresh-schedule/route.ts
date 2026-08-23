import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { prisma } from "@/lib/prisma"
import { refreshPlayoffScheduleMetadataForChallenge } from "@/lib/playoffs/playoffSeriesSyncService"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"

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
})

function isPlayoffCronAuthorized(request: NextRequest) {
  return requireCronAuth(request, "CRON_SECRET")
}

async function getActivePlayoffChallengeIds(sport: "all" | "nba" | "nhl") {
  const sports = sport === "all" ? ["nba", "nhl"] : [sport]
  const rows = await (prisma as any).playoffBracketChallenge.findMany({
    where: {
      sport: { in: sports },
      status: { in: ["open", "locked", "live"] },
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  })
  return rows.map((row: { id: string }) => row.id)
}

function sanitizeErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/(key=)[^&\s]+/gi, "$1[redacted]")
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

  return {
    challengeIds,
    warnings,
    updatedSeries,
    scheduleGamesSeen,
    scheduleGamesMatched,
    liveGamesMatched,
    broadcastFieldsFound,
    venueFieldsFound,
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
    } = input.dryRun
      ? await sweep()
      : await withSyncJobRun(
          { jobName: JOB, trigger: "cron", sport: input.sport, provider: input.provider },
          sweep,
          (r) => ({
            rowsRead: r.scheduleGamesSeen,
            rowsWritten: r.updatedSeries,
            rowsSkipped: r.scheduleGamesSeen - r.scheduleGamesMatched,
            // Per-challenge warnings are collected, not thrown — the sweep still completed.
            status: r.warnings.length > 0 ? "partial" : "success",
            warnings: r.warnings.slice(0, 25),
            metadata: {
              challengeCount: r.challengeIds.length,
              updatedSeries: r.updatedSeries,
              scheduleGamesMatched: r.scheduleGamesMatched,
              liveGamesMatched: r.liveGamesMatched,
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
