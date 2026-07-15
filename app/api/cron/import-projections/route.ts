/**
 * GET/POST /api/cron/import-projections
 *
 * Vercel Cron schedule: weekly in-season (see vercel.json). Generates and persists canonical
 * NFL fantasy projections into the normalized `FantasyProjection` table via
 * `generateAndPersistCanonicalNflProjections` — the same ingest path the sync scripts use
 * (scripts/sync-sports-foundation.ts, scripts/sync-rolling-insights-nfl-foundation.ts). Before
 * this cron, that generator was invoked ONLY by manual scripts, so projections never refreshed
 * on a schedule and the per-feed health chip's "Projections" feed read permanently idle
 * (AF_LIVE_DATA_CRON_BUILD.md §2). Mirrors the proven import-scores / import-injuries handlers.
 *
 * Offseason honesty (AF_LIVE_DATA_CRON_BUILD.md §2): NFL projections legitimately do not
 * refresh mid-February through August. In that window the handler NO-OPS cleanly WITHOUT
 * touching `FantasyProjection`, so existing rows keep their honest `fetchedAt` (the health chip
 * shows "Projections · updated Xd ago" / idle) instead of being falsely bumped to "now" over
 * stale data. Pass `?force=true` to bypass the season gate (manual invoke / §7 verification).
 *
 * Gated by requireCronAuth (LEAGUE_CRON_SECRET / CRON_SECRET / IMPORT_WORKER_SECRET / admin).
 *
 * Optional query params:
 *   season — 4-digit year (defaults to current UTC year)
 *   week   — projection week (defaults inside the generator)
 *   force  — "true" to bypass the offseason no-op (manual/admin use)
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { generateAndPersistCanonicalNflProjections } from "@/lib/nfl-data-foundation/nflDataFoundationService"

export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * Conservative NFL projection window: September–mid-February (regular season + playoffs,
 * through the Super Bowl). Outside it, projections don't update, so the cron no-ops rather than
 * re-timestamp stale `FantasyProjection` rows. Exported for unit coverage.
 */
export function isNflProjectionWindow(now: Date): boolean {
  const month = now.getUTCMonth() + 1 // 1-12
  if (month >= 9 || month === 1) return true // Sep, Oct, Nov, Dec, Jan
  if (month === 2 && now.getUTCDate() <= 15) return true // playoffs / Super Bowl
  return false
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const force = url.searchParams.get("force") === "true"
  const seasonParam = url.searchParams.get("season")
  const weekParam = url.searchParams.get("week")
  const season = seasonParam ? Number(seasonParam) : undefined
  const week = weekParam ? Number(weekParam) : undefined

  const startedAt = Date.now()

  if (!force && !isNflProjectionWindow(new Date())) {
    return NextResponse.json({
      ok: true,
      offseason: true,
      generated: 0,
      persisted: 0,
      reason:
        "NFL projection offseason — no scheduled refresh; existing FantasyProjection rows keep their honest fetchedAt. Use ?force=true to override.",
      durationMs: Date.now() - startedAt,
    })
  }

  try {
    const result = await generateAndPersistCanonicalNflProjections({ season, week })

    return NextResponse.json({
      ok: true,
      offseason: false,
      generated: result.generated,
      persisted: result.persisted,
      rosPersisted: result.rosPersisted,
      skipped: result.skipped,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-projections] failed:", message)
    return NextResponse.json(
      { ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 },
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
