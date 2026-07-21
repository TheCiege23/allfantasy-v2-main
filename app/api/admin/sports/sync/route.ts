import { NextRequest, NextResponse } from "next/server"
import { requireAdminOrBearer } from "@/lib/adminAuth"
import { logAdminAudit, resolveAdminAuditActor } from "@/lib/admin-audit"
import { runAdminSportsSync } from "@/lib/admin-dashboard/AdminSportsSyncService"
import { getAdminPerSportDataReliabilityRows } from "@/lib/admin-dashboard/AdminProviderHealthService"
import {
  getDashboardAiToolAvailability,
  getSportImportMatrix,
} from "@/lib/admin-dashboard/SportImportMatrixService"
import { getPlayerGameLogHealthDashboard } from "@/lib/sports-os/PlayerGameLogImportService"

export const dynamic = "force-dynamic"

function parseSeason(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10)
  return Number.isFinite(parsed) && parsed > 1900 && parsed < 2200 ? parsed : null
}

export async function GET(request: NextRequest) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  const [rows, playerGameLogHealth] = await Promise.all([
    getAdminPerSportDataReliabilityRows(),
    getPlayerGameLogHealthDashboard(),
  ])
  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    importMatrix: getSportImportMatrix(rows),
    aiToolAvailability: getDashboardAiToolAvailability(rows),
    playerGameLogHealth,
    controls: {
      endpoint: "/api/admin/sports/sync",
      methods: ["GET status", "POST sync"],
      syncTypes: [
        "schedules",
        "injuries",
        "news",
        "players",
        "player_game_logs",
        "player_stats",
        "rankings",
        "projections",
        "identity_health",
        "image_audit",
        "fantasy_value_snapshots",
        "all",
      ],
      notes: [
        "Admin/bearer protected.",
        "Public user routes remain cache-only.",
        "Use dryRun=true to preview a sync without provider calls.",
      ],
    },
  })
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  const body = (await request.json().catch(() => ({}))) as {
    type?: string
    sports?: unknown
    season?: unknown
    leagueId?: string
    seasonId?: string
    playerIds?: string[]
    weeks?: Array<number | string> | number | string
    limit?: number
    dryRun?: boolean
  }

  try {
    const result = await runAdminSportsSync({
      type: body.type,
      sports: body.sports,
      season: parseSeason(body.season),
      leagueId: body.leagueId,
      seasonId: body.seasonId,
      playerIds: body.playerIds,
      weeks: body.weeks,
      limit: body.limit,
      dryRun: body.dryRun === true,
    })

    // Writes provider data into canonical sports tables. dryRun is recorded rather
    // than skipped — knowing an operator probed a sync is itself useful, and the
    // volume here is low (unlike email previews).
    await logAdminAudit({
      adminUserId: resolveAdminAuditActor(gate.user),
      action: "admin_sports_sync",
      targetType: "sports_sync",
      targetId: body.type ?? "all",
      details: {
        type: body.type ?? null,
        sports: body.sports ?? null,
        season: parseSeason(body.season),
        leagueId: body.leagueId ?? null,
        seasonId: body.seasonId ?? null,
        playerIdCount: Array.isArray(body.playerIds) ? body.playerIds.length : 0,
        limit: body.limit ?? null,
        dryRun: body.dryRun === true,
        succeeded: result.ok,
      },
    })

    return NextResponse.json(result, { status: result.ok ? 200 : 429 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[admin/sports/sync] sync failed:", message)
    return NextResponse.json(
      {
        ok: false,
        error: "Sports sync failed",
        detail: message.slice(0, 240),
      },
      { status: 500 }
    )
  }
}
