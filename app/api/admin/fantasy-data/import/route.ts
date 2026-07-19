/**
 * POST /api/admin/fantasy-data/import
 *
 * Admin-triggered fantasy data import for NFL or NCAAF.
 * Requires admin session or Bearer token.
 * Supports dryRun mode.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAdminOrBearer } from "@/lib/adminAuth"
import { logAdminAudit, resolveAdminAuditActor } from "@/lib/admin-audit"
import { importNflFantasyData } from "@/lib/fantasy-data/importNflFantasyData"
import { importNcaafFantasyData } from "@/lib/fantasy-data/importNcaafFantasyData"

export const dynamic = "force-dynamic"
export const maxDuration = 300

function parseSport(value: unknown): string {
  const raw = String(value ?? "NFL").trim().toUpperCase()
  if (raw === "NCAAF") return "NCAAF"
  return "NFL"
}

function parseSeason(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 1900 && n < 2200 ? Math.floor(n) : undefined
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    // allow empty body — use query params
  }

  const url = new URL(request.url)
  const sport = parseSport(body.sport ?? url.searchParams.get("sport"))
  const season = parseSeason(body.season ?? url.searchParams.get("season"))
  const dryRun =
    body.dryRun === true || url.searchParams.get("dryRun") === "true"

  const startedAt = Date.now()

  try {
    const result =
      sport === "NCAAF"
        ? await importNcaafFantasyData({ season, dryRun })
        : await importNflFantasyData({ season, dryRun })

    // Imports provider fantasy data into canonical tables. This route already
    // writes SyncJobRun telemetry (job-level), but that records *what ran*, not
    // *who triggered it* — the audit row is the attribution half.
    await logAdminAudit({
      adminUserId: resolveAdminAuditActor(gate.user),
      action: "admin_fantasy_data_import",
      targetType: "sport",
      targetId: sport,
      details: {
        sport,
        season: result.season ?? season ?? null,
        provider: result.provider ?? null,
        dryRun,
        succeeded: result.ok,
        durationMs: Date.now() - startedAt,
      },
    })

    return NextResponse.json({
      ok: result.ok,
      sport,
      dryRun,
      season: result.season,
      provider: result.provider,
      counts: result.counts,
      skipped: result.skipped,
      missingEnv: result.missingEnv,
      stale: result.stale,
      warnings: result.warnings,
      errors: result.errors,
      durationMs: Date.now() - startedAt,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[admin/fantasy-data/import] failed:", message)
    return NextResponse.json(
      { ok: false, sport, error: message.slice(0, 300), durationMs: Date.now() - startedAt },
      { status: 500 },
    )
  }
}
