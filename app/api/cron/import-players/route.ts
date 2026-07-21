/**
 * GET/POST /api/cron/import-players
 *
 * Vercel Cron schedule: every 6 hours (see vercel.json).
 * Calls runSportsDataImporter to build/refresh SportsPlayerRecord rows with
 * enriched stats, projections, ADP, injury status, and news for all supported sports.
 *
 * Optional query params:
 *   sport  — comma-separated sport codes to limit scope (e.g. "NFL,NBA")
 *   dryRun — "true" to skip DB writes (returns projected row count only)
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { prisma } from "@/lib/prisma"
import { runSportsDataImporter } from "@/lib/workers/sports-data-importer"

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = "force-dynamic"
export const maxDuration = 300

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sportParam = url.searchParams.get("sport")
  const dryRun = url.searchParams.get("dryRun") === "true"

  const sports = sportParam
    ? sportParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : undefined

  const startedAt = Date.now()

  try {
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        sports: sports ?? "all",
        message: "Dry run — no DB writes performed.",
        durationMs: Date.now() - startedAt,
      })
    }

    const result = await runSportsDataImporter({ sports })

    // Durable run record: admin production-health (?view=warehouse) reads teamCodeCounts from
    // here to flag truncated_fallback growth — the failure mode that silently blocked NCAAF/
    // NCAAB imports (full institution names overflowing the VarChar(32) team column).
    await prisma.syncJobRun.create({
      data: {
        jobName: "import-players",
        jobScope: result.sports.join(","),
        trigger: "cron",
        status: "completed",
        rowsWritten: result.imported,
        rowsSkipped: result.rowsSkippedByGuard,
        completedAt: new Date(),
        durationMs: result.durationMs,
        metadata: {
          teamCodeCounts: result.teamCodeCounts,
          skippedSports: result.skippedSports,
          staleFallbackApplied: result.staleFallbackApplied,
        },
      },
    }).catch((telemetryError) => {
      console.error("[cron/import-players] telemetry write failed:", telemetryError)
    })

    return NextResponse.json({
      ok: true,
      dryRun: false,
      imported: result.imported,
      sports: result.sports,
      staleFallbackApplied: result.staleFallbackApplied,
      skippedSports: result.skippedSports,
      teamCodeCounts: result.teamCodeCounts,
      rowsSkippedByGuard: result.rowsSkippedByGuard,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-players] failed:", message)
    return NextResponse.json(
      { ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}
