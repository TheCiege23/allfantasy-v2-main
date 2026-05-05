/**
 * POST /api/cron/world-cup-sync
 *
 * Scheduled cron job that syncs all open/live World Cup bracket challenges
 * against API-Football, updates match results/scores/advancement, and
 * recalculates leaderboards.
 *
 * Auth: x-cron-secret | Authorization: Bearer <secret> | x-admin-secret
 * Uses BRACKET_CRON_SECRET → CRON_SECRET → BRACKET_ADMIN_SECRET → ADMIN_PASSWORD
 *
 * Safe behavior:
 * - Returns JSON regardless of error
 * - Never exposes API keys or DB credentials
 * - Gracefully handles missing API key (skips sync, logs error)
 * - Gracefully handles DB unavailability
 */

import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { syncAllOpenWorldCupChallenges } from "@/lib/world-cup/worldCupSyncService"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

type SyncCronResult = {
  ok: boolean
  teamsSynced: number
  fixturesSynced: number
  matchesUpdated: number
  bracketsUpdated: number
  leaderboardsRecalculated: number
  errors: string[]
  startedAt: string
  finishedAt: string
}

async function handleCron(req: NextRequest): Promise<NextResponse> {
  if (!requireCronAuth(req, "BRACKET_CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = new Date()
  const result: SyncCronResult = {
    ok: false,
    teamsSynced: 0,
    fixturesSynced: 0,
    matchesUpdated: 0,
    bracketsUpdated: 0,
    leaderboardsRecalculated: 0,
    errors: [],
    startedAt: startedAt.toISOString(),
    finishedAt: "",
  }

  try {
    const results = await syncAllOpenWorldCupChallenges()

    for (const r of results) {
      result.teamsSynced = Math.max(result.teamsSynced, r.teamsSynced ?? 0)
      result.fixturesSynced += r.fixturesSynced ?? 0
      result.bracketsUpdated += 1
      if (r.leaderboard?.length) result.leaderboardsRecalculated += 1
    }

    result.ok = true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Strip any accidental key leaks from error messages
    const safe = msg
      .replace(/[A-Za-z0-9+/]{32,}={0,2}/g, "[REDACTED]")
      .replace(/(?:key|secret|token|password)=[^\s&]*/gi, "[REDACTED]")
    result.errors.push(safe)
    result.ok = false
  } finally {
    result.finishedAt = new Date().toISOString()

    // Persist sync log — best-effort, never throws
    try {
      const { prisma } = await import("@/lib/prisma")
      await (prisma as any).worldCupSyncLog.create({
        data: {
          status: result.ok ? "success" : result.errors.length ? "error" : "partial",
          source: "cron",
          startedAt,
          finishedAt: new Date(),
          teamsSynced: result.teamsSynced,
          fixturesSynced: result.fixturesSynced,
          matchesUpdated: result.matchesUpdated,
          bracketsUpdated: result.bracketsUpdated,
          leaderboardsRecalculated: result.leaderboardsRecalculated,
          summary: {
            bracketsUpdated: result.bracketsUpdated,
            errors: result.errors,
          },
          errorMessage: result.errors[0] ?? null,
        },
      })
    } catch {
      // Log write failure is non-fatal
    }
  }

  const status = result.ok ? 200 : result.errors.length ? 500 : 207
  return NextResponse.json(result, { status })
}

export async function GET(req: NextRequest) {
  return handleCron(req)
}

export async function POST(req: NextRequest) {
  return handleCron(req)
}
