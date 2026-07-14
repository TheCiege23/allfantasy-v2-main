/**
 * GET/POST /api/cron/import-injuries
 *
 * Vercel Cron schedule: every 15 minutes (see vercel.json).
 * Syncs NFL/NCAAF injury reports from API-Sports into the sportsInjury table.
 * InjuryReportRecord rows are written by the sports-data-importer which reads
 * from this table, so freshness here directly affects AI injury context.
 *
 * Optional query params:
 *   sport   — "NFL" (default) or "NCAAF"
 *   season  — 4-digit year string (defaults to current season)
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"
import { prisma } from "@/lib/prisma"
import { syncNflRedraftCronCanonicalCache } from "@/lib/nfl-provider/nflRedraftCronCanonicalSync"
import { projectCanonicalNflInjuries } from "@/lib/nfl-provider/nflRedraftCanonicalScoreInjuryProjector"
import { syncLegacyNcaafInjuries } from "@/lib/ncaaf-provider/legacyApiSportsIngestion"

export const dynamic = "force-dynamic"
export const maxDuration = 120

function resolveSport(param: string | null): "NFL" | "NCAAF" {
  if (param?.toUpperCase() === "NCAAF") return "NCAAF"
  return "NFL"
}

async function isCanonicalInjuryCacheFresh(season: string | undefined): Promise<boolean> {
  const prefix = `nfl-redraft-provider:injuries:${season ?? new Date().getUTCFullYear()}:`
  const row = await prisma.sportsDataCache.findFirst({
    where: { cacheKey: { startsWith: prefix }, expiresAt: { gt: new Date() } },
    select: { cacheKey: true },
  }).catch(() => null)
  return Boolean(row)
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sport = resolveSport(url.searchParams.get("sport"))
  const season = url.searchParams.get("season") ?? undefined

  const startedAt = Date.now()

  try {
    if (sport === "NFL" && await isCanonicalInjuryCacheFresh(season)) {
      return NextResponse.json({
        ok: true,
        gated: true,
        sport,
        reason: "Canonical injury cache is still fresh; provider fetch skipped.",
        durationMs: Date.now() - startedAt,
      })
    }

    let count = 0
    let canonicalSync: Awaited<ReturnType<typeof syncNflRedraftCronCanonicalCache>> | null = null
    if (sport === "NFL") {
      canonicalSync = await withSyncJobRun(
        { jobName: "cron-import-injuries", sport, provider: "canonical-orchestrator", trigger: "cron" },
        () => syncNflRedraftCronCanonicalCache(
          { job: "import-injuries", sport, season },
          {
            afterCacheWrite: async ({ resolution }) => {
              count = await projectCanonicalNflInjuries(resolution, prisma)
            },
          },
        ),
        () => ({ rowsWritten: count }),
      )
    } else {
      count = await withSyncJobRun(
        { jobName: "cron-import-injuries", sport, provider: "api-sports-ncaaf-legacy", trigger: "cron" },
        () => syncLegacyNcaafInjuries(season),
        (rows) => ({ rowsWritten: typeof rows === "number" ? rows : 0 }),
      )
    }

    return NextResponse.json({
      ok: true,
      sport,
      season: season ?? "current",
      synced: count,
      canonicalSync,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-injuries] failed:", message)
    return NextResponse.json(
      { ok: false, sport, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}
