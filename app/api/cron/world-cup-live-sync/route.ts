import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { requireCronAuth } from "../_auth"
import { prisma } from "@/lib/prisma"
import { syncWorldCupLiveScoresWithProviderChain } from "@/lib/world-cup/worldCupLiveScoreSyncService"
import { logWorldCupEnvReport, validateWorldCupEnv } from "@/lib/world-cup/worldCupEnvValidation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * GET /api/cron/world-cup-live-sync
 *
 * Cron: every 5 minutes — syncs live/recent match scores for all open World Cup
 * bracket challenges using the multi-provider fallback chain.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET} (or LEAGUE_CRON_SECRET / BRACKET_ADMIN_SECRET)
 * Query params:
 *   ?dryRun=true   — simulate without writing
 *   ?challengeId=  — target a single challenge (skip discovery)
 */
export async function GET(request: NextRequest) {
  if (!requireCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dryRun") === "true"
  const singleId = url.searchParams.get("challengeId") ?? undefined

  const startedAt = Date.now()

  // Validate env on first run (logs warnings; non-fatal)
  const envReport = validateWorldCupEnv()
  if (!envReport.ok || envReport.warnings.length > 0) {
    logWorldCupEnvReport(envReport)
  }

  // Discover challenges to sync
  let challengeIds: string[]
  if (singleId) {
    challengeIds = [singleId]
  } else {
    try {
      const rows = await (prisma as any).worldCupBracketChallenge.findMany({
        where: { status: { in: ["open", "locked", "live"] } },
        select: { id: true },
      })
      challengeIds = rows.map((r: { id: string }) => r.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("[world-cup-live-sync/cron] challenge discovery failed:", msg)
      return NextResponse.json(
        { ok: false, error: "challenge_discovery_failed", detail: msg },
        { status: 500 }
      )
    }
  }

  if (challengeIds.length === 0) {
    console.log("[world-cup-live-sync/cron] no open challenges to sync")
    return NextResponse.json({ ok: true, synced: 0, results: [], durationMs: Date.now() - startedAt })
  }

  console.log(`[world-cup-live-sync/cron] syncing ${challengeIds.length} challenge(s), dryRun=${dryRun}`)

  const results: Array<Record<string, unknown>> = []
  let succeeded = 0
  let failed = 0

  for (const challengeId of challengeIds) {
    try {
      const result = await syncWorldCupLiveScoresWithProviderChain({
        challengeId,
        dryRun,
        recalculate: !dryRun,
      })

      const summary = {
        challengeId,
        ok: true,
        updated: result.updated,
        skipped: result.skipped,
        finalMatches: result.finalMatches,
        recalculated: result.recalculated,
        winningProvider: result.winningProvider,
        providersAttempted: result.providersAttempted,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
      }

      results.push(summary)
      succeeded++

      if (result.updated > 0 || result.finalMatches > 0) {
        console.log(
          `[world-cup-live-sync/cron] ${challengeId}: updated=${result.updated} finals=${result.finalMatches} provider=${result.winningProvider ?? "none"}`
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[world-cup-live-sync/cron] ${challengeId}: sync failed:`, msg)
      results.push({ challengeId, ok: false, error: msg })
      failed++
    }
  }

  const durationMs = Date.now() - startedAt
  console.log(
    `[world-cup-live-sync/cron] done: ${succeeded} succeeded, ${failed} failed, ${durationMs}ms`
  )

  return NextResponse.json({
    ok: failed === 0,
    synced: succeeded,
    failed,
    dryRun,
    durationMs,
    results,
  })
}
